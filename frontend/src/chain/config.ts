import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import type { Address } from 'genlayer-js/types'
import type { Eip1193Provider } from '../wallet/types'

export type ContractAddress = `0x${string}`
export type GenLayerClient = ReturnType<typeof createClient>
type CreateClientConfig = NonNullable<Parameters<typeof createClient>[0]>

const configuredAddress = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? ''
const configuredRpcUrl = import.meta.env.VITE_GENLAYER_RPC_URL?.trim() ?? ''
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const RPC_URL_RE = /^https?:\/\/[^\s]+$/i

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

let readClient: GenLayerClient | null = null
let writeClient: GenLayerClient | null = null
let writeClientKey = ''
let writeClientProvider: Eip1193Provider | null = null

function clientEndpoint(): Pick<CreateClientConfig, 'endpoint'> {
  return rpcEndpoint ? { endpoint: rpcEndpoint } : {}
}

export function getReadClient(): GenLayerClient {
  if (!readClient) {
    readClient = createClient({ chain: genlayerChain, ...clientEndpoint() })
  }
  return readClient
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
