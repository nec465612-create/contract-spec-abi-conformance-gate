import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginRpcEvidence, instrumentClientRequest, instrumentProvider, instrumentRpcFetch, withEvidenceRow } from './rpc-ledger'

describe('RPC evidence ledger', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'run-1' })
  })

  it('records requests but never their parameters or account results', async () => {
    beginRpcEvidence()
    const rawClient: { request(request: { method: string }): Promise<unknown> } = { request: vi.fn(async () => '0x' + 'a'.repeat(64)) }
    const client = instrumentClientRequest(rawClient)
    const provider = instrumentProvider({ request: vi.fn(async () => ['0xsecret']) })
    await withEvidenceRow('F4', async () => {
      await client.request({ method: 'gen_getTransaction' } as never)
      await provider.request({ method: 'eth_accounts', params: ['must-not-persist'] })
    })
    const stored = localStorage.getItem('genlayer-rpc-evidence-v1') ?? ''
    const ledger = JSON.parse(stored) as { events: Array<Record<string, unknown>> }
    expect(ledger.events).toMatchObject([
      { seq: 1, row: 'F4', channel: 'chain', method: 'gen_getTransaction', attempt: 1, status: 'SUCCESS' },
      { seq: 2, row: 'F4', channel: 'provider', method: 'eth_accounts', attempt: 1, status: 'SUCCESS' },
    ])
    expect(stored).not.toContain('must-not-persist')
    expect(stored).not.toContain('0xsecret')
  })

  it('records an exact Retry-After value on an error event', async () => {
    beginRpcEvidence()
    const client: { request(request: { method: string }): Promise<unknown> } = {
      request: vi.fn(async () => { throw { response: { headers: { 'Retry-After': '2.5' } } } }),
    }
    await expect(withEvidenceRow('F1', () => instrumentClientRequest(client).request({ method: 'gen_call' }))).rejects.toBeTruthy()
    const ledger = JSON.parse(localStorage.getItem('genlayer-rpc-evidence-v1') ?? '') as { events: Array<Record<string, unknown>> }
    expect(ledger.events[0]).toMatchObject({ row: 'F1', method: 'gen_call', status: 'ERROR', retryAfterMs: 2500 })
  })

  it('records GenLayerJS transport calls without retaining request parameters', async () => {
    beginRpcEvidence()
    const headers = new Headers()
    const rawFetch = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }), { status: 200, headers }))
    const measuredFetch = instrumentRpcFetch(rawFetch as typeof fetch)
    await withEvidenceRow('F1', () => measuredFetch('https://rpc.example', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gen_call', params: ['must-not-persist'] }),
    }))

    const stored = localStorage.getItem('genlayer-rpc-evidence-v1') ?? ''
    const ledger = JSON.parse(stored) as { events: Array<Record<string, unknown>> }
    expect(ledger.events).toMatchObject([{ row: 'F1', channel: 'chain', method: 'gen_call', status: 'SUCCESS' }])
    expect(stored).not.toContain('must-not-persist')
  })
})
