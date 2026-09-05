export type WalletId = 'metamask' | 'okx' | 'rabby'

export interface Eip1193Request {
  method: string
  params?: readonly unknown[] | Record<string, unknown>
}

export interface Eip1193Provider {
  request(args: Eip1193Request): Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
  isMetaMask?: boolean
  isOkxWallet?: boolean
  isOKExWallet?: boolean
  isOKXWallet?: boolean
  isRabby?: boolean
  providers?: Eip1193Provider[]
}

export interface Eip6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export interface WalletOption {
  id: WalletId
  label: string
  icon: string
  provider: Eip1193Provider
  source: 'eip6963' | 'legacy'
  uuid?: string
}

export interface WalletSession {
  id: WalletId
  label: string
  icon: string
  provider: Eip1193Provider
  account: `0x${string}`
}

export const WALLET_CATALOG: Readonly<Record<WalletId, { label: string; icon: string }>> = {
  metamask: { label: 'MetaMask', icon: '/wallet-icons/metamask.svg' },
  okx: { label: 'OKX Wallet', icon: '/wallet-icons/okx-wallet.svg' },
  rabby: { label: 'Rabby', icon: '/wallet-icons/rabby.svg' },
}

export const SUPPORTED_WALLET_IDS: readonly WalletId[] = ['metamask', 'okx', 'rabby']

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && ADDRESS_RE.test(value)
}
