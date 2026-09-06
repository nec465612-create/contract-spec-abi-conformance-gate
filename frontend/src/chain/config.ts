import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import type { Address } from 'genlayer-js/types'
import type { Eip1193Provider } from '../wallet/types'
import { installRpcFetchInstrumentation } from '../evidence/rpc-ledger'

export type ContractAddress = `0x${string}`
export type GenLayerClient = ReturnType<typeof createClient>
type CreateClientConfig = NonNullable<Parameters<typeof createClient>[0]>
type WalletProvider = Pick<Eip1193Provider, 'request'>

const configuredAddress = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? ''
const configuredRpcUrl = import.meta.env.VITE_GENLAYER_RPC_URL?.trim() ?? ''
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const RPC_URL_RE = /^https?:\/\/[^\s]+$/i

installRpcFetchInstrumentation()

export const contractAddress: ContractAddress | null = ADDRESS_RE.test(configuredAddress)
  ? (configuredAddress as ContractAddress)
  : null

export const rpcEndpoint = configuredRpcUrl.length > 0 && RPC_URL_RE.test(configuredRpcUrl) ? configuredRpcUrl : undefined
export const genlayerChain = studionet

export function runtimeConfigurationMessage(): string | null {
  if (!configuredAddress) return 'The contract address is not configured for this release.'
  if (!contractAddress) return 'The configured contract address is malformed.'
  if (configuredRpcUrl && !RPC_URL_RE.test(configuredRpcUrl)) return 'The configured network endpoint is malformed.'
  return null
}

function parseChainId(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value !== 'string') return null
  if (/^0x[0-9a-f]+$/i.test(value)) return BigInt(value)
  if (/^[0-9]+$/.test(value)) return BigInt(value)
  return null
}

export async function assertWalletContext(provider: WalletProvider, account: ContractAddress): Promise<void> {
  const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }))
  if (chainId !== BigInt(genlayerChain.id)) throw new Error('WRONG_NETWORK')
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (!Array.isArray(accounts) || accounts.length === 0 || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== account.toLowerCase()) {
    throw new Error('WALLET_ACCOUNT_CHANGED')
  }
}

const readClients = new Map<string, GenLayerClient>()
let writeClient: GenLayerClient | null = null
let writeClientKey = ''
let writeClientProvider: Eip1193Provider | null = null

function clientEndpoint(): Pick<CreateClientConfig, 'endpoint'> {
  return rpcEndpoint ? { endpoint: rpcEndpoint } : {}
}

export function getReadClient(account?: ContractAddress): GenLayerClient {
  const key = account?.toLowerCase() ?? ''
  const existing = readClients.get(key)
  if (existing) return existing
  const client = createClient({
    chain: genlayerChain,
    ...(account ? { account: account as Address } : {}),
    ...clientEndpoint(),
  })
  readClients.set(key, client)
  return client
}

export function getWriteClient(provider: Eip1193Provider, account: ContractAddress): GenLayerClient {
  const key = account.toLowerCase()
  if (!writeClient || writeClientKey !== key || writeClientProvider !== provider) {
    const clientProvider = provider as unknown as CreateClientConfig['provider']
    writeClient = createClient({
      chain: genlayerChain,
      account: account as Address,
      provider: clientProvider,
      ...clientEndpoint(),
    })
    writeClientKey = key
    writeClientProvider = provider
  }
  return writeClient
}
