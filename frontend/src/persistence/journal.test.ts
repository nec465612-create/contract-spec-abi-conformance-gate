import { JournalError, JournalStore } from './journal'
import { genlayerChain } from '../chain/config'

function lockManager() {
  return {
    request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> => callback(),
  }
}

const baseInput = {
  chain: String(genlayerChain.id),
  contract: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`,
  account: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`,
  method: 'freeze_case',
  intent: 'case:1:freeze_case',
  args: [1n, 1n],
  pre_revision: '1',
  pre_hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
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

  it('fails closed when exclusive recovery locking is unavailable', async () => {
    const store = new JournalStore(localStorage, undefined)
    await expect(store.reserve(baseInput)).rejects.toMatchObject({ code: 'JOURNAL_LOCK_UNAVAILABLE' })
  })

  it('rejects corrupt records instead of silently ignoring them', () => {
    localStorage.setItem('glj1:0x9999999999999999999999999999999999999999999999999999999999999999', '{bad')
    expect(() => new JournalStore(localStorage, lockManager()).loadAll()).toThrow(JournalError)
  })
})
