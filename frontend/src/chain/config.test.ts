import { assertWalletContext, genlayerChain } from './config'

const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`

describe('selected wallet context', () => {
  it('checks the selected provider chain and account before signing', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? `0x${genlayerChain.id.toString(16)}` : [account])
    await expect(assertWalletContext({ request }, account)).resolves.toBeUndefined()
    expect(request).toHaveBeenNthCalledWith(1, { method: 'eth_chainId' })
    expect(request).toHaveBeenNthCalledWith(2, { method: 'eth_accounts' })
  })

  it('fails closed on a wrong chain or changed account', async () => {
    const wrongChain = vi.fn(async () => '0x1')
    await expect(assertWalletContext({ request: wrongChain }, account)).rejects.toThrow('WRONG_NETWORK')
    const changedAccount = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? genlayerChain.id : ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'])
    await expect(assertWalletContext({ request: changedAccount }, account)).rejects.toThrow('WALLET_ACCOUNT_CHANGED')
  })
})
