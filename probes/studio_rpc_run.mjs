import { createAccount, createClient } from '../frontend/node_modules/genlayer-js/dist/index.js'
import { studionet } from '../frontend/node_modules/genlayer-js/dist/chains/index.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATH = resolve(ROOT, 'contracts/main.py')
const ENDPOINT = process.env.STUDIO_RPC_ENDPOINT || 'https://studio.genlayer.com/api'
const EXPECTED_SOURCE_COMMIT = 'de66367b459ed421b73bdfb7f3d04bf15088ed38'
const EXPECTED_SOURCE_SHA256 = 'AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45'
const RUN_CONFIRM = 'CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN'
const STATUS_SCHEDULE_SECONDS = [10, 20, 40, 80]
const MAX_STATUS_CHECKS = STATUS_SCHEDULE_SECONDS.length
const MAX_OPERATION_REQUESTS = 16

if (process.env.STUDIO_RUN_CONFIRM !== RUN_CONFIRM) {
  throw new Error(`Set STUDIO_RUN_CONFIRM=${RUN_CONFIRM} to authorize this disposable measured run.`)
}

const source = await readFile(SOURCE_PATH, 'utf8')
const sourceSha256 = createHash('sha256').update(source).digest('hex').toUpperCase()
if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
  throw new Error(`Source hash mismatch: ${sourceSha256}`)
}
const sourceAtReviewedCommit = execFileSync('git', ['show', `${EXPECTED_SOURCE_COMMIT}:contracts/main.py`], { cwd: ROOT, encoding: 'utf8' })
const reviewedSha256 = createHash('sha256').update(sourceAtReviewedCommit).digest('hex').toUpperCase()
if (reviewedSha256 !== EXPECTED_SOURCE_SHA256) {
  throw new Error(`Reviewed source hash mismatch: ${reviewedSha256}`)
}

const base1 = {
  requirements: [{ id: 'read', text: 'Expose a read operation', polarity: 'REQUIRED' }],
  abi: [{ type: 'function', name: 'check', inputs: [], outputs: [], stateMutability: 'view' }],
}
const base2 = {
  requirements: [{ id: 'read', text: 'Expose a stable read operation', polarity: 'REQUIRED' }],
  abi: [{ type: 'function', name: 'check_v2', inputs: [], outputs: [], stateMutability: 'view' }],
}
const unknownBase = {
  requirements: [{
    id: 'unknown',
    text: 'Determine whether this contract satisfies a private external policy that is not provided in the input or represented by the ABI; the available data is intentionally insufficient.',
    polarity: 'REQUIRED',
  }],
  abi: [{ type: 'function', name: 'check_v2', inputs: [], outputs: [], stateMutability: 'view' }],
}

const operations = []
let currentOperation = null
let requestSequence = 0
const originalFetch = globalThis.fetch

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)).digest('hex')
}

function shape(value) {
  if (typeof value === 'string') return { type: 'string', bytes: Buffer.byteLength(value), sha256: digest(value) }
  if (Array.isArray(value)) return value.map(shape)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
  return typeof value
}

function retryAfter(responseText, response) {
  const header = response.headers.get('Retry-After')
  if (header) return header
  try {
    const parsed = JSON.parse(responseText)
    return parsed?.error?.data?.retry_after_seconds ?? parsed?.error?.retry_after_seconds ?? null
  } catch {
    return null
  }
}

globalThis.fetch = async (url, init) => {
  const requestStarted = Date.now()
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  const event = {
    sequence: ++requestSequence,
    at: new Date(requestStarted).toISOString(),
    operation: currentOperation?.id ?? 'unscoped',
    trigger: currentOperation?.trigger ?? 'unscoped',
    method: body.method ?? 'unknown',
    paramsShape: shape(body.params ?? []),
  }
  currentOperation?.events.push(event)
  if (currentOperation && currentOperation.events.length > MAX_OPERATION_REQUESTS) {
    throw new Error(`RPC operation budget exhausted before ${event.method}`)
  }
  try {
    const response = await originalFetch(url, init)
    const responseText = await response.clone().text()
    event.status = response.status
    event.durationMs = Date.now() - requestStarted
    event.retryAfter = retryAfter(responseText, response)
    try {
      const parsed = JSON.parse(responseText)
      if (parsed.error) event.error = { code: parsed.error.code ?? null, message: parsed.error.message ?? null }
      if (parsed.result !== undefined) {
        event.result = typeof parsed.result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(parsed.result)
          ? parsed.result
          : shape(parsed.result)
      }
    } catch {
      event.error = { message: 'non-json response' }
    }
    return response
  } catch (error) {
    event.durationMs = Date.now() - requestStarted
    event.error = { message: String(error) }
    throw error
  }
}

