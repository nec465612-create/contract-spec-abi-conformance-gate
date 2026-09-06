import type { Eip1193Provider } from '../wallet/types'

export type EvidenceRow = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7'

export interface RpcEvidenceEvent {
  seq: number
  row: EvidenceRow
  channel: 'chain' | 'provider'
  method: string
  attempt: number
  status: 'SUCCESS' | 'ERROR' | 'EVENT'
  retryAfterMs: number | null
  cache: 'MISS' | 'N/A'
  txHash: string | null
  providerEvent: string | null
  startedAt: string
  durationMs: number
}

interface RpcEvidenceLedger {
  schemaVersion: 1
  runId: string
  releaseUrl: string
  startedAt: string
  events: RpcEvidenceEvent[]
}

const STORAGE_KEY = 'genlayer-rpc-evidence-v1'
export const RPC_ROW_MAXIMA: Record<EvidenceRow, number> = { F0: 0, F1: 1, F2: 1, F3: 3, F4: 11, F5: 11, F6: 3, F7: 0 }
let currentRow: EvidenceRow = 'F0'
let nextAttempt = 1
const providerWrappers = new WeakMap<Eip1193Provider, Eip1193Provider>()
let rpcFetchInstalled = false

function freshLedger(): RpcEvidenceLedger {
  return { schemaVersion: 1, runId: crypto.randomUUID(), releaseUrl: location.href, startedAt: new Date().toISOString(), events: [] }
}

function load(): RpcEvidenceLedger {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as RpcEvidenceLedger
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.events)) return parsed
  } catch { /* create a clean ledger */ }
  const ledger = freshLedger()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger))
  return ledger
}

function saveEvent(event: Omit<RpcEvidenceEvent, 'seq' | 'row' | 'attempt'>): void {
  const ledger = load()
  ledger.events.push({ ...event, seq: ledger.events.length + 1, row: currentRow, attempt: nextAttempt })
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)) } finally { nextAttempt = 1 }
}

function observe(event: Omit<RpcEvidenceEvent, 'seq' | 'row' | 'attempt'>): void {
  try { saveEvent(event) } catch { /* evidence storage must never alter an RPC result */ }
}

function hashFrom(value: unknown): string | null {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value : null
}

export function observedRetryAfterMs(error: unknown): number | null {
  const value = error && typeof error === 'object' ? error as {
    retryAfter?: unknown
    headers?: Headers | Record<string, unknown>
    response?: { headers?: Headers | Record<string, unknown> }
  } : {}
  const readHeader = (headers: typeof value.headers): unknown => {
    if (!headers) return undefined
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get('Retry-After')
    return (headers as Record<string, unknown>)['Retry-After'] ?? (headers as Record<string, unknown>)['retry-after']
  }
  const raw = value.retryAfter ?? readHeader(value.headers) ?? readHeader(value.response?.headers)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.ceil(raw * 1_000)
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const trimmed = raw.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1_000)
  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null
}

export async function withEvidenceRow<T>(row: EvidenceRow, action: () => Promise<T>): Promise<T> {
  const previous = currentRow
  currentRow = row
  try { return await action() } finally { currentRow = previous }
}

export function setRpcEvidenceAttempt(attempt: number): void {
  nextAttempt = Math.max(1, Math.floor(attempt))
}

export function beginRpcEvidence(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(freshLedger()))
}

