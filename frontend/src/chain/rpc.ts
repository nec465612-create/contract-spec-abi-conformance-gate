export const RPC_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxJitterMs: 250,
})

type HeaderSource = {
  get?: (name: string) => string | null | undefined
  [key: string]: unknown
}

type RpcErrorShape = {
  code?: unknown
  message?: unknown
  status?: unknown
  statusCode?: unknown
  retryAfter?: unknown
  headers?: HeaderSource
  response?: {
    status?: unknown
    headers?: HeaderSource
  }
}

export class RpcBudgetError extends Error {
  constructor(readonly retryable: boolean, message = 'The chain RPC is temporarily rate-limited or unavailable. Wait and try this read again.') {
    super(message)
    this.name = 'RpcBudgetError'
  }
}

export interface RpcRetryOptions {
  signal?: AbortSignal
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  maxJitterMs?: number
  random?: () => number
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  beforeAttempt?: () => void
}

export interface RpcAttemptBudget {
  spend: () => void
  used: () => number
}

export function createRpcAttemptBudget(maxRequests: number): RpcAttemptBudget {
  const maximum = Math.max(1, Math.floor(maxRequests))
  let count = 0
  return {
    spend: () => {
      if (count >= maximum) throw new RpcBudgetError(true, 'The bounded RPC budget for this operation is exhausted. Preserve the transaction evidence and reconcile later.')
      count += 1
    },
    used: () => count,
  }
}

interface QueuedRead<T> {
  operation: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
}

function asShape(error: unknown): RpcErrorShape {
  return error && typeof error === 'object' ? error as RpcErrorShape : {}
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function statusOf(error: unknown): number | null {
  const value = asShape(error)
  return numeric(value.status) ?? numeric(value.statusCode) ?? numeric(value.response?.status)
}

function headerValue(headers: HeaderSource | undefined, name: string): string | null {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name) ?? headers.get(name.toLowerCase()) ?? null
  const value = headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}

function retryAfterMs(error: unknown): number | null {
  const value = asShape(error)
  const raw = value.retryAfter
    ?? headerValue(value.headers, 'Retry-After')
    ?? headerValue(value.response?.headers, 'Retry-After')
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.ceil(raw * 1_000)
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const trimmed = raw.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1_000)
  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null
}

export function isTransientRpcError(error: unknown): boolean {
  if (error instanceof RpcBudgetError) return true
  const value = asShape(error)
  const status = statusOf(error)
  if (status !== null && [408, 425, 429, 500, 502, 503, 504].includes(status)) return true
  const code = String(value.code ?? '').toLowerCase()
  if (['-32005', '-32016', '429', 'rate_limit', 'rate-limited', 'server_busy', 'timeout'].includes(code)) return true
  const message = String(value.message ?? error ?? '').toLowerCase()
  return /(?:\b429\b|rate[ -]?limit|too many requests|server busy|temporarily unavailable|timeout|timed out|network request failed|fetch failed|connection reset)/i.test(message)
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The RPC operation was aborted.', 'AbortError')
  const error = new Error('The RPC operation was aborted.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

export class RpcReadQueue {
  private readonly queue: QueuedRead<unknown>[] = []
  private active = false

  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve: resolve as (value: unknown) => void, reject, signal })
      this.pump()
    })
  }

  private pump(): void {
    if (this.active) return
    const next = this.queue.shift()
    if (!next) return
    if (next.signal?.aborted) {
      next.reject(abortError())
      this.pump()
      return
    }
    this.active = true
    Promise.resolve()
      .then(next.operation)
      .then((value) => {
        if (next.signal?.aborted) next.reject(abortError())
        else next.resolve(value)
      }, (error) => next.reject(error))
      .finally(() => {
        this.active = false
        this.pump()
      })
  }
}

export const sharedRpcReadQueue = new RpcReadQueue()

export function sleepWithSignal(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function waitForDocumentVisible(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisibility)
      signal?.removeEventListener('abort', onAbort)
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') {
        cleanup()
        resolve()
      }
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    document.addEventListener('visibilitychange', onVisibility)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function withRpcRetry<T>(operation: () => Promise<T>, options: RpcRetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? RPC_RETRY_POLICY.maxAttempts))
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? RPC_RETRY_POLICY.baseDelayMs)
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? RPC_RETRY_POLICY.maxDelayMs)
  const maxJitterMs = Math.max(0, options.maxJitterMs ?? RPC_RETRY_POLICY.maxJitterMs)
  const random = options.random ?? Math.random
  const sleep = options.sleep ?? sleepWithSignal
  let attempt = 0

  while (true) {
    throwIfAborted(options.signal)
    options.beforeAttempt?.()
    try {
      return await operation()
    } catch (error) {
      if (!isTransientRpcError(error) || attempt + 1 >= maxAttempts) {
        if (isTransientRpcError(error)) throw new RpcBudgetError(true)
        throw error
      }
      const serverDelay = retryAfterMs(error)
      if (serverDelay !== null && serverDelay > maxDelayMs) throw new RpcBudgetError(true)
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt))
      const jitter = serverDelay === null
        ? Math.floor(Math.max(0, Math.min(1, random())) * Math.min(maxJitterMs, Math.max(1, exponential / 2)))
        : 0
      await sleep(serverDelay ?? Math.min(maxDelayMs, exponential + jitter), options.signal)
      attempt += 1
    }
  }
}
