import { createRpcAttemptBudget, RpcBudgetError, RpcReadQueue, sleepWithSignal, withRpcRetry } from './rpc'

describe('Studionet RPC budget', () => {
  it('serializes reads in FIFO order with one active operation', async () => {
    const queue = new RpcReadQueue()
    const order: string[] = []
    let active = 0
    let maximumActive = 0
    let releaseFirst: (() => void) | undefined
    const first = queue.run(() => new Promise<string>((resolve) => {
      order.push('first:start')
      active += 1
      maximumActive = Math.max(maximumActive, active)
      releaseFirst = () => {
        active -= 1
        order.push('first:end')
        resolve('one')
      }
    }))
    const second = queue.run(async () => {
      order.push('second')
      active += 1
      maximumActive = Math.max(maximumActive, active)
      active -= 1
      return 'two'
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst?.()
    await expect(first).resolves.toBe('one')
    await expect(second).resolves.toBe('two')
    expect(order).toEqual(['first:start', 'first:end', 'second'])
    expect(maximumActive).toBe(1)
  })

  it('drops an aborted queued read without issuing the RPC call', async () => {
    const queue = new RpcReadQueue()
    let releaseFirst: (() => void) | undefined
    const first = queue.run(() => new Promise<void>((resolve) => { releaseFirst = resolve }))
    const controller = new AbortController()
    const secondOperation = vi.fn(async () => 'never')
    const second = queue.run(secondOperation, controller.signal)
    await Promise.resolve()
    controller.abort()
    releaseFirst?.()
    await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(secondOperation).not.toHaveBeenCalled()
  })

  it('uses bounded exponential backoff with jitter for transient reads', async () => {
    let calls = 0
    const delays: number[] = []
    const transient = Object.assign(new Error('too many requests'), { status: 429 })

    await expect(withRpcRetry(async () => {
      calls += 1
      if (calls < 3) throw transient
      return 'ok'
    }, {
      random: () => 0,
      maxJitterMs: 0,
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })).resolves.toBe('ok')

    expect(calls).toBe(3)
    expect(delays).toEqual([500, 1_000])
  })

  it('respects a bounded Retry-After response before retrying', async () => {
    let calls = 0
    const delays: number[] = []
    const transient = {
      status: 429,
      response: { headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? '1' : null } },
    }

    await expect(withRpcRetry(async () => {
      calls += 1
      if (calls === 1) throw transient
      return 'ok'
    }, {
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })).resolves.toBe('ok')

    expect(delays).toEqual([1_000])
  })

  it('stops after the retry budget and reports RPC unavailability', async () => {
    let calls = 0
    const transient = Object.assign(new Error('server busy'), { status: 503 })

    await expect(withRpcRetry(async () => {
      calls += 1
      throw transient
    }, { sleep: async () => undefined })).rejects.toBeInstanceOf(RpcBudgetError)
    expect(calls).toBe(3)
  })

  it('counts retry attempts against an operation budget', async () => {
    const budget = createRpcAttemptBudget(2)
    let calls = 0
    const transient = Object.assign(new Error('too many requests'), { status: 429 })
    await expect(withRpcRetry(async () => {
      calls += 1
      throw transient
    }, {
      beforeAttempt: budget.spend,
      sleep: async () => undefined,
    })).rejects.toBeInstanceOf(RpcBudgetError)
    expect(calls).toBe(2)
    expect(budget.used()).toBe(2)
  })

  it('cancels a pending retry delay', async () => {
    const controller = new AbortController()
    const transient = Object.assign(new Error('timeout'), { status: 504 })

    await expect(withRpcRetry(async () => {
      throw transient
    }, {
      signal: controller.signal,
      sleep: async (_milliseconds, signal) => {
        controller.abort()
        await sleepWithSignal(0, signal)
      },
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
