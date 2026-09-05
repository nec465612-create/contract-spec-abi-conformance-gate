import type { CalldataEncodable } from 'genlayer-js/types'
import type { Address } from 'genlayer-js/types'
import { getReadClient, type ContractAddress, type GenLayerClient } from './config'
import { isRecord, stableStringify } from '../lib/encoding'

export interface Requirement {
  id: string
  text: string
  polarity: 'REQUIRED' | 'FORBIDDEN'
}

export interface BaseSpec {
  requirements: Requirement[]
  abi: Record<string, unknown>[]
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

  async get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value as T

    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T>

    const pending = loader()
      .then((value) => {
        this.values.set(key, { expiresAt: Date.now() + 5_000, value })
        return value
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, pending)
    return pending
  }

  invalidate(): void {
    this.values.clear()
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

export function normalizeBaseJson(raw: string): { canonical: string; parsed: BaseSpec } {
  if (new TextEncoder().encode(raw).length > 8_192) throw new Error('BASE_SPEC_TOO_LARGE')
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.requirements) || !Array.isArray(parsed.abi)) {
    throw new Error('BASE_SPEC_SHAPE')
  }
  return { canonical: stableStringify(parsed), parsed: parsed as unknown as BaseSpec }
}

export class ContractGateway {
  readonly cache = new ReadCache()

  constructor(
    private readonly address: ContractAddress,
    private readonly readClient: GenLayerClient = getReadClient(),
  ) {}

  private async read(functionName: string, args: CalldataEncodable[]): Promise<unknown> {
    const key = `${this.readClient.chain.id}:${this.address.toLowerCase()}:${functionName}:${stableStringify(args)}`
    return this.cache.get(key, () => this.readClient.readContract({
      address: this.address as Address,
      functionName,
      args,
    }))
  }

  async getCount(): Promise<string> {
    return normalizedInteger(await this.read('get_count', []))
  }

  async listCases(startId = '1', limit = '4'): Promise<CasePage> {
    return pageReturn(await this.read('list_cases', [BigInt(startId), BigInt(limit)]))
  }

  async getCase(id: string): Promise<CaseRecord | null> {
    return caseRecord(await this.read('get_case', [BigInt(id)]))
  }

  async getVersion(id: string, revision: string): Promise<CaseRecord | null> {
    return caseRecord(await this.read('get_version', [BigInt(id), BigInt(revision)]))
  }

  async getIdByNonce(account: ContractAddress, nonce: string): Promise<string> {
    return normalizedInteger(await this.read('get_id_by_nonce', [account, nonce]))
  }

  invalidate(): void {
    this.cache.invalidate()
  }
}
