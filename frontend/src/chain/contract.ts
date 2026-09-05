import type { CalldataEncodable } from 'genlayer-js/types'
import type { Address } from 'genlayer-js/types'
import { getReadClient, type ContractAddress, type GenLayerClient } from './config'
import { isRecord, stableStringify } from '../lib/encoding'
import { sharedRpcReadQueue, withRpcRetry, type RpcAttemptBudget } from './rpc'

export interface Requirement {
  id: string
  text: string
  polarity: 'REQUIRED' | 'FORBIDDEN'
}

export interface BaseSpec {
  requirements: Requirement[]
  abi: Record<string, unknown>[]
}

export interface BaseSpecMetrics {
  bytes: number
  requirements: number
  abiEntries: number
  functionEntries: number
  parameterNodes: number
  depth: number
}

export interface CaseRecord {
  v: 1
  id: string
  primary: string
  secondary: string
  phase: string
  revision: string
  parent: string
  create_hash: string
  base: BaseSpec
  response: Record<string, unknown>
  base_locked: boolean
  response_locked: boolean
  accepted_attempts: number
  last_accepted_at: string
  outcome: string
  result: Record<string, unknown>
  domain: Record<string, unknown>
  last_operation: Record<string, unknown>
}

export interface CasePage {
  ids: string[]
  next: string
}

export class ReadCache {
  private readonly values = new Map<string, { expiresAt: number; value: unknown }>()
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private generation = 0

  async get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value as T

    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T>

    const generation = this.generation
    let pending: Promise<T>
    pending = loader()
      .then((value) => {
        if (generation === this.generation) this.values.set(key, { expiresAt: Date.now() + 5_000, value })
        return value
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key)
      })
    this.inFlight.set(key, pending)
    return pending
  }

  invalidate(): void {
    this.values.clear()
    this.inFlight.clear()
    this.generation += 1
  }
}

const BASE_CAP = 8_192
const ID_RE = /^[a-z][a-z0-9_]{0,15}$/
const TYPE_RE = /^([A-Za-z0-9]+)((?:\[\]|\[[0-9]+\]){0,4})$/
const ARRAY_SUFFIX_RE = /\[\]|\[([0-9]+)\]/g
const MUTABILITIES = ['pure', 'view', 'nonpayable', 'payable'] as const
const POLARITIES = ['REQUIRED', 'FORBIDDEN'] as const

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

function text(value: unknown, maximum: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || utf8Length(value) > maximum || (!empty && value.length === 0) || [...value].some((char) => char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t')) {
    throw new Error('BASE_SPEC_INVALID')
  }
}

function scanString(raw: string, start: number): { value: string; next: number } {
  if (raw[start] !== '"') throw new Error('BAD_JSON')
  let index = start + 1
  while (index < raw.length) {
    const char = raw[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') {
      try {
        return { value: JSON.parse(raw.slice(start, index + 1)) as string, next: index + 1 }
      } catch {
        throw new Error('BAD_JSON')
      }
    }
    index += 1
  }
  throw new Error('BAD_JSON')
}

function skipWhitespace(raw: string, start: number): number {
  let index = start
  while (index < raw.length && /\s/.test(raw[index])) index += 1
  return index
}

function scanValue(raw: string, start: number): number {
  const index = skipWhitespace(raw, start)
  if (raw[index] === '"') return scanString(raw, index).next
  if (raw[index] === '{') return scanObject(raw, index)
  if (raw[index] === '[') return scanArray(raw, index)
  const primitive = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(raw.slice(index))
  if (!primitive) throw new Error('BAD_JSON')
  return index + primitive[0].length
}

function scanObject(raw: string, start: number): number {
  let index = skipWhitespace(raw, start + 1)
  const keys = new Set<string>()
  if (raw[index] === '}') return index + 1
  while (index < raw.length) {
    const key = scanString(raw, index)
    if (keys.has(key.value)) throw new Error('DUPLICATE_KEY')
    keys.add(key.value)
    index = skipWhitespace(raw, key.next)
    if (raw[index] !== ':') throw new Error('BAD_JSON')
    index = scanValue(raw, index + 1)
    index = skipWhitespace(raw, index)
    if (raw[index] === '}') return index + 1
    if (raw[index] !== ',') throw new Error('BAD_JSON')
    index = skipWhitespace(raw, index + 1)
  }
  throw new Error('BAD_JSON')
}

