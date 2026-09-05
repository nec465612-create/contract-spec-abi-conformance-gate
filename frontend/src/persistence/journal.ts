import { jsonSafe, randomHex32 } from '../lib/encoding'

export const JOURNAL_INDEX_KEY = 'glj1:index'
export const JOURNAL_KEY_PREFIX = 'glj1:'
export const JOURNAL_LOCK_NAME = 'genlayer-journal-v1'

export type JournalStatus = 'SIGNING' | 'SUBMITTED' | 'RECONCILE' | 'FINALIZED_ERROR' | 'VERIFIED'

export interface JournalEntry {
  v: 1
  reservation: `0x${string}`
  chain: string
  contract: `0x${string}`
  account: `0x${string}`
  method: string
  intent: string
  args_json: string
  pre_revision: string
  pre_hash: `0x${string}`
  tx_hash: string
  status: JournalStatus
  created_ms: string
}

export interface JournalReservationInput {
  chain: string
  contract: `0x${string}`
  account: `0x${string}`
  method: string
  intent: string
  args: unknown
  pre_revision: string
  pre_hash: `0x${string}`
}

export class JournalError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'JournalError'
  }
}

interface LockManagerLike {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>
}

const STATUS_VALUES: readonly JournalStatus[] = ['SIGNING', 'SUBMITTED', 'RECONCILE', 'FINALIZED_ERROR', 'VERIFIED']
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function defaultLockManager(): LockManagerLike | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManagerLike }).locks
  } catch {
    return undefined
  }
}

function terminal(status: JournalStatus): boolean {
  return status === 'VERIFIED' || status === 'FINALIZED_ERROR'
}

function assertEntry(value: unknown): asserts value is JournalEntry {
  if (!value || typeof value !== 'object') throw new JournalError('CORRUPT_JOURNAL')
  const item = value as Partial<JournalEntry>
  if (
    item.v !== 1 ||
    typeof item.reservation !== 'string' || !HASH_RE.test(item.reservation) ||
    typeof item.chain !== 'string' || !/^\d+$/.test(item.chain) ||
    typeof item.contract !== 'string' || !ADDRESS_RE.test(item.contract) ||
    typeof item.account !== 'string' || !ADDRESS_RE.test(item.account) ||
    typeof item.method !== 'string' || item.method.length === 0 || item.method.length > 48 ||
    typeof item.intent !== 'string' || item.intent.length === 0 || item.intent.length > 160 ||
    typeof item.args_json !== 'string' || item.args_json.length > 18_000 ||
    typeof item.pre_revision !== 'string' || !/^\d+$/.test(item.pre_revision) ||
    typeof item.pre_hash !== 'string' || !HASH_RE.test(item.pre_hash) ||
    typeof item.tx_hash !== 'string' || (item.tx_hash !== '' && !HASH_RE.test(item.tx_hash)) ||
    typeof item.status !== 'string' || !STATUS_VALUES.includes(item.status) ||
    typeof item.created_ms !== 'string' || !/^\d+$/.test(item.created_ms)
  ) throw new JournalError('CORRUPT_JOURNAL')

  try {
    JSON.parse(item.args_json)
  } catch {
    throw new JournalError('CORRUPT_JOURNAL')
  }
}

function canTransition(from: JournalStatus, to: JournalStatus): boolean {
  if (terminal(from)) return false
  if (from === 'SIGNING') return ['SUBMITTED', 'RECONCILE', 'FINALIZED_ERROR'].includes(to)
  if (from === 'SUBMITTED') return ['RECONCILE', 'FINALIZED_ERROR', 'VERIFIED'].includes(to)
  if (from === 'RECONCILE') return ['SUBMITTED', 'FINALIZED_ERROR', 'VERIFIED'].includes(to)
  return false
}

export class JournalStore {
  constructor(
    private readonly storage: Storage | null = defaultStorage(),
    private readonly lockManager: LockManagerLike | undefined = defaultLockManager(),
  ) {}

  private getStorage(): Storage {
    if (!this.storage) throw new JournalError('JOURNAL_STORAGE_UNAVAILABLE', 'Transaction recovery is unavailable in this browser.')
    return this.storage
  }

