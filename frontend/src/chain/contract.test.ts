import { normalizeBaseJson, parseJsonStrict, ReadCache } from './contract'
import { stableStringify } from '../lib/encoding'

describe('contract read boundary', () => {
  it('canonicalizes base JSON without executing or trusting presentation order', () => {
    const result = normalizeBaseJson('{"abi":[{"inputs":[],"name":"check","outputs":[],"stateMutability":"view","type":"function"}],"requirements":[{"id":"read","polarity":"REQUIRED","text":"Expose a read operation"}]}')
    expect(result.canonical).toBe('{"abi":[{"inputs":[],"name":"check","outputs":[],"stateMutability":"view","type":"function"}],"requirements":[{"id":"read","polarity":"REQUIRED","text":"Expose a read operation"}]}')
    expect(result.metrics).toMatchObject({ requirements: 1, abiEntries: 1, functionEntries: 1, parameterNodes: 0, depth: 0 })
  })

  it('rejects duplicate keys before JSON.parse can collapse them', () => {
    expect(() => parseJsonStrict('{"requirements":[],"requirements":[],"abi":[]}')).toThrow('DUPLICATE_KEY')
    expect(() => parseJsonStrict('{"a":1,"nested":{"a":2}}')).not.toThrow()
  })

  it('enforces the contract ABI grammar and live resource limits', () => {
    const tuple = { name: 'items', type: 'tuple[][2]', components: [{ name: 'id', type: 'uint' }, { name: 'owner', type: 'address' }] }
    const result = normalizeBaseJson(JSON.stringify({
      requirements: [{ id: 'read', text: 'Expose a read operation', polarity: 'REQUIRED' }],
      abi: [{ type: 'function', name: 'check', inputs: [tuple], outputs: [], stateMutability: 'view' }],
    }))
    expect(result.metrics.parameterNodes).toBe(3)
    expect(result.metrics.depth).toBe(1)
    expect(() => normalizeBaseJson(JSON.stringify({
      requirements: [{ id: 'read', text: 'Expose a read operation', polarity: 'REQUIRED' }],
      abi: [{ type: 'function', name: 'check', inputs: [{ name: 'x', type: 'uint256', components: [] }], outputs: [], stateMutability: 'view' }],
    }))).toThrow('BASE_SPEC_INVALID')
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

  it('does not let an invalidated in-flight read repopulate the cache', async () => {
    const cache = new ReadCache()
    let resolveStale: ((value: string) => void) | undefined
    const stale = cache.get('same', () => new Promise<string>((resolve) => { resolveStale = resolve }))
    cache.invalidate()
    await expect(cache.get('same', async () => 'fresh')).resolves.toBe('fresh')
    resolveStale?.('stale')
    await stale
    await expect(cache.get('same', async () => 'unexpected')).resolves.toBe('fresh')
  })

  it('keeps argument serialization deterministic at the boundary', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(stableStringify([1n, '2'])).toBe('["1","2"]')
  })
})