function startOperation(id, trigger) {
  if (currentOperation) throw new Error(`Nested operation: ${currentOperation.id}`)
  const operation = { id, trigger, startedAt: new Date().toISOString(), events: [], status: 'RUNNING' }
  operations.push(operation)
  currentOperation = operation
  return operation
}

async function finishOperation(operation, fn) {
  try {
    operation.result = jsonSafe(await fn())
    operation.status = 'PASS'
    return operation.result
  } catch (error) {
    operation.status = 'ERROR'
    operation.error = { message: String(error), code: error?.code ?? null }
    throw error
  } finally {
    operation.requestCount = operation.events.length
    operation.methods = Object.fromEntries([...new Set(operation.events.map((event) => event.method))].map((method) => [method, operation.events.filter((event) => event.method === method).length]))
    operation.endedAt = new Date().toISOString()
    currentOperation = null
  }
}

async function operation(id, trigger, fn) {
  const item = startOperation(id, trigger)
  return finishOperation(item, fn)
}

function isFinalized(transaction) {
  return transaction?.statusName === 'FINALIZED' || transaction?.status === 7 || transaction?.status === '7'
}

function isExecutionSuccess(transaction) {
  return transaction?.txExecutionResultName === 'FINISHED_WITH_RETURN' || transaction?.txExecutionResult === 1
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function waitForFinalized(client, operationId, hash) {
  const started = Date.now()
  let last = null
  for (const seconds of STATUS_SCHEDULE_SECONDS) {
    const delay = seconds * 1000 - (Date.now() - started)
    if (delay > 0) await wait(delay)
    last = await client.getTransaction({ hash })
    if (isFinalized(last)) return last
  }
  throw new Error(`FINALIZED not reached after ${MAX_STATUS_CHECKS} bounded checks for ${hash}: ${JSON.stringify(jsonSafe(last))}`)
}

async function readContract(client, address, functionName, args) {
  return client.readContract({ address, functionName, args })
}

function parseCase(value) {
  if (typeof value !== 'string') throw new Error(`Expected JSON case string, got ${typeof value}`)
  return JSON.parse(value)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const account = createAccount()
const client = createClient({ chain: studionet, endpoint: ENDPOINT, account })
const nonce1 = 'c0f03716fea36fa4643b82f9bde0faf0'
const nonce2 = '6c4158ea665e0aa601a5d0189180473e'
let contractAddress = null
const txs = []

try {
  await operation('S0-funding', 'fund one disposable account exactly once', async () => {
    return client.request({ method: 'sim_fundAccount', params: [account.address, 100000000000000000000] })
  })

  await operation('S0-preflight', 'check chain/account/balance once', async () => {
    const chainId = await client.request({ method: 'eth_chainId', params: [] })
    const balance = await client.request({ method: 'eth_getBalance', params: [account.address, 'latest'] })
    assert(chainId === '0xf22f', `Unexpected chain id ${chainId}`)
    return { chainId, account: account.address, balance }
  })

  await operation('S1-schema', 'verify exact source schema once before deployment', async () => {
    const schema = await client.getContractSchemaForCode(source)
    assert(Object.keys(schema.methods).length === 12, `Expected 12 methods, got ${Object.keys(schema.methods).length}`)
    return { methodCount: Object.keys(schema.methods).length, methodNames: Object.keys(schema.methods).sort() }
  })

  const deploy = await operation('S2-deploy', 'submit exact source once and await bounded finality', async () => {
    const hash = await client.deployContract({ account, code: source, args: [], consensusMaxRotations: 3 })
    const transaction = await waitForFinalized(client, 'S2-deploy', hash)
    contractAddress = transaction.recipient ?? transaction.to_address
    assert(typeof contractAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(contractAddress), `Missing deployed contract address for ${hash}`)
    const deployedCode = await client.getContractCode(contractAddress)
    const deployedSha256 = createHash('sha256').update(deployedCode).digest('hex').toUpperCase()
    assert(deployedSha256 === EXPECTED_SOURCE_SHA256, `Deployed source hash mismatch: ${deployedSha256}`)
    txs.push({ id: 'S2-deploy', hash, address: contractAddress, transaction: jsonSafe(transaction), deployedSha256 })
    return { hash, contractAddress, transaction, deployedSha256 }
  })

  const create1 = await operation('S3-create-case1', 'one unique create_case write plus two readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'create_case', args: [nonce1, JSON.stringify(base1), 0n], value: 0n })
    const transaction = await waitForFinalized(client, 'S3-create-case1', hash)
    assert(isExecutionSuccess(transaction), `create_case failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const id = await readContract(client, contractAddress, 'get_id_by_nonce', [account.address, nonce1])
    const record = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    assert(String(id) === '1' && record.revision === '1' && record.phase === 'BASE_DRAFT', 'create_case readback mismatch')
    txs.push({ id: 'S3-create-case1', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: { id, record } }
  })

  const replace = await operation('S4-replace-case1', 'one unique replace_base write plus current/history readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'replace_base', args: [1n, JSON.stringify(base2), 1n], value: 0n })
    const transaction = await waitForFinalized(client, 'S4-replace-case1', hash)
    assert(isExecutionSuccess(transaction), `replace_base failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 1n]))
    assert(current.revision === '2' && historical.revision === '1', 'replace_base history readback mismatch')
    txs.push({ id: 'S4-replace-case1', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: { current, historical } }
  })

  const freeze = await operation('S5-freeze-case1', 'one unique freeze_case write plus current/history readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'freeze_case', args: [1n, 2n], value: 0n })
    const transaction = await waitForFinalized(client, 'S5-freeze-case1', hash)
    assert(isExecutionSuccess(transaction), `freeze_case failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 2n]))
    assert(current.revision === '3' && current.phase === 'FROZEN' && historical.revision === '2', 'freeze_case readback mismatch')
    txs.push({ id: 'S5-freeze-case1', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: { current, historical } }
  })

  const evaluate = await operation('S6-evaluate-case1', 'one unique evaluate_case write plus semantic readback', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'evaluate_case', args: [1n, 3n], value: 0n })
    const transaction = await waitForFinalized(client, 'S6-evaluate-case1', hash)
    assert(isExecutionSuccess(transaction), `evaluate_case failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    assert(current.revision === '4' && current.phase === 'DONE' && current.outcome === 'CONFORMANT' && current.result?.labels?.[0] === 'IMPLEMENTS', 'evaluate_case semantic readback mismatch')
    txs.push({ id: 'S6-evaluate-case1', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: current }
  })

  const stale = await operation('S7-stale-negative', 'one unique stale negative write plus unchanged-state readback', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'replace_base', args: [1n, JSON.stringify(base2), 3n], value: 0n })
    const transaction = await waitForFinalized(client, 'S7-stale-negative', hash)
    assert(!isExecutionSuccess(transaction), 'stale negative unexpectedly succeeded')
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    assert(current.revision === '4', 'stale negative changed current state')
    txs.push({ id: 'S7-stale-negative', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: current }
  })

  const create2 = await operation('S8-create-case2', 'one unique unknown-fixture create_case write plus two readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'create_case', args: [nonce2, JSON.stringify(unknownBase), 0n], value: 0n })
    const transaction = await waitForFinalized(client, 'S8-create-case2', hash)
    assert(isExecutionSuccess(transaction), `case2 create failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const id = await readContract(client, contractAddress, 'get_id_by_nonce', [account.address, nonce2])
    const record = parseCase(await readContract(client, contractAddress, 'get_case', [2n]))
    assert(String(id) === '2' && record.revision === '1' && record.phase === 'BASE_DRAFT', 'case2 create readback mismatch')
    txs.push({ id: 'S8-create-case2', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: { id, record } }
  })

  const freeze2 = await operation('S9-freeze-case2', 'one unique freeze_case write plus semantic phase readback', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'freeze_case', args: [2n, 1n], value: 0n })
    const transaction = await waitForFinalized(client, 'S9-freeze-case2', hash)
    assert(isExecutionSuccess(transaction), `case2 freeze failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const record = parseCase(await readContract(client, contractAddress, 'get_case', [2n]))
    assert(record.revision === '2' && record.phase === 'FROZEN', 'case2 freeze readback mismatch')
    txs.push({ id: 'S9-freeze-case2', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: record }
  })

  const evaluate2 = await operation('S10-evaluate-case2', 'one unique unknown evaluate_case write plus semantic readback', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'evaluate_case', args: [2n, 2n], value: 0n })
    const transaction = await waitForFinalized(client, 'S10-evaluate-case2', hash)
    assert(isExecutionSuccess(transaction), `case2 evaluate failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const record = parseCase(await readContract(client, contractAddress, 'get_case', [2n]))
    assert(record.revision === '3' && record.phase === 'UNRESOLVED' && record.outcome === 'UNRESOLVED' && record.result?.labels?.[0] === 'UNKNOWN', 'case2 unknown readback mismatch')
    txs.push({ id: 'S10-evaluate-case2', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: record }
  })

  const case2Record = await readContract(client, contractAddress, 'get_case', [2n])
  const acceptedAt = Number(parseCase(case2Record).last_accepted_at) * 1000
  const cooldownMs = Math.max(0, acceptedAt + 60_000 + 2_000 - Date.now())
  await wait(cooldownMs)

  const retry = await operation('S11-retry-case2', `one retry after ${Math.ceil(cooldownMs / 1000)}s cooldown plus semantic readback`, async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'retry_case', args: [2n, 3n], value: 0n })
    const transaction = await waitForFinalized(client, 'S11-retry-case2', hash)
    assert(isExecutionSuccess(transaction), `case2 retry failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const record = parseCase(await readContract(client, contractAddress, 'get_case', [2n]))
    assert(record.revision === '4' && record.phase === 'UNRESOLVED' && record.outcome === 'UNRESOLVED' && record.accepted_attempts === 2 && record.result?.labels?.[0] === 'UNKNOWN', 'case2 retry readback mismatch')
    txs.push({ id: 'S11-retry-case2', hash, transaction: jsonSafe(transaction) })
    return { hash, transaction, readback: record }
  })

  const reconciliation = await operation('S12-reconciliation', 'one explicit retained-hash receipt lookup and three authoritative readbacks', async () => {
    const receipt = await client.getTransaction({ hash: evaluate.hash })
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    const count = await readContract(client, contractAddress, 'get_count', [])
    const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 1n]))
    assert(isFinalized(receipt) && current.revision === '4' && String(count) === '2' && historical.revision === '1', 'reconciliation readback mismatch')
    return { receipt, readback: { current, count, historical } }
  })

  const evidence = {
    status: 'PASS',
    exactSourceCommit: EXPECTED_SOURCE_COMMIT,
    sourceSha256: EXPECTED_SOURCE_SHA256,
    chainId: 61999,
    endpoint: ENDPOINT,
    account: account.address,
    contractAddress,
    transactionCount: txs.length,
    transactions: txs,
    operations,
    reconciliation,
    generatedAt: new Date().toISOString(),
  }
  const outputPath = resolve(ROOT, 'docs', 'evidence', `studio-rpc-run-${Date.now()}.json`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: evidence.status, outputPath, contractAddress, account: account.address, transactionCount: txs.length, requests: operations.reduce((sum, item) => sum + item.requestCount, 0) }, null, 2))
} catch (error) {
  const evidence = {
    status: 'BLOCKED',
    exactSourceCommit: EXPECTED_SOURCE_COMMIT,
    sourceSha256: EXPECTED_SOURCE_SHA256,
    chainId: 61999,
    endpoint: ENDPOINT,
    account: account.address,
    contractAddress,
    transactionCount: txs.length,
    transactions: txs,
    operations,
    error: { message: String(error), code: error?.code ?? null },
    generatedAt: new Date().toISOString(),
  }
  const outputPath = resolve(ROOT, 'docs', 'evidence', `studio-rpc-run-${Date.now()}.json`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify({ status: evidence.status, outputPath, contractAddress, account: account.address, transactionCount: txs.length, error: evidence.error }, null, 2))
  process.exitCode = 1
}