function scanArray(raw: string, start: number): number {
  let index = skipWhitespace(raw, start + 1)
  if (raw[index] === ']') return index + 1
  while (index < raw.length) {
    index = scanValue(raw, index)
    index = skipWhitespace(raw, index)
    if (raw[index] === ']') return index + 1
    if (raw[index] !== ',') throw new Error('BAD_JSON')
    index = skipWhitespace(raw, index + 1)
  }
  throw new Error('BAD_JSON')
}

export function parseJsonStrict(raw: string): unknown {
  if (typeof raw !== 'string') throw new Error('BAD_JSON')
  const normalized = raw.replace(/\r\n/g, '\n')
  try {
    const end = skipWhitespace(normalized, scanValue(normalized, 0))
    if (end !== normalized.length) throw new Error('BAD_JSON')
    return JSON.parse(normalized) as unknown
  } catch (error) {
    if (error instanceof Error && error.message === 'DUPLICATE_KEY') throw error
    throw new Error('BAD_JSON')
  }
}

interface ValidationState {
  nodes: number
  depth: number
}

function canonicalParam(value: unknown, state: ValidationState, event = false, depth = 0): string {
  if (!isRecord(value)) throw new Error('BASE_SPEC_INVALID')
  state.nodes += 1
  state.depth = Math.max(state.depth, depth)
  if (state.nodes > 32 || depth > 4 || typeof value.type !== 'string') throw new Error('BASE_SPEC_INVALID')
  const match = TYPE_RE.exec(value.type)
  if (!match) throw new Error('BASE_SPEC_INVALID')
  const [, base, suffixText] = match
  const suffixes = [...suffixText.matchAll(ARRAY_SUFFIX_RE)]
  if (suffixes.length > 4 || suffixes.map((suffix) => suffix[0]).join('') !== suffixText) throw new Error('BASE_SPEC_INVALID')
  for (const suffix of suffixes) {
    if (suffix[1] !== undefined && (suffix[1].startsWith('0') || Number(suffix[1]) < 1 || Number(suffix[1]) > 64)) throw new Error('BASE_SPEC_INVALID')
  }
  const expected = base === 'tuple' ? ['name', 'type', 'components'] : ['name', 'type']
  if (event) expected.push('indexed')
  if (!exactKeys(value, expected)) throw new Error('BASE_SPEC_INVALID')
  text(value.name, 16, true)
  if (event && typeof value.indexed !== 'boolean') throw new Error('BASE_SPEC_INVALID')
  let canonicalBase = base
  if (base === 'tuple') {
    if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > 8) throw new Error('BASE_SPEC_INVALID')
    canonicalBase = `(${value.components.map((item) => canonicalParam(item, state, false, depth + 1)).join(',')})`
  } else if (base === 'uint' || base === 'int') {
    canonicalBase = `${base}256`
  } else if (base === 'address' || base === 'bool' || base === 'string' || base === 'bytes' || /^bytes(?:[1-9]|[12][0-9]|3[0-2])$/.test(base)) {
    canonicalBase = base
  } else {
    const sized = /^(u?int)([0-9]+)$/.exec(base)
    if (!sized || Number(sized[2]) % 8 !== 0 || Number(sized[2]) < 8 || Number(sized[2]) > 256) throw new Error('BASE_SPEC_INVALID')
  }
  return canonicalBase + suffixText
}

