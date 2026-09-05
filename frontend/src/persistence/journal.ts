import { jsonSafe, randomHex16, sha256Hex, stableStringify } from '../lib/encoding'

export const JOURNAL_INDEX_KEY = 'glj1:index'
export const JOURNAL_KEY_PREFIX = 'glj1:'
export const JOURNAL_LOCK_NAME = 'genlayer-journal-v1'
export const JOURNAL_CAPACITY = 32

export type JournalStatus = 'SIGNING' | 'SUBMITTED' | 'RECONCILE' | 'FINALIZED_ERROR' | 'VERIFIED'

export interface JournalEntry {
  v: 1
  reservation: string
  chain: string
  contract: `0x${string}`
  account: `0x${string}`
  method: string
  intent: string
  args_json: string
  pre_revision: string
  pre_hash: string
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
  pre_hash: string
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
const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const RESERVATION_RE = /^[0-9a-f]{32}$/
const HEX64_RE = /^[0-9a-f]{64}$/
const TX_HASH_RE = /^0x[0-9a-f]{64}$/
const DECIMAL_RE = /^(?:0|[1-9][0-9]*)$/
const IMMUTABLE_FIELDS: readonly (keyof JournalEntry)[] = [
  'v', 'reservation', 'chain', 'contract', 'account', 'method', 'intent',
  'args_json', 'pre_revision', 'pre_hash', 'created_ms',
]
const ENTRY_KEYS: readonly (keyof JournalEntry)[] = [
  ...IMMUTABLE_FIELDS, 'tx_hash', 'status',
]

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

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

function terminal(status: JournalStatus): boolean {
  return status === 'VERIFIED' || status === 'FINALIZED_ERROR'
}

export function caseIdFromIntent(intent: string): string | null {
  const match = /^(?:replace_base|freeze_case|evaluate_case|retry_case):([1-9][0-9]*):[0-9]+$/.exec(intent)
  return match?.[1] ?? null
}

function journalKey(reservation: string): string {
  return `${JOURNAL_KEY_PREFIX}${reservation}`
}

function isJournalKey(value: string): boolean {
  return value.startsWith(JOURNAL_KEY_PREFIX) && value !== JOURNAL_INDEX_KEY && RESERVATION_RE.test(value.slice(JOURNAL_KEY_PREFIX.length))
}

function assertEntry(value: unknown): asserts value is JournalEntry {
  if (!value || typeof value !== 'object') throw new JournalError('CORRUPT_JOURNAL')
  const item = value as Partial<JournalEntry>
  const argsJson = item.args_json
  const keys = Object.keys(value)
  if (
    keys.length !== ENTRY_KEYS.length || keys.some((key) => !ENTRY_KEYS.includes(key as keyof JournalEntry)) ||
    item.v !== 1 ||
    typeof item.reservation !== 'string' || !RESERVATION_RE.test(item.reservation) || item.reservation !== item.reservation.toLowerCase() ||
    typeof item.chain !== 'string' || !DECIMAL_RE.test(item.chain) ||
    typeof item.contract !== 'string' || !ADDRESS_RE.test(item.contract) ||
    typeof item.account !== 'string' || !ADDRESS_RE.test(item.account) ||
    typeof item.method !== 'string' || utf8Length(item.method) === 0 || utf8Length(item.method) > 48 ||
    typeof item.intent !== 'string' || utf8Length(item.intent) === 0 || utf8Length(item.intent) > 160 ||
    typeof argsJson !== 'string' || utf8Length(argsJson) === 0 || utf8Length(argsJson) > 18_000 ||
    typeof item.pre_revision !== 'string' || !DECIMAL_RE.test(item.pre_revision) ||
    typeof item.pre_hash !== 'string' || !HEX64_RE.test(item.pre_hash) ||
    typeof item.tx_hash !== 'string' || (item.tx_hash !== '' && !TX_HASH_RE.test(item.tx_hash)) ||
    typeof item.status !== 'string' || !STATUS_VALUES.includes(item.status) ||
    typeof item.created_ms !== 'string' || !DECIMAL_RE.test(item.created_ms)
  ) throw new JournalError('CORRUPT_JOURNAL')

  try {
    JSON.parse(argsJson)
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

function signingContextAvailable(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const hostname = window.location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export async function operationFingerprint(value: Pick<JournalEntry, 'chain' | 'contract' | 'account' | 'method' | 'intent'>): Promise<string> {
  return sha256Hex(stableStringify([
    value.chain,
    value.contract.toLowerCase(),
    value.account.toLowerCase(),
    value.method,
    value.intent,
  ]))
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
    let callbackStarted = false
    try {
      return await this.lockManager.request(JOURNAL_LOCK_NAME, { mode: 'exclusive' }, async () => {
        callbackStarted = true
        return callback()
      })
    } catch (error) {
      if (error instanceof JournalError || callbackStarted) throw error
      throw new JournalError('JOURNAL_LOCK_UNAVAILABLE', 'Transaction recovery is unavailable in this browser.')
    }
  }

  async initialize(): Promise<JournalEntry[]> {
    return this.withLock(async () => {
      const entries = this.loadAll()
      this.writeIndex(entries)
      return entries
    })
  }

  loadAll(): JournalEntry[] {
    const storage = this.getStorage()
    const keys = new Set(this.readIndex())
    // Rebuild from the namespace as well; an interrupted index write must not hide an orphan.
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && isJournalKey(key)) keys.add(key)
    }

    const entries: JournalEntry[] = []
    for (const key of keys) {
      const raw = storage.getItem(key)
      // A stale index entry can be removed during recovery; namespace records remain authoritative.
      if (raw === null) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new JournalError('CORRUPT_JOURNAL')
      }
      assertEntry(parsed)
      if (journalKey(parsed.reservation) !== key) throw new JournalError('CORRUPT_JOURNAL')
      entries.push(parsed)
    }
    return entries.sort((left, right) => Number(left.created_ms) - Number(right.created_ms))
  }

