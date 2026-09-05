import { fireEvent } from '@testing-library/dom'
import {
  ProviderRegistry,
  requestAccounts,
  walletIdFromEip6963,
  walletIdsFromLegacyProvider,
} from './providers'
import type { Eip1193Provider } from './types'

function provider(flags: Partial<Eip1193Provider> = {}): Eip1193Provider {
  return { request: vi.fn(async () => []), ...flags }
}

describe('wallet discovery', () => {
  const registries: ProviderRegistry[] = []

  afterEach(() => {
    for (const registry of registries) registry.stop()
    registries.length = 0
  })

  it('accepts exactly one supported legacy identity and hides ambiguous providers', () => {
    expect(walletIdsFromLegacyProvider(provider({ isMetaMask: true }))).toEqual(['metamask'])
    expect(walletIdsFromLegacyProvider(provider({ isMetaMask: true, isRabby: true }))).toEqual(['metamask', 'rabby'])
    expect(walletIdsFromLegacyProvider(provider())).toEqual([])
  })

  it('maps only supported EIP-6963 identities', () => {
    expect(walletIdFromEip6963({ name: 'MetaMask', rdns: 'io.metamask' })).toBe('metamask')
    expect(walletIdFromEip6963({ name: 'OKX Wallet', rdns: 'com.okx.wallet' })).toBe('okx')
    expect(walletIdFromEip6963({ name: 'Rabby Wallet', rdns: 'io.rabby' })).toBe('rabby')
    expect(walletIdFromEip6963({ name: 'Injected Wallet', rdns: 'com.example' })).toBeNull()
    expect(walletIdFromEip6963({ name: 'MetaMask clone', rdns: 'io.metamask.example' })).toBeNull()
    expect(walletIdFromEip6963({ name: 'Rabby', rdns: 'com.debank.rabby' })).toBeNull()
  })

  it('discovers zero, one, and three supported wallets without generic tiles', () => {
    const host = window as Window & { ethereum?: Eip1193Provider }
    const first = provider({ isMetaMask: true })
    host.ethereum = first
    const registry = new ProviderRegistry(host)
    registries.push(registry)
    registry.start()
    expect(registry.snapshot().map((item) => item.id)).toEqual(['metamask'])

    const okx = provider()
    const rabby = provider()
    fireEvent(window, new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'okx-1', name: 'OKX Wallet', icon: 'data:image/svg+xml,okx', rdns: 'com.okx.wallet' }, provider: okx },
    }))
    fireEvent(window, new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'rabby-1', name: 'Rabby', icon: 'data:image/svg+xml,rabby', rdns: 'io.rabby' }, provider: rabby },
    }))
    expect(registry.snapshot().map((item) => item.id)).toEqual(['metamask', 'okx', 'rabby'])
    expect(registry.snapshot().some((item) => item.label.toLowerCase().includes('injected'))).toBe(false)
  })

  it('deduplicates announcements and replaces only the matching legacy tile', () => {
    const legacy = provider({ isMetaMask: true })
    const host = window as Window & { ethereum?: Eip1193Provider }
    host.ethereum = legacy
    const registry = new ProviderRegistry(host)
    registries.push(registry)
    registry.start()
    const announced = provider()
    const announce = () => fireEvent(window, new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'metamask-1', name: 'MetaMask', icon: 'data:image/svg+xml,metamask', rdns: 'io.metamask' }, provider: announced },
    }))
    announce()
    announce()
    expect(registry.snapshot()).toHaveLength(1)
    expect(registry.snapshot()[0].source).toBe('eip6963')
    expect(registry.snapshot()[0].provider).toBe(announced)
  })

  it('keeps one tile per supported wallet even when providers announce different UUIDs', () => {
    const host = window as Window & { ethereum?: Eip1193Provider }
    const registry = new ProviderRegistry(host)
    registries.push(registry)
    registry.start()
    fireEvent(window, new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'rabby-1', name: 'Rabby', icon: 'data:image/svg+xml,rabby', rdns: 'io.rabby' }, provider: provider() },
    }))
    fireEvent(window, new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'rabby-2', name: 'Rabby Wallet', icon: 'data:image/svg+xml,rabby2', rdns: 'io.rabby' }, provider: provider() },
    }))
    expect(registry.snapshot().filter((item) => item.id === 'rabby')).toHaveLength(1)
  })

  it('does not request accounts while discovering, and requests them only after selection', async () => {
    const selected = provider({ isRabby: true, request: vi.fn(async () => ['0x1111111111111111111111111111111111111111']) })
    const host = window as Window & { ethereum?: Eip1193Provider }
    host.ethereum = selected
    const registry = new ProviderRegistry(host)
    registries.push(registry)
    registry.start()
    expect(selected.request).not.toHaveBeenCalled()
    await requestAccounts(registry.snapshot()[0])
    expect(selected.request).toHaveBeenCalledTimes(1)
    expect(selected.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })
})
