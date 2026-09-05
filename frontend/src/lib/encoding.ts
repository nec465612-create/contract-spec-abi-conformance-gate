export function stableStringify(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER')
      return JSON.stringify(value)
    case 'bigint':
      return JSON.stringify(value.toString())
    case 'undefined':
      throw new Error('UNDEFINED_VALUE')
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`
      }
      if (value instanceof Uint8Array) {
        return stableStringify(Array.from(value))
      }
      if (value instanceof Map) {
        const entries = [...value.entries()]
          .map(([key, item]) => [String(key), item] as const)
          .sort(([left], [right]) => left.localeCompare(right))
        return stableStringify(Object.fromEntries(entries))
      }
      if (value instanceof Date) return stableStringify(value.toISOString())
      if (value === null) return 'null'

      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
        .join(',')}}`
    default:
      throw new Error('UNSUPPORTED_VALUE')
  }
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), jsonSafe(item)]))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  }
  return value
}

export async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('CRYPTO_UNAVAILABLE')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomHex16(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('CRYPTO_UNAVAILABLE')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
