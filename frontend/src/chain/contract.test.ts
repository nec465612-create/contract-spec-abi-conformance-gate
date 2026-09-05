import { normalizeBaseJson, ReadCache } from './contract'
import { stableStringify } from '../lib/encoding'

describe('contract read boundary', () => {
  it('canonicalizes base JSON without executing or trusting presentation order', () => {
    const result = normalizeBaseJson('{"abi":[{"type":"function"}],"requirements":[]}')
    expect(result.canonical).toBe('{"abi":[{"type":"function"}],"requirements":[]}')
    expect(result.parsed).toEqual({ abi: [{ type: 'function' }], requirements: [] })
  })

  it('deduplicates identical in-flight reads and invalidates safe cache entries', async () => {
    const cache = new ReadCache()
    let calls = 0
    const loader = async () => {
      calls += 1
      await Promise.resolve()
      return { value: calls }
    }
    const [first, second] = await Promise.all([cache.get('same', loader), cache.get('same', loader)])
    expect(first).toEqual({ value: 1 })
    expect(second).toEqual({ value: 1 })
    expect(calls).toBe(1)
    cache.invalidate()
    expect(await cache.get('same', loader)).toEqual({ value: 2 })
  })

  it('keeps argument serialization deterministic at the boundary', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(stableStringify([1n, '2'])).toBe('["1","2"]')
  })
})