  async withLock<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.lockManager) throw new JournalError('JOURNAL_LOCK_UNAVAILABLE', 'Transaction recovery is unavailable in this browser.')
    return this.lockManager.request(JOURNAL_LOCK_NAME, { mode: 'exclusive' }, callback)
  }

  loadAll(): JournalEntry[] {
    const storage = this.getStorage()
    const indexed = this.readIndex()
    const keys = new Set(indexed.map((reservation) => this.key(reservation)))
    // Rebuild from the namespace as well; an interrupted index write must not hide a reservation.
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(JOURNAL_KEY_PREFIX) && key !== JOURNAL_INDEX_KEY) keys.add(key)
    }

    const entries: JournalEntry[] = []
    for (const key of keys) {
      const raw = storage.getItem(key)
      if (raw === null) throw new JournalError('CORRUPT_JOURNAL')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new JournalError('CORRUPT_JOURNAL')
      }
      assertEntry(parsed)
      if (this.key(parsed.reservation) !== key) throw new JournalError('CORRUPT_JOURNAL')
      entries.push(parsed)
    }
    return entries.sort((left, right) => Number(left.created_ms) - Number(right.created_ms))
  }

  async probe(): Promise<void> {
    await this.withLock(async () => {
      const storage = this.getStorage()
      const key = `${JOURNAL_KEY_PREFIX}probe:${Date.now()}:${Math.random().toString(16).slice(2)}`
      try {
        storage.setItem(key, 'ok')
        if (storage.getItem(key) !== 'ok') throw new JournalError('JOURNAL_PROBE_FAILED')
      } catch (error) {
        if (error instanceof JournalError) throw error
        throw new JournalError('JOURNAL_PROBE_FAILED')
      } finally {
        try { storage.removeItem(key) } catch { /* fail closed on the next load */ }
      }
    })
  }

  pending(contract: `0x${string}`, intent: string): JournalEntry | null {
    return this.loadAll().find((entry) => entry.contract.toLowerCase() === contract.toLowerCase() && entry.intent === intent && !terminal(entry.status)) ?? null
  }

  async reserve(input: JournalReservationInput): Promise<JournalEntry> {
    return this.withLock(async () => {
      const existing = this.pending(input.contract, input.intent)
      if (existing) throw new JournalError('PENDING_CONFLICT', 'A matching action is already awaiting reconciliation.')
      const reservation = randomHex32()
      const args_json = JSON.stringify(jsonSafe(input.args))
      if (args_json.length > 18_000) throw new JournalError('ARGS_TOO_LARGE')
      const entry: JournalEntry = {
        v: 1,
        reservation,
        chain: input.chain,
        contract: input.contract,
        account: input.account,
        method: input.method,
        intent: input.intent,
        args_json,
        pre_revision: input.pre_revision,
        pre_hash: input.pre_hash,
        tx_hash: '',
        status: 'SIGNING',
        created_ms: String(Date.now()),
      }
      assertEntry(entry)
      this.persist(entry)
      return entry
    })
  }

  async transition(reservation: `0x${string}`, status: JournalStatus, txHash?: string): Promise<JournalEntry> {
    return this.withLock(async () => {
      const current = this.find(reservation)
      const nextHash = txHash ?? current.tx_hash
      if (current.tx_hash && nextHash !== current.tx_hash) throw new JournalError('IMMUTABLE_TX_HASH')
      if (!canTransition(current.status, status)) throw new JournalError('INVALID_JOURNAL_TRANSITION')
      if (nextHash !== '' && !HASH_RE.test(nextHash)) throw new JournalError('INVALID_TX_HASH')
      const next = { ...current, status, tx_hash: nextHash }
      assertEntry(next)
      this.persist(next)
      return next
    })
  }

  async markSubmitted(entry: JournalEntry, txHash: string): Promise<JournalEntry> {
    return this.transition(entry.reservation, 'SUBMITTED', txHash)
  }

  async markReconcile(entry: JournalEntry): Promise<JournalEntry> {
    return this.transition(entry.reservation, 'RECONCILE')
  }

  async markFinalizedError(entry: JournalEntry): Promise<JournalEntry> {
    return this.transition(entry.reservation, 'FINALIZED_ERROR')
  }

  async markVerified(entry: JournalEntry): Promise<JournalEntry> {
    return this.transition(entry.reservation, 'VERIFIED')
  }

  find(reservation: `0x${string}`): JournalEntry {
    const entry = this.loadAll().find((item) => item.reservation.toLowerCase() === reservation.toLowerCase())
    if (!entry) throw new JournalError('RESERVATION_NOT_FOUND')
    return entry
  }

  private readIndex(): string[] {
    const raw = this.getStorage().getItem(JOURNAL_INDEX_KEY)
    if (raw === null) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new JournalError('CORRUPT_JOURNAL_INDEX')
    }
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !HASH_RE.test(value))) {
      throw new JournalError('CORRUPT_JOURNAL_INDEX')
    }
    return parsed
  }

  private key(reservation: string): string {
    return `${JOURNAL_KEY_PREFIX}${reservation}`
  }

  private persist(entry: JournalEntry): void {
    const storage = this.getStorage()
    try {
      storage.setItem(this.key(entry.reservation), JSON.stringify(entry))
      const reservations = this.loadAll().map((item) => item.reservation)
      if (!reservations.includes(entry.reservation)) reservations.push(entry.reservation)
      storage.setItem(JOURNAL_INDEX_KEY, JSON.stringify(reservations))
    } catch (error) {
      if (error instanceof JournalError) throw error
      throw new JournalError('JOURNAL_WRITE_FAILED')
    }
  }
}
