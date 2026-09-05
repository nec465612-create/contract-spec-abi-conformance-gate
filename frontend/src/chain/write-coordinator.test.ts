import type { GenLayerClient } from './config'
import { withOneShotSubmission, WriteCoordinatorError } from './write-coordinator'

describe('frontend write submission guard', () => {
  it('stops an SDK fallback before a second transaction request', async () => {
    const sends: unknown[] = []
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_sendTransaction') {
        sends.push(method)
        if (sends.length === 1) throw new Error('invalid pointer in tuple')
      }
      return 'ok'
    })
    const client = { request } as unknown as GenLayerClient
    const send = (request: { method: string; params?: unknown[] }) =>
      (client.request as unknown as (value: { method: string; params?: unknown[] }) => Promise<unknown>)(request)

    await expect(withOneShotSubmission(client, async () => {
      try {
        await send({ method: 'eth_sendTransaction', params: [] })
      } catch {
        await send({ method: 'eth_sendTransaction', params: [] })
      }
      return 'unreachable'
    })).rejects.toMatchObject<Partial<WriteCoordinatorError>>({ code: 'MULTIPLE_SUBMISSION_ATTEMPT' })

    expect(sends).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('restores the client transport after a guarded submission', async () => {
    const request = vi.fn(async () => 'ok')
    const client = { request } as unknown as GenLayerClient
    const original = client.request
    const requestFromClient = (request: { method: string }) =>
      (client.request as unknown as (value: { method: string }) => Promise<unknown>)(request)

    await expect(withOneShotSubmission(client, async () => requestFromClient({ method: 'eth_gasPrice' }))).resolves.toBe('ok')
    expect(client.request).toBe(original)
  })
})