function callableEntry(value: unknown): { key: string; signature: string } | null {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('BASE_SPEC_INVALID')
  if (value.type === 'function') {
    if (!exactKeys(value, ['type', 'name', 'inputs', 'outputs', 'stateMutability']) || typeof value.name !== 'string' || !ID_RE.test(value.name) || !MUTABILITIES.includes(value.stateMutability as typeof MUTABILITIES[number])) throw new Error('BASE_SPEC_INVALID')
    if (!Array.isArray(value.inputs) || value.inputs.length > 8 || !Array.isArray(value.outputs) || value.outputs.length > 4) throw new Error('BASE_SPEC_INVALID')
    const state: ValidationState = { nodes: 0, depth: 0 }
    const inputs = value.inputs.map((item) => canonicalParam(item, state))
    const outputs = value.outputs.map((item) => canonicalParam(item, state))
    const key = `${value.name}(${inputs.join(',')})`
    return { key, signature: `${key}->(${outputs.join(',')}):${value.stateMutability}` }
  }
  if (value.type === 'constructor') {
    if (!exactKeys(value, ['type', 'inputs', 'stateMutability']) || !['nonpayable', 'payable'].includes(String(value.stateMutability)) || !Array.isArray(value.inputs) || value.inputs.length > 8) throw new Error('BASE_SPEC_INVALID')
    const state: ValidationState = { nodes: 0, depth: 0 }
    value.inputs.forEach((item) => canonicalParam(item, state))
    return null
  }
  if (value.type === 'event') {
    if (!exactKeys(value, ['type', 'name', 'inputs', 'anonymous']) || typeof value.name !== 'string' || !ID_RE.test(value.name) || typeof value.anonymous !== 'boolean' || !Array.isArray(value.inputs) || value.inputs.length > 8) throw new Error('BASE_SPEC_INVALID')
    const state: ValidationState = { nodes: 0, depth: 0 }
    value.inputs.forEach((item) => canonicalParam(item, state, true))
    return null
  }
  if (value.type === 'error') {
    if (!exactKeys(value, ['type', 'name', 'inputs']) || typeof value.name !== 'string' || !ID_RE.test(value.name) || !Array.isArray(value.inputs) || value.inputs.length > 8) throw new Error('BASE_SPEC_INVALID')
    const state: ValidationState = { nodes: 0, depth: 0 }
    value.inputs.forEach((item) => canonicalParam(item, state))
    return null
  }
  if (value.type === 'fallback') {
    if (!exactKeys(value, ['type', 'stateMutability']) || !['nonpayable', 'payable'].includes(String(value.stateMutability))) throw new Error('BASE_SPEC_INVALID')
    return null
  }
  if (value.type === 'receive') {
    if (!exactKeys(value, ['type', 'stateMutability']) || value.stateMutability !== 'payable') throw new Error('BASE_SPEC_INVALID')
    return null
  }
  throw new Error('BASE_SPEC_INVALID')
}

function validateBase(value: unknown): BaseSpecMetrics {
  if (!isRecord(value) || !exactKeys(value, ['requirements', 'abi']) || !Array.isArray(value.requirements) || value.requirements.length < 1 || value.requirements.length > 8 || !Array.isArray(value.abi) || value.abi.length < 1 || value.abi.length > 16) throw new Error('BASE_SPEC_INVALID')
  const ids = new Set<string>()
  for (const requirement of value.requirements) {
    if (!isRecord(requirement) || !exactKeys(requirement, ['id', 'text', 'polarity']) || typeof requirement.id !== 'string' || !ID_RE.test(requirement.id) || ids.has(requirement.id) || !POLARITIES.includes(requirement.polarity as typeof POLARITIES[number])) throw new Error('BASE_SPEC_INVALID')
    text(requirement.text, 384)
    ids.add(requirement.id)
  }
  const callables = value.abi.map(callableEntry)
  const functions = callables.filter((entry): entry is { key: string; signature: string } => entry !== null)
  if (functions.length < 1 || functions.length > 8 || new Set(functions.map((entry) => entry.key)).size !== functions.length) throw new Error('BASE_SPEC_INVALID')
  const metrics = value.abi.reduce((current, entry) => {
    if (!isRecord(entry)) throw new Error('BASE_SPEC_INVALID')
    const state: ValidationState = { nodes: 0, depth: 0 }
    if (entry.type === 'function') {
      if (!Array.isArray(entry.inputs) || !Array.isArray(entry.outputs)) throw new Error('BASE_SPEC_INVALID')
      ;[...entry.inputs, ...entry.outputs].forEach((item) => canonicalParam(item, state))
    } else if (entry.type === 'constructor' || entry.type === 'event' || entry.type === 'error') {
      if (!Array.isArray(entry.inputs)) throw new Error('BASE_SPEC_INVALID')
      entry.inputs.forEach((item) => canonicalParam(item, state, entry.type === 'event'))
    }
    return { nodes: Math.max(current.nodes, state.nodes), depth: Math.max(current.depth, state.depth) }
  }, { nodes: 0, depth: 0 })
  return {
    bytes: 0,
    requirements: value.requirements.length,
    abiEntries: value.abi.length,
    functionEntries: functions.length,
    parameterNodes: metrics.nodes,
    depth: metrics.depth,
  }
}