  async probe(): Promise<void> {
    await this.withLock(async () => {
      if (!signingContextAvailable()) throw new JournalError('JOURNAL_SECURE_CONTEXT', 'Transaction recovery requires a secure browser context.')
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

  async reserve(input: JournalReservationInput): Promise<JournalEntry> {
    return this.withLock(async () => {
      const contract = input.contract.toLowerCase() as `0x${string}`
      const account = input.account.toLowerCase() as `0x${string}`
      const args_json = stableStringify(jsonSafe(input.args))
      const candidateBase = {
        chain: input.chain,
        contract,
        account,
        method: input.method,
        intent: input.intent,
      }
      const candidateFingerprint = await operationFingerprint(candidateBase)
      const records = this.loadAll()

      if (records.length >= JOURNAL_CAPACITY) throw new JournalError('JOURNAL_CAPACITY', 'Transaction recovery storage is full; reconcile or export a record first.')
      for (const record of records) {
        if (terminal(record.status) || record.chain !== input.chain || record.contract !== contract) continue
        const sameFingerprint = candidateFingerprint === await operationFingerprint(record)
        const candidateCase = caseIdFromIntent(input.intent)
        const sameCase = candidateCase !== null && candidateCase === caseIdFromIntent(record.intent)
        if (sameFingerprint || sameCase) throw new JournalError('PENDING_CONFLICT', 'A matching action is already awaiting reconciliation.')
      }

      let reservation = randomHex16()
      while (records.some((record) => record.reservation === reservation)) reservation = randomHex16()
      const entry: JournalEntry = {
        v: 1,
        reservation,
        chain: input.chain,
        contract,
        account,
        method: input.method,
        intent: input.intent,
        args_json,
        pre_revision: input.pre_revision,
        pre_hash: input.pre_hash.toLowerCase(),
        tx_hash: '',
        status: 'SIGNING',
        created_ms: String(Date.now()),
      }
      assertEntry(entry)
      this.persist(entry)
      return entry
    })
  }

  private assertImmutable(current: JournalEntry, expected: JournalEntry): void {
    for (const field of IMMUTABLE_FIELDS) {
      if (current[field] !== expected[field]) throw new JournalError('IMMUTABLE_JOURNAL_CONTEXT')
    }
  }

  async removeUnsigned(entry: JournalEntry): Promise<void> {
    await this.withLock(async () => {
      const current = this.find(entry.reservation)
      this.assertImmutable(current, entry)
      if (current.status !== 'SIGNING' || current.tx_hash !== '') throw new JournalError('UNSIGNED_RESERVATION_CHANGED')
      this.getStorage().removeItem(journalKey(current.reservation))
      this.writeIndex(this.loadAll())
    })
  }

  async markSubmitted(entry: JournalEntry, txHash: string): Promise<JournalEntry> {
    return this.withLock(async () => this.transitionLocked(entry, 'SUBMITTED', txHash))
  }

  async markReconcile(entry: JournalEntry, txHash?: string): Promise<JournalEntry> {
    return this.withLock(async () => this.transitionLocked(entry, 'RECONCILE', txHash))
  }

  async markFinalizedError(entry: JournalEntry): Promise<JournalEntry> {
    return this.withLock(async () => this.transitionLocked(entry, 'FINALIZED_ERROR'))
  }

  async markVerified(entry: JournalEntry): Promise<JournalEntry> {
    return this.withLock(async () => this.transitionLocked(entry, 'VERIFIED'))
  }

  private async transitionLocked(entry: JournalEntry, status: JournalStatus, txHash?: string): Promise<JournalEntry> {
    const current = this.find(entry.reservation)
    this.assertImmutable(current, entry)
    const nextHash = txHash === undefined ? current.tx_hash : txHash.toLowerCase()
    if (current.tx_hash && nextHash !== current.tx_hash) throw new JournalError('IMMUTABLE_TX_HASH')
    if (current.status === 'RECONCILE' && current.tx_hash === '' && status === 'SUBMITTED') {
      throw new JournalError('LOST_TRANSACTION_HASH')
    }
    if (!canTransition(current.status, status)) throw new JournalError('INVALID_JOURNAL_TRANSITION')
    if (nextHash !== '' && !TX_HASH_RE.test(nextHash)) throw new JournalError('INVALID_TX_HASH')
    const next = { ...current, status, tx_hash: nextHash }
    assertEntry(next)
    this.persist(next)
    return next
  }

  find(reservation: string): JournalEntry {
    const entry = this.loadAll().find((item) => item.reservation === reservation)
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
      return []
    }
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !isJournalKey(value))) {
      return []
    }
    if (new Set(parsed).size !== parsed.length) return []
    return parsed
  }

  private writeIndex(entries: JournalEntry[]): void {
    const sorted = [...entries].sort((left, right) => Number(left.created_ms) - Number(right.created_ms))
    this.getStorage().setItem(JOURNAL_INDEX_KEY, JSON.stringify(sorted.map((entry) => journalKey(entry.reservation))))
  }

  private persist(entry: JournalEntry): void {
    const storage = this.getStorage()
    try {
      storage.setItem(journalKey(entry.reservation), JSON.stringify(entry))
      this.writeIndex(this.loadAll())
    } catch (error) {
      if (error instanceof JournalError) throw error
      throw new JournalError('JOURNAL_WRITE_FAILED')
    }
  }
}
