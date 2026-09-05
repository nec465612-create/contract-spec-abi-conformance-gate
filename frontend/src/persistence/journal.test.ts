import { JournalError, JournalStore } from './journal'
import { genlayerChain } from '../chain/config'

function lockManager() {
  return {
    request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> => callback(),
  }
}

function failingLockManager() {
  return {
    request: async () => { throw new Error('LOCK_REQUEST_FAILED') },
  }
}

const baseInput = {
  chain: String(genlayerChain.id),
  contract: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`,
  account: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`,
  method: 'freeze_case',
  intent: 'freeze_case:1:1',
  args: [1n, 1n],
  pre_revision: '1',
  pre_hash: '1111111111111111111111111111111111111111111111111111111111111111',
}

describe('journal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reserves before signing, detects pending conflicts, and keeps transaction hashes immutable', async () => {
    const store = new JournalStore(localStorage, lockManager())
    const first = await store.reserve(baseInput)
    expect(first.status).toBe('SIGNING')
    await expect(store.reserve(baseInput)).rejects.toMatchObject({ code: 'PENDING_CONFLICT' })
    await expect(store.reserve({ ...baseInput, method: 'evaluate_case', intent: 'evaluate_case:1:2' })).rejects.toMatchObject({ code: 'PENDING_CONFLICT' })
    expect(first.reservation).toMatch(/^[0-9a-f]{32}$/)
    expect(first.pre_hash).toMatch(/^[0-9a-f]{64}$/)
    await expect(store.markSubmitted({ ...first, method: 'evaluate_case' }, '0x2222222222222222222222222222222222222222222222222222222222222222')).rejects.toMatchObject({ code: 'IMMUTABLE_JOURNAL_CONTEXT' })

    const submitted = await store.markSubmitted(first, '0x2222222222222222222222222222222222222222222222222222222222222222')
    expect(submitted.status).toBe('SUBMITTED')
    await expect(store.markSubmitted(submitted, '0x3333333333333333333333333333333333333333333333333333333333333333')).rejects.toMatchObject({ code: 'IMMUTABLE_TX_HASH' })
    const verified = await store.markVerified(submitted)
    expect(verified.status).toBe('VERIFIED')
  })

  it('rebuilds from namespaced records when the index is missing', async () => {
    const store = new JournalStore(localStorage, lockManager())
    const entry = await store.reserve(baseInput)
    localStorage.removeItem('glj1:index')
    expect(store.loadAll().map((item) => item.reservation)).toEqual([entry.reservation])
  })

  it('rebuilds from namespaced records when the index is malformed', async () => {
    const store = new JournalStore(localStorage, lockManager())
    const entry = await store.reserve(baseInput)
    localStorage.setItem('glj1:index', '{bad')
    expect(store.loadAll().map((item) => item.reservation)).toEqual([entry.reservation])
    await store.initialize()
    expect(JSON.parse(localStorage.getItem('glj1:index') ?? '[]')).toEqual([`glj1:${entry.reservation}`])
  })

  it('fails closed when exclusive recovery locking is unavailable', async () => {
    const store = new JournalStore(localStorage, undefined)
    await expect(store.reserve(baseInput)).rejects.toMatchObject({ code: 'JOURNAL_LOCK_UNAVAILABLE' })
    await expect(new JournalStore(localStorage, failingLockManager()).reserve(baseInput)).rejects.toMatchObject({ code: 'JOURNAL_LOCK_UNAVAILABLE' })
  })

  it('enforces the bounded recovery journal capacity', async () => {
    const store = new JournalStore(localStorage, lockManager())
    for (let id = 1; id <= 32; id += 1) {
      await store.reserve({ ...baseInput, intent: `freeze_case:${id}:1` })
    }
    await expect(store.reserve({ ...baseInput, intent: 'freeze_case:33:1' })).rejects.toMatchObject({ code: 'JOURNAL_CAPACITY' })
  })

  it('rejects corrupt records instead of silently ignoring them', () => {
    localStorage.setItem('glj1:99999999999999999999999999999999', '{bad')
    expect(() => new JournalStore(localStorage, lockManager()).loadAll()).toThrow(JournalError)
  })

  it('rejects extra record keys and never promotes a lost hash', async () => {
    const store = new JournalStore(localStorage, lockManager())
    const entry = await store.reserve(baseInput)
    const raw = JSON.parse(localStorage.getItem(`glj1:${entry.reservation}`) ?? '{}')
    raw.extra = true
    localStorage.setItem(`glj1:${entry.reservation}`, JSON.stringify(raw))
    expect(() => store.loadAll()).toThrow(JournalError)

    localStorage.clear()
    const pending = await store.reserve(baseInput)
    const reconciled = await store.markReconcile(pending)
    await expect(store.markSubmitted(reconciled, `0x${'2'.repeat(64)}`)).rejects.toMatchObject({ code: 'LOST_TRANSACTION_HASH' })
  })
})