export function exportRpcEvidence(): void {
  const ledger = load()
  const maxima = RPC_ROW_MAXIMA
  const summary = (Object.keys(maxima) as EvidenceRow[]).map((row) => {
    const events = ledger.events.filter((event) => event.row === row)
    const transactionHashes = [...new Set(events.map((event) => event.txHash).filter((hash): hash is string => hash !== null))]
    return {
      row,
      plannedMaximum: maxima[row],
      actualChainRequests: events.filter((event) => event.channel === 'chain').length,
      actualProviderRequests: events.filter((event) => event.channel === 'provider' && event.status !== 'EVENT').length,
      providerEvents: events.filter((event) => event.status === 'EVENT').length,
      cacheHits: 0,
      cacheMisses: events.filter((event) => event.cache === 'MISS').length,
      retryAttempts: events.filter((event) => event.attempt > 1).length,
      retryAfterValues: events.map((event) => event.retryAfterMs).filter((value): value is number => value !== null),
      receiptCalls: events.filter((event) => /transaction/i.test(event.method) && event.channel === 'chain').length,
      readbackCalls: events.filter((event) => /call/i.test(event.method) && event.channel === 'chain').length,
      transactionHashes,
      transactionCount: transactionHashes.length,
    }
  })
  const blob = new Blob([JSON.stringify({ ...ledger, endedAt: new Date().toISOString(), summary }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `genlayer-rpc-evidence-${ledger.runId}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function instrumentRpcFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let method: string | null = null
    if (typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body) as { method?: unknown }
        if (typeof payload.method === 'string') method = payload.method
      } catch { /* non-RPC request */ }
    }
    if (!method) return fetchImpl(input, init)
    const started = performance.now()
    const startedAt = new Date().toISOString()
    try {
      const result = await fetchImpl(input, init)
      observe({ channel: 'chain', method, status: result.ok ? 'SUCCESS' : 'ERROR', retryAfterMs: observedRetryAfterMs({ headers: result.headers }), cache: 'MISS', txHash: null, providerEvent: null, startedAt, durationMs: Math.round(performance.now() - started) })
      return result
    } catch (error) {
      observe({ channel: 'chain', method, status: 'ERROR', retryAfterMs: observedRetryAfterMs(error), cache: 'MISS', txHash: null, providerEvent: null, startedAt, durationMs: Math.round(performance.now() - started) })
      throw error
    }
  }) as typeof fetch
}

export function installRpcFetchInstrumentation(): void {
  if (rpcFetchInstalled || typeof globalThis.fetch !== 'function') return
  globalThis.fetch = instrumentRpcFetch(globalThis.fetch.bind(globalThis))
  rpcFetchInstalled = true
}

export function instrumentClientRequest<T extends { request: (...args: never[]) => Promise<unknown> }>(client: T): T {
  const original = client.request
  client.request = (async (...args: never[]) => {
    const request = args[0] as { method?: unknown } | undefined
    const method = typeof request?.method === 'string' ? request.method : 'unknown'
    const started = performance.now()
    const startedAt = new Date().toISOString()
    try {
      const result = await original.apply(client, args)
      observe({ channel: 'chain', method, status: 'SUCCESS', retryAfterMs: null, cache: 'MISS', txHash: hashFrom(result), providerEvent: null, startedAt, durationMs: Math.round(performance.now() - started) })
      return result
    } catch (error) {
      observe({ channel: 'chain', method, status: 'ERROR', retryAfterMs: observedRetryAfterMs(error), cache: 'MISS', txHash: null, providerEvent: null, startedAt, durationMs: Math.round(performance.now() - started) })
      throw error
    }
  }) as T['request']
  return client
}

export function instrumentProvider(provider: Eip1193Provider): Eip1193Provider {
  const existing = providerWrappers.get(provider)
  if (existing) return existing
  const listeners = new Map<(...args: unknown[]) => void, (...args: unknown[]) => void>()
  const wrapped: Eip1193Provider = {
    ...provider,
    request: async (request) => {
      const started = performance.now()
      const startedAt = new Date().toISOString()
      try {
        const result = await provider.request(request)
        observe({ channel: 'provider', method: request.method, status: 'SUCCESS', retryAfterMs: null, cache: 'N/A', txHash: hashFrom(result), providerEvent: null, startedAt, durationMs: Math.round(performance.now() - started) })
        return result
      } catch (error) {
        observe({ channel: 'provider', method: request.method, status: 'ERROR', retryAfterMs: observedRetryAfterMs(error), cache: 'N/A', txHash: null, providerEvent: null, startedAt, durationMs: Math.round(performance.now() - started) })
        throw error
      }
    },
    on: provider.on ? (event, listener) => {
      const observed = (...args: unknown[]) => {
        observe({ channel: 'provider', method: event, status: 'EVENT', retryAfterMs: null, cache: 'N/A', txHash: null, providerEvent: event, startedAt: new Date().toISOString(), durationMs: 0 })
        listener(...args)
      }
      listeners.set(listener, observed)
      provider.on?.(event, observed)
    } : undefined,
    removeListener: provider.removeListener ? (event, listener) => provider.removeListener?.(event, listeners.get(listener) ?? listener) : undefined,
  }
  providerWrappers.set(provider, wrapped)
  return wrapped
}
