import { useEffect, useRef, useState } from 'react'
import {
  type Eip1193Provider,
  type Eip6963ProviderInfo,
  type WalletId,
  type WalletOption,
  WALLET_CATALOG,
  SUPPORTED_WALLET_IDS,
  isAddress,
} from './types'

const ANNOUNCE_EVENT = 'eip6963:announceProvider'
const REQUEST_EVENT = 'eip6963:requestProvider'

function normalizedIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function walletIdFromEip6963(info: Pick<Eip6963ProviderInfo, 'name' | 'rdns'>): WalletId | null {
  const identity = `${normalizedIdentity(info.rdns)} ${normalizedIdentity(info.name)}`
  if (identity.includes('io.metamask') || identity.includes('metamask')) return 'metamask'
  if (identity.includes('okx') || identity.includes('okex')) return 'okx'
  if (identity.includes('rabby') || identity.includes('debank')) return 'rabby'
  return null
}

export function walletIdsFromLegacyProvider(provider: Eip1193Provider): WalletId[] {
  const matches: WalletId[] = []
  if (provider.isMetaMask === true) matches.push('metamask')
  if (provider.isOkxWallet === true || provider.isOKExWallet === true || provider.isOKXWallet === true) matches.push('okx')
  if (provider.isRabby === true) matches.push('rabby')
  return [...new Set(matches)]
}

function isProvider(value: unknown): value is Eip1193Provider {
  return typeof value === 'object' && value !== null && typeof (value as Eip1193Provider).request === 'function'
}

function validIcon(value: unknown): value is string {
  return typeof value === 'string' && /^(data:image\/|https?:\/\/)/i.test(value)
}

function sortOptions(options: WalletOption[]): WalletOption[] {
  return [...options].sort((left, right) => SUPPORTED_WALLET_IDS.indexOf(left.id) - SUPPORTED_WALLET_IDS.indexOf(right.id))
}

interface ProviderHost {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
  dispatchEvent(event: Event): boolean
  ethereum?: Eip1193Provider
}

export class ProviderRegistry {
  private options: WalletOption[] = []
  private listeners = new Set<(options: WalletOption[]) => void>()
  private started = false
  private readonly announceListener: EventListener

  constructor(private readonly host: ProviderHost) {
    this.announceListener = (event) => {
      const detail = (event as CustomEvent<{ info?: Eip6963ProviderInfo; provider?: Eip1193Provider }>).detail
      if (!detail?.info || !isProvider(detail.provider)) return
      const walletId = walletIdFromEip6963(detail.info)
      if (!walletId || typeof detail.info.uuid !== 'string') return
      this.upsert({
        id: walletId,
        label: WALLET_CATALOG[walletId].label,
        icon: validIcon(detail.info.icon) ? detail.info.icon : WALLET_CATALOG[walletId].icon,
        provider: detail.provider,
        source: 'eip6963',
        uuid: detail.info.uuid,
      })
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    // Register the page-lifetime listener before requesting announcements.
    this.host.addEventListener(ANNOUNCE_EVENT, this.announceListener)
    this.host.dispatchEvent(new CustomEvent(REQUEST_EVENT))
    this.scanLegacy()
  }

  stop(): void {
    if (!this.started) return
    this.host.removeEventListener(ANNOUNCE_EVENT, this.announceListener)
    this.started = false
  }

  subscribe(listener: (options: WalletOption[]) => void): () => void {
    this.listeners.add(listener)
    listener(sortOptions(this.options))
    return () => this.listeners.delete(listener)
  }

  snapshot(): WalletOption[] {
    return sortOptions(this.options)
  }

  private scanLegacy(): void {
    const ethereum = this.host.ethereum
    if (!ethereum) return
    const candidates = Array.isArray(ethereum.providers) && ethereum.providers.length > 0 ? ethereum.providers : [ethereum]
    for (const provider of candidates) {
      const identities = walletIdsFromLegacyProvider(provider)
      // A legacy provider with conflicting or missing flags is intentionally hidden.
      if (identities.length !== 1) continue
      const id = identities[0]
      this.upsert({
        id,
        label: WALLET_CATALOG[id].label,
        icon: WALLET_CATALOG[id].icon,
        provider,
        source: 'legacy',
      })
    }
  }

  private upsert(option: WalletOption): void {
    const sameProvider = this.options.findIndex((item) => item.provider === option.provider)
    const sameUuid = option.uuid ? this.options.findIndex((item) => item.uuid === option.uuid) : -1
    const existingIndex = sameProvider >= 0 ? sameProvider : sameUuid

    if (existingIndex >= 0) {
      const next = [...this.options]
      next[existingIndex] = { ...next[existingIndex], ...option }
      this.options = sortOptions(next)
      this.emit()
      return
    }

    if (option.source === 'eip6963') {
      // A named announcement is authoritative for that wallet and replaces its legacy fallback.
      this.options = this.options.filter((item) => !(item.id === option.id && item.source === 'legacy'))
    } else if (this.options.some((item) => item.id === option.id)) {
      return
    }

    this.options = sortOptions([...this.options, option])
    this.emit()
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export function createProviderRegistry(host: ProviderHost = window): ProviderRegistry {
  return new ProviderRegistry(host)
}

export async function requestAccounts(option: WalletOption): Promise<`0x${string}`[]> {
  const result = await option.provider.request({ method: 'eth_requestAccounts' })
  if (!Array.isArray(result)) throw new Error('WALLET_RETURNED_INVALID_ACCOUNTS')
  const accounts = result.filter(isAddress).map((account) => account as `0x${string}`)
  if (accounts.length !== result.length || accounts.length === 0) throw new Error('WALLET_RETURNED_INVALID_ACCOUNTS')
  return accounts
}

export function useWalletProviders(): WalletOption[] {
  const registryRef = useRef<ProviderRegistry | null>(null)
  const [options, setOptions] = useState<WalletOption[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const registry = createProviderRegistry(window)
    registryRef.current = registry
    const unsubscribe = registry.subscribe(setOptions)
    registry.start()
    return () => {
      unsubscribe()
      registry.stop()
      registryRef.current = null
    }
  }, [])

  return options
}