function normalizedInteger(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return String(BigInt(value))
  throw new Error('INVALID_INTEGER_RETURN')
}

function returnedJson(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value)
  return value
}

function caseRecord(value: unknown): CaseRecord | null {
  const parsed = returnedJson(value)
  if (parsed === null) return null
  if (!isRecord(parsed)) throw new Error('MALFORMED_CASE_RETURN')
  if (parsed.v !== 1 || typeof parsed.id !== 'string' || typeof parsed.revision !== 'string') {
    throw new Error('MALFORMED_CASE_RETURN')
  }
  if (!isRecord(parsed.base) || !Array.isArray(parsed.base.requirements) || !Array.isArray(parsed.base.abi)) {
    throw new Error('MALFORMED_CASE_RETURN')
  }
  return parsed as unknown as CaseRecord
}

function pageReturn(value: unknown): CasePage {
  const parsed = returnedJson(value)
  if (!isRecord(parsed) || !Array.isArray(parsed.ids) || typeof parsed.next !== 'string') {
    throw new Error('MALFORMED_PAGE_RETURN')
  }
  if (parsed.ids.some((id) => typeof id !== 'string')) throw new Error('MALFORMED_PAGE_RETURN')
  return { ids: parsed.ids as string[], next: parsed.next }
}

export function normalizeBaseJson(raw: string): { canonical: string; parsed: BaseSpec; metrics: BaseSpecMetrics } {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (utf8Length(normalized) > BASE_CAP) throw new Error('BASE_SPEC_TOO_LARGE')
  const parsed = parseJsonStrict(normalized)
  const metrics = validateBase(parsed)
  const canonical = stableStringify(parsed)
  const bytes = utf8Length(canonical)
  if (bytes > BASE_CAP) throw new Error('BASE_SPEC_TOO_LARGE')
  return { canonical, parsed: parsed as BaseSpec, metrics: { ...metrics, bytes } }
}

const sharedCaches = new Map<string, ReadCache>()

function sharedCacheFor(chainId: number, address: ContractAddress): ReadCache {
  const key = `${chainId}:${address.toLowerCase()}`
  const existing = sharedCaches.get(key)
  if (existing) return existing
  const cache = new ReadCache()
  sharedCaches.set(key, cache)
  return cache
}

export class ContractGateway {
  readonly cache: ReadCache

  constructor(
    private readonly address: ContractAddress,
    private readonly readClient: GenLayerClient = getReadClient(),
  ) {
    this.cache = sharedCacheFor(this.readClient.chain.id, address)
  }

  private async read(functionName: string, args: CalldataEncodable[], budget?: RpcAttemptBudget): Promise<unknown> {
    const key = `${this.readClient.chain.id}:${this.address.toLowerCase()}:${functionName}:${stableStringify(args)}`
    return this.cache.get(key, () => withRpcRetry(() => sharedRpcReadQueue.run(() => this.readClient.readContract({
        address: this.address as Address,
        functionName,
        args,
      })), { beforeAttempt: budget?.spend }))
  }

  async getCount(budget?: RpcAttemptBudget): Promise<string> {
    return normalizedInteger(await this.read('get_count', [], budget))
  }

  async listCases(startId = '1', limit = '4', budget?: RpcAttemptBudget): Promise<CasePage> {
    return pageReturn(await this.read('list_cases', [BigInt(startId), BigInt(limit)], budget))
  }

  async getCase(id: string, budget?: RpcAttemptBudget): Promise<CaseRecord | null> {
    return caseRecord(await this.read('get_case', [BigInt(id)], budget))
  }

  async getVersion(id: string, revision: string, budget?: RpcAttemptBudget): Promise<CaseRecord | null> {
    return caseRecord(await this.read('get_version', [BigInt(id), BigInt(revision)], budget))
  }

  async getIdByNonce(account: ContractAddress, nonce: string, budget?: RpcAttemptBudget): Promise<string> {
    return normalizedInteger(await this.read('get_id_by_nonce', [account, nonce], budget))
  }

  invalidate(): void {
    this.cache.invalidate()
  }
}
