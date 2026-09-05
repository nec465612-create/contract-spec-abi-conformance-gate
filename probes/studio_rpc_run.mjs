import { createAccount, createClient } from '../frontend/node_modules/genlayer-js/dist/index.js'
import { studionet } from '../frontend/node_modules/genlayer-js/dist/chains/index.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATH = resolve(ROOT, 'contracts/main.py')
const EXACT_STUDIO_RPC_ENDPOINT = 'https://studio.genlayer.com/api'
const requestedEndpoint = process.env.STUDIO_RPC_ENDPOINT
const ENDPOINT = EXACT_STUDIO_RPC_ENDPOINT
const EXPECTED_SOURCE_COMMIT = 'cd833b78b43e22661ade6a4dddad3fc4269eb07a'
const EXPECTED_SOURCE_SHA256 = 'E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F'
const RESUME_MANIFEST_PATH = resolve(ROOT, 'docs/evidence/studio-rpc-recovery-manifest.json')
const RUN_CONFIRM = 'CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN'
const STUDIO_PRIVATE_KEY_ENV = 'CONTRACT_SPEC_ABI_GATE_STUDIO_PRIVATE_KEY'
const configuredPrivateKey = process.env[STUDIO_PRIVATE_KEY_ENV] ?? null
const STATUS_SCHEDULE_SECONDS = [10, 20, 40, 80]
const MAX_STATUS_CHECKS = STATUS_SCHEDULE_SECONDS.length
const REQUEST_TIMEOUT_MS = 30_000
const OPERATION_TIMEOUT_MS = 240_000
const RETAINED_PARTIAL_EVIDENCE = Object.freeze({
  file: 'studio-rpc-run-1788639450020.json',
  sha256: 'CD5084333797668CA3C13852B51E859111E0C2E264B806A6A1544116FBA68C7C',
})
const RETAINED_PARTIAL_READBACK = Object.freeze({
  file: 'studio-adapted-partial-reconciliation-1788639450020.json',
  sha256: 'A785FEE34E60495EB96B24589942195CC3184B1F18FA2DCA5C38C592DB1068B6',
})
const RETAINED_FINAL_EVIDENCE = Object.freeze({
  file: 'studio-rpc-run-1788641657001.json',
  sha256: 'C516A0E3F178AA99B5E936DFDA5F6729C23E0D6F3592E9CDF358BA79055187FA',
})
const OPERATION_REQUEST_CAPS = Object.freeze({
  'S0-funding': 1,
  'S0-preflight': 2,
  'S1-schema': 1,
  'S2-deploy': 13,
  'S3-create-case1': 14,
  'S4-replace-case1': 14,
  'S5-freeze-case1': 14,
  'S6-stale-negative': 13,
  'S7-reconciliation': 4,
})

const operations = []
const allEvents = []
let currentOperation = null
let requestSequence = 0
let contractAddress = null
const txs = []
let source = null
let sourceSha256 = null
const requestedResumeHash = process.env.STUDIO_RESUME_DEPLOYMENT_HASH ?? null
const requestedResumeAddress = process.env.STUDIO_RESUME_CONTRACT_ADDRESS ?? null
const requestedRestart = process.env.STUDIO_RESTART_PARTIAL_RUN ?? null
const requestedPartialResume = process.env.STUDIO_PARTIAL_RESUME ?? null
const requestedPartialEvidencePath = process.env.STUDIO_PARTIAL_EVIDENCE_PATH ?? null
const requestedPartialReadbackPath = process.env.STUDIO_PARTIAL_READBACK_PATH ?? null
const requestedFinalReconcile = process.env.STUDIO_FINAL_RECONCILE ?? null
const requestedFinalEvidencePath = process.env.STUDIO_FINAL_EVIDENCE_PATH ?? null
const RESUME_MODE = Boolean(requestedResumeHash || requestedResumeAddress)
const RESTART_MODE = Boolean(requestedRestart)
const PARTIAL_RESUME_MODE = Boolean(requestedPartialResume || requestedPartialEvidencePath || requestedPartialReadbackPath)
const FINAL_RECONCILE_MODE = Boolean(requestedFinalReconcile || requestedFinalEvidencePath)
let resumeEvidenceSummary = null
let partialEvidence = null
let partialReadbackEvidence = null
let finalEvidence = null
let approvedResumeHash = null
let approvedResumeAddress = null
let approvedDeploymentAccount = null
let approvedDeploymentEvidence = null

const base1 = {
  requirements: [{ id: 'read', text: 'Expose this exact read operation', polarity: 'REQUIRED', signature: 'check()->():view' }],
  abi: [{ type: 'function', name: 'check', inputs: [], outputs: [], stateMutability: 'view' }],
}
const base2 = {
  requirements: [{ id: 'read', text: 'Expose this exact stable read operation', polarity: 'REQUIRED', signature: 'check_v2()->():view' }],
  abi: [{ type: 'function', name: 'check_v2', inputs: [], outputs: [], stateMutability: 'view' }],
}

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

function sourceBindingMatches(value) {
  return value &&
    typeof value.sourceCommit === 'string' &&
    typeof value.sourceSha256 === 'string' &&
    value.sourceCommit.toLowerCase() === EXPECTED_SOURCE_COMMIT.toLowerCase() &&
    value.sourceSha256.toLowerCase() === EXPECTED_SOURCE_SHA256.toLowerCase()
}

function hashMatches(value, expected) {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase()
}

function resolveEvidencePath(value, label, retained) {
  if (value !== retained.file) throw new Error(`${label} must equal retained evidence file ${retained.file}.`)
  return resolve(ROOT, 'docs', 'evidence', value)
}

async function readRetainedEvidence(path, label, retained) {
  const bytes = await readFile(path)
  const actualSha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase()
  if (actualSha256 !== retained.sha256) throw new Error(`${label} hash mismatch: ${actualSha256}`)
  return JSON.parse(bytes.toString('utf8'))
}

async function writeEvidenceFile(evidence) {
  const outputPath = resolve(ROOT, 'docs', 'evidence', `studio-rpc-run-${Date.now()}.json`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return outputPath
}

function blockedEvidence(error, accountAddress = null) {
  return {
    status: 'BLOCKED',
    exactSourceCommit: EXPECTED_SOURCE_COMMIT,
    sourceSha256,
    expectedSourceSha256: EXPECTED_SOURCE_SHA256,
    chainId: 61999,
    endpoint: ENDPOINT,
    account: accountAddress,
    contractAddress,
    transactionCount: txs.length,
    transactions: txs,
    operations,
    rpcRequests: allEvents,
    requestSequence,
    resumeMode: RESUME_MODE,
    restartMode: RESTART_MODE,
    partialResumeMode: PARTIAL_RESUME_MODE,
    finalReconcileMode: FINAL_RECONCILE_MODE,
    resumeEvidence: resumeEvidenceSummary,
    error: { message: String(error), code: error?.code ?? null },
    generatedAt: new Date().toISOString(),
  }
}

let preflightError = null
try {
  if (process.env.STUDIO_RUN_CONFIRM !== RUN_CONFIRM) {
    throw new Error(`Set STUDIO_RUN_CONFIRM=${RUN_CONFIRM} to authorize this disposable measured run.`)
  }
  if (requestedEndpoint && requestedEndpoint !== EXACT_STUDIO_RPC_ENDPOINT) {
    throw new Error(`STUDIO_RPC_ENDPOINT must equal ${EXACT_STUDIO_RPC_ENDPOINT}; refusing redirected RPC.`)
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(configuredPrivateKey ?? '')) {
    throw new Error(`${STUDIO_PRIVATE_KEY_ENV} must provide the selected disposable signer key; refusing an unbound account.`)
  }
  source = await readFile(SOURCE_PATH, 'utf8')
  sourceSha256 = createHash('sha256').update(source).digest('hex').toUpperCase()
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Source hash mismatch: ${sourceSha256}`)
  }
  const sourceAtReviewedCommit = execFileSync('git', ['show', `${EXPECTED_SOURCE_COMMIT}:contracts/main.py`], { cwd: ROOT, encoding: 'utf8' })
  const reviewedSha256 = createHash('sha256').update(sourceAtReviewedCommit).digest('hex').toUpperCase()
  if (reviewedSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Reviewed source hash mismatch: ${reviewedSha256}`)
  }
  if (Boolean(requestedResumeHash) !== Boolean(requestedResumeAddress)) {
    throw new Error('Resume mode requires both STUDIO_RESUME_DEPLOYMENT_HASH and STUDIO_RESUME_CONTRACT_ADDRESS.')
  }
  if (RESUME_MODE && RESTART_MODE) {
    throw new Error('Resume mode and partial-run restart mode are mutually exclusive.')
  }
  if (PARTIAL_RESUME_MODE && (RESUME_MODE || RESTART_MODE)) {
    throw new Error('Partial continuation cannot be combined with resume or replacement restart mode.')
  }
  if (FINAL_RECONCILE_MODE && (RESUME_MODE || RESTART_MODE || PARTIAL_RESUME_MODE)) {
    throw new Error('Final reconciliation cannot be combined with resume, replacement restart, or write continuation mode.')
  }
  if (RESTART_MODE && requestedRestart !== RUN_CONFIRM) {
    throw new Error(`Set STUDIO_RESTART_PARTIAL_RUN=${RUN_CONFIRM} to authorize a replacement disposable run.`)
  }
  if (PARTIAL_RESUME_MODE && requestedPartialResume !== RUN_CONFIRM) {
    throw new Error(`Set STUDIO_PARTIAL_RESUME=${RUN_CONFIRM} to authorize continuation from retained partial evidence.`)
  }
  if (PARTIAL_RESUME_MODE && (!requestedPartialEvidencePath || !requestedPartialReadbackPath)) {
    throw new Error('Partial continuation requires both STUDIO_PARTIAL_EVIDENCE_PATH and STUDIO_PARTIAL_READBACK_PATH.')
  }
  if (FINAL_RECONCILE_MODE && requestedFinalReconcile !== RUN_CONFIRM) {
    throw new Error(`Set STUDIO_FINAL_RECONCILE=${RUN_CONFIRM} to authorize read-only reconciliation from retained final evidence.`)
  }
  if (FINAL_RECONCILE_MODE && !requestedFinalEvidencePath) {
    throw new Error('Final reconciliation requires STUDIO_FINAL_EVIDENCE_PATH.')
  }
  if (!RESUME_MODE && !RESTART_MODE) {
    try {
      const existingManifest = JSON.parse(await readFile(RESUME_MANIFEST_PATH, 'utf8'))
      if (
        !existingManifest ||
        typeof existingManifest !== 'object' ||
        Array.isArray(existingManifest) ||
        typeof existingManifest.sourceCommit !== 'string' ||
        !/^[0-9a-fA-F]{40}$/.test(existingManifest.sourceCommit) ||
        typeof existingManifest.sourceSha256 !== 'string' ||
        !/^[0-9a-fA-F]{64}$/.test(existingManifest.sourceSha256)
      ) {
        throw new Error('Existing recovery manifest has an invalid source binding; refusing to classify or reuse it.')
      }
      if (sourceBindingMatches(existingManifest)) {
        throw new Error('A finalized partial deployment manifest exists for the current source; refusing a second deployment. Use the approved resume or explicit partial-run restart mode.')
      }
      resumeEvidenceSummary = {
        historicalManifestIgnored: true,
        manifest: 'docs/evidence/studio-rpc-recovery-manifest.json',
        manifestSourceCommit: existingManifest.sourceCommit ?? null,
        manifestSourceSha256: existingManifest.sourceSha256 ?? null,
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  if (PARTIAL_RESUME_MODE) {
    const partialEvidenceFile = resolveEvidencePath(requestedPartialEvidencePath, 'STUDIO_PARTIAL_EVIDENCE_PATH', RETAINED_PARTIAL_EVIDENCE)
    const partialReadbackFile = resolveEvidencePath(requestedPartialReadbackPath, 'STUDIO_PARTIAL_READBACK_PATH', RETAINED_PARTIAL_READBACK)
    const prior = await readRetainedEvidence(partialEvidenceFile, 'STUDIO_PARTIAL_EVIDENCE_PATH', RETAINED_PARTIAL_EVIDENCE)
    const readback = await readRetainedEvidence(partialReadbackFile, 'STUDIO_PARTIAL_READBACK_PATH', RETAINED_PARTIAL_READBACK)
    const expectedOperations = ['S0-funding', 'S0-preflight', 'S1-schema', 'S2-deploy', 'S3-create-case1']
    const priorOperations = prior.operations?.map((item) => item.id)
    const deploymentRow = prior.transactions?.find((item) => item.id === 'S2-deploy')
    const createRow = prior.transactions?.find((item) => item.id === 'S3-create-case1')
    const expectedAccount = createAccount(configuredPrivateKey).address
    if (
      prior.status !== 'BLOCKED' ||
      !sourceBindingMatches({ sourceCommit: prior.exactSourceCommit, sourceSha256: prior.sourceSha256 }) ||
      prior.endpoint !== EXACT_STUDIO_RPC_ENDPOINT ||
      prior.account?.toLowerCase() !== expectedAccount.toLowerCase() ||
      prior.chainId !== 61999 ||
      !/^0x[0-9a-fA-F]{40}$/.test(prior.contractAddress ?? '') ||
      JSON.stringify(priorOperations) !== JSON.stringify(expectedOperations) ||
      prior.requestSequence !== prior.rpcRequests?.length ||
      prior.requestSequence !== prior.operations?.reduce((total, item) => total + item.requestCount, 0) ||
      !prior.rpcRequests?.every((event) => event.operation && event.operation !== 'unscoped') ||
      !prior.operations?.every((item) => item.requestCount <= OPERATION_REQUEST_CAPS[item.id] && item.budgetWithinCap && item.allEventsRetained) ||
      prior.transactionCount !== 2 ||
      prior.transactionCount !== prior.transactions?.length ||
      !deploymentRow ||
      !createRow ||
      !/^0x[0-9a-fA-F]{64}$/.test(deploymentRow.hash ?? '') ||
      !/^0x[0-9a-fA-F]{64}$/.test(createRow.hash ?? '') ||
      deploymentRow.deployedSha256?.toLowerCase() !== EXPECTED_SOURCE_SHA256.toLowerCase() ||
      deploymentRow.address?.toLowerCase() !== prior.contractAddress.toLowerCase() ||
      deploymentRow.deploymentAccount?.toLowerCase() !== expectedAccount.toLowerCase() ||
      deploymentRow.transaction?.from_address?.toLowerCase() !== expectedAccount.toLowerCase() ||
      !isFinalized(deploymentRow.transaction) ||
      !isFinalized(createRow.transaction) ||
      String(createRow.transaction?.result_name ?? '').toUpperCase() !== 'MAJORITY_AGREE' ||
      !isExecutionSuccess(createRow.transaction) ||
      readback.status !== 'PASS' ||
      readback.endpoint !== EXACT_STUDIO_RPC_ENDPOINT ||
      readback.sourceSha256?.toLowerCase() !== EXPECTED_SOURCE_SHA256.toLowerCase() ||
      readback.contractAddress?.toLowerCase() !== prior.contractAddress.toLowerCase() ||
      readback.account?.toLowerCase() !== expectedAccount.toLowerCase() ||
      readback.requestCount !== readback.rpcRequests?.length ||
      !readback.rpcRequests?.every((event) => event.method === 'gen_call' && !event.transactionHash) ||
      readback.readback?.id !== '1' ||
      readback.readback?.count !== '1' ||
      readback.readback?.record?.revision !== '1' ||
      readback.readback?.record?.phase !== 'BASE_DRAFT'
    ) {
      throw new Error('Retained partial evidence/readback is not an exact current-source continuation boundary.')
    }
    partialEvidence = prior
    partialReadbackEvidence = readback
    contractAddress = prior.contractAddress
    resumeEvidenceSummary = {
      mode: 'partial-continuation',
      priorEvidenceFile: `docs/evidence/${requestedPartialEvidencePath}`,
      priorReadbackFile: `docs/evidence/${requestedPartialReadbackPath}`,
      priorRequestSequence: prior.requestSequence,
      priorTransactionCount: prior.transactionCount,
      reclassifiedOperation: 'S3-create-case1',
      reclassification: 'FINALIZED_MAJORITY_AGREE_READBACK_CONFIRMED',
    }
  }
  if (FINAL_RECONCILE_MODE) {
    const finalEvidenceFile = resolveEvidencePath(requestedFinalEvidencePath, 'STUDIO_FINAL_EVIDENCE_PATH', RETAINED_FINAL_EVIDENCE)
    const prior = await readRetainedEvidence(finalEvidenceFile, 'STUDIO_FINAL_EVIDENCE_PATH', RETAINED_FINAL_EVIDENCE)
    const expectedOperations = ['S0-funding', 'S0-preflight', 'S1-schema', 'S2-deploy', 'S3-create-case1', 'S4-replace-case1', 'S5-freeze-case1', 'S6-stale-negative']
    const expectedTransactions = ['S2-deploy', 'S3-create-case1', 'S4-replace-case1', 'S5-freeze-case1', 'S6-stale-negative']
    const priorOperations = prior.operations?.map((item) => item.id)
    const priorTransactions = prior.transactions?.map((item) => item.id)
    const deploymentRow = prior.transactions?.find((item) => item.id === 'S2-deploy')
    const createRow = prior.transactions?.find((item) => item.id === 'S3-create-case1')
    const replaceRow = prior.transactions?.find((item) => item.id === 'S4-replace-case1')
    const freezeRow = prior.transactions?.find((item) => item.id === 'S5-freeze-case1')
    const staleRow = prior.transactions?.find((item) => item.id === 'S6-stale-negative')
    const expectedAccount = createAccount(configuredPrivateKey).address
    if (
      prior.status !== 'BLOCKED' ||
      !sourceBindingMatches({ sourceCommit: prior.exactSourceCommit, sourceSha256: prior.sourceSha256 }) ||
      prior.endpoint !== EXACT_STUDIO_RPC_ENDPOINT ||
      prior.account?.toLowerCase() !== expectedAccount.toLowerCase() ||
      prior.chainId !== 61999 ||
      !/^0x[0-9a-fA-F]{40}$/.test(prior.contractAddress ?? '') ||
      JSON.stringify(priorOperations) !== JSON.stringify(expectedOperations) ||
      JSON.stringify(priorTransactions) !== JSON.stringify(expectedTransactions) ||
      prior.requestSequence !== prior.rpcRequests?.length ||
      prior.requestSequence !== prior.operations?.reduce((total, item) => total + item.requestCount, 0) ||
      !prior.rpcRequests?.every((event) => event.operation && event.operation !== 'unscoped') ||
      !prior.operations?.every((item) => item.requestCount <= OPERATION_REQUEST_CAPS[item.id] && item.budgetWithinCap && item.allEventsRetained) ||
      prior.transactionCount !== 5 ||
      prior.transactionCount !== prior.transactions?.length ||
      !deploymentRow || !createRow || !replaceRow || !freezeRow || !staleRow ||
      !prior.transactions.every((item) => /^0x[0-9a-fA-F]{64}$/.test(item.hash ?? '') && isFinalized(item.transaction)) ||
      deploymentRow.deployedSha256?.toLowerCase() !== EXPECTED_SOURCE_SHA256.toLowerCase() ||
      deploymentRow.address?.toLowerCase() !== prior.contractAddress.toLowerCase() ||
      deploymentRow.deploymentAccount?.toLowerCase() !== expectedAccount.toLowerCase() ||
      deploymentRow.transaction?.from_address?.toLowerCase() !== expectedAccount.toLowerCase() ||
      !isExecutionSuccess(createRow.transaction) ||
      !isExecutionSuccess(replaceRow.transaction) ||
      !isExecutionSuccess(freezeRow.transaction) ||
      !isExecutionError(staleRow.transaction) ||
      !hasExpectedStaleError(staleRow.transaction) ||
      prior.operations.find((item) => item.id === 'S6-stale-negative')?.status !== 'ERROR'
    ) {
      throw new Error('Retained final evidence is not an exact current-source read-only reconciliation boundary.')
    }
    finalEvidence = prior
    contractAddress = prior.contractAddress
    resumeEvidenceSummary = {
      mode: 'final-read-only-reconciliation',
      priorEvidenceFile: `docs/evidence/${requestedFinalEvidencePath}`,
      priorRequestSequence: prior.requestSequence,
      priorTransactionCount: prior.transactionCount,
      retainedWriteOperations: ['S2-deploy', 'S3-create-case1', 'S4-replace-case1', 'S5-freeze-case1', 'S6-stale-negative'],
      nextOperation: 'S7-reconciliation',
    }
  }
  if (RESUME_MODE || RESTART_MODE) {
    const manifest = JSON.parse(await readFile(RESUME_MANIFEST_PATH, 'utf8'))
    const manifestDeploymentHash = manifest.deployment?.hash
    const manifestContractAddress = manifest.deployment?.contractAddress
    const manifestDeploymentAccount = manifest.deployment?.account
    const deploymentEvidenceFile = manifest.priorRun?.fullEvidenceFile
    if (
      !['BLOCKED_PARTIAL', 'BLOCKED_PARTIAL_CASE_ACCEPTED'].includes(manifest.status) ||
      !sourceBindingMatches(manifest) ||
      manifest.chainId !== 61999 ||
      manifest.endpoint !== EXACT_STUDIO_RPC_ENDPOINT ||
      !/^0x[0-9a-fA-F]{64}$/.test(manifestDeploymentHash ?? '') ||
      !/^0x[0-9a-fA-F]{40}$/.test(manifestContractAddress ?? '') ||
      !/^0x[0-9a-fA-F]{40}$/.test(manifestDeploymentAccount ?? '') ||
      !/^studio-rpc-run-\d+\.json$/.test(deploymentEvidenceFile ?? '') ||
      manifest.deployment?.status !== 'FINALIZED' ||
      !hashMatches(manifest.deployment?.sourceReadbackSha256, EXPECTED_SOURCE_SHA256)
    ) {
      throw new Error('Resume manifest does not match the approved finalized deployment.')
    }
    const deploymentEvidence = JSON.parse(await readFile(resolve(ROOT, 'docs', 'evidence', deploymentEvidenceFile), 'utf8'))
    const deploymentRow = deploymentEvidence.transactions?.find((item) => item.id === 'S2-deploy')
    const schemaOperation = deploymentEvidence.operations?.find((item) => item.id === 'S1-schema')
    if (
      !sourceBindingMatches({ sourceCommit: deploymentEvidence.exactSourceCommit, sourceSha256: deploymentEvidence.sourceSha256 }) ||
      deploymentEvidence.contractAddress?.toLowerCase() !== manifestContractAddress.toLowerCase() ||
      deploymentRow?.hash?.toLowerCase() !== manifestDeploymentHash.toLowerCase() ||
      deploymentRow?.deploymentAccount?.toLowerCase() !== manifestDeploymentAccount.toLowerCase() ||
      !hashMatches(deploymentRow?.deployedSha256, EXPECTED_SOURCE_SHA256) ||
      deploymentRow?.transaction?.statusName !== 'FINALIZED' ||
      schemaOperation?.status !== 'PASS' ||
      schemaOperation?.result?.methodCount !== 10
    ) {
      throw new Error('Resume deployment evidence does not prove the approved finalized source binding.')
    }
    if (RESUME_MODE && requestedResumeHash.toLowerCase() !== manifestDeploymentHash.toLowerCase()) {
      throw new Error(`Resume deployment hash does not match the manifest deployment: ${requestedResumeHash}`)
    }
    if (RESUME_MODE && requestedResumeAddress.toLowerCase() !== manifestContractAddress.toLowerCase()) {
      throw new Error(`Resume contract address does not match the manifest deployment: ${requestedResumeAddress}`)
    }
    if (RESUME_MODE && manifest.status !== 'BLOCKED_PARTIAL') {
      throw new Error('The manifest deployment already has an accepted owner-bound case write; resume is unavailable.')
    }
    if (RESTART_MODE && manifest.status !== 'BLOCKED_PARTIAL_CASE_ACCEPTED') {
      throw new Error('Partial-run restart is allowed only for an accepted owner-bound partial; use the exact resume pair for BLOCKED_PARTIAL.')
    }
    approvedResumeHash = manifestDeploymentHash
    approvedResumeAddress = manifestContractAddress
    approvedDeploymentAccount = manifestDeploymentAccount
    approvedDeploymentEvidence = deploymentRow
    resumeEvidenceSummary = {
      manifest: 'docs/evidence/studio-rpc-recovery-manifest.json',
      deploymentHash: approvedResumeHash,
      contractAddress: approvedResumeAddress,
      mode: RESTART_MODE ? 'replacement' : 'resume',
      manifestStatus: manifest.status,
      deploymentEvidenceFile,
      reusedFinalizedEvidence: true,
      priorRequestSequence: manifest.priorRun?.requestSequence ?? null,
      priorTransactionCount: manifest.priorRun?.transactionCount ?? null,
      priorBlockedAt: manifest.priorRun?.blockedAt ?? null,
    }
  }
} catch (error) {
  preflightError = error
}

if (preflightError) {
  const evidence = blockedEvidence(preflightError)
  const outputPath = await writeEvidenceFile(evidence)
  console.error(JSON.stringify({ status: evidence.status, outputPath, transactionCount: evidence.transactionCount, requests: requestSequence, error: evidence.error }, null, 2))
  process.exit(1)
}

function isSubmissionMethod(method) {
  return method === 'eth_sendTransaction' || method === 'eth_sendRawTransaction'
}

globalThis.fetch = async (url, init) => {
  const requestStarted = Date.now()
  let body = {}
  try {
    body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  } catch {
    body = {}
  }
  if (!currentOperation) throw new Error('RPC request attempted outside a measured operation.')
  if (Date.now() >= currentOperation.deadlineAt) throw new Error(`RPC operation deadline exceeded before ${body.method ?? 'unknown'}`)
  if (currentOperation.events.length >= currentOperation.maxRequests) {
    throw new Error(`RPC operation budget exhausted before ${body.method ?? 'unknown'}`)
  }
  if (isSubmissionMethod(body.method) && currentOperation.submissionAttempted) {
    throw new Error(`One-shot submission guard blocked duplicate ${body.method}`)
  }
  if (isSubmissionMethod(body.method)) currentOperation.submissionAttempted = true
  const event = {
    sequence: ++requestSequence,
    at: new Date(requestStarted).toISOString(),
    operation: currentOperation.id,
    trigger: currentOperation.trigger,
    method: body.method ?? 'unknown',
    paramsShape: shape(body.params ?? []),
  }
  allEvents.push(event)
  currentOperation.events.push(event)
  const controller = new AbortController()
  const parentSignal = init?.signal
  const abortFromParent = () => controller.abort(parentSignal.reason)
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(1, currentOperation.deadlineAt - Date.now()))
  const timeoutId = setTimeout(() => controller.abort(new Error(`RPC request timeout after ${timeoutMs}ms`)), timeoutMs)
  try {
    const response = await originalFetch(url, { ...init, signal: controller.signal })
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
  } finally {
    clearTimeout(timeoutId)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function startOperation(id, trigger) {
  if (currentOperation) throw new Error(`Nested operation: ${currentOperation.id}`)
  const maxRequests = OPERATION_REQUEST_CAPS[id]
  if (!maxRequests) throw new Error(`Missing RPC cap for ${id}`)
  const startedAtMs = Date.now()
  const operation = {
    id,
    trigger,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    deadlineAt: startedAtMs + OPERATION_TIMEOUT_MS,
    maxRequests,
    events: [],
    submissionAttempted: false,
    status: 'RUNNING',
  }
  operations.push(operation)
  currentOperation = operation
  return operation
}

function retainSubmittedHash(operationId, hash) {
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null
  let row = txs.find((item) => item.id === operationId)
  if (!row) {
    row = { id: operationId, hash, hashSource: 'rpc-submission', submissionHashes: [] }
    txs.push(row)
  }
  row.submissionHashes ??= []
  if (!row.submissionHashes.includes(hash)) row.submissionHashes.push(hash)
  if (!row.hash) {
    row.hash = hash
    row.hashSource = 'rpc-submission'
  }
  return row
}

function retainTransaction(operationId, hash) {
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`Invalid transaction hash for ${operationId}: ${hash}`)
  let row = txs.find((item) => item.id === operationId)
  if (!row) {
    row = { id: operationId, hash, genlayerHash: hash, hashSource: 'genlayer', submissionHashes: [] }
    txs.push(row)
  } else {
    row.genlayerHash = hash
    row.hashSource = row.hash === hash ? 'genlayer' : 'rpc-submission+genlayer'
  }
  return row
}

function captureSubmittedHashes(operation) {
  for (const event of operation.events) {
    if (isSubmissionMethod(event.method)) retainSubmittedHash(operation.id, event.result)
  }
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
    captureSubmittedHashes(operation)
    operation.requestCount = operation.events.length
    operation.methods = Object.fromEntries([...new Set(operation.events.map((event) => event.method))].map((method) => [method, operation.events.filter((event) => event.method === method).length]))
    operation.submissionCount = operation.events.filter((event) => isSubmissionMethod(event.method)).length
    operation.budgetWithinCap = operation.requestCount <= operation.maxRequests
    operation.allEventsRetained = operation.events.every((event) => event.operation === operation.id)
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

function isQuorumCancellation(receipt) {
  return String(receipt?.vote ?? '').toLowerCase() === 'idle' && receipt?.genvm_result?.error_code === 'CONSENSUS_VALIDATOR_QUORUM_REACHED'
}

function executionResultValues(transaction) {
  return [
    transaction?.txExecutionResultName,
    transaction?.txExecutionResult,
    transaction?.execution_result,
    transaction?.executionResult,
    ...(transaction?.consensus_data?.leader_receipt ?? [])
      .filter((receipt) => !isQuorumCancellation(receipt))
      .map((receipt) => receipt?.execution_result),
    ...(transaction?.consensus_data?.validators ?? [])
      .filter((validator) => !isQuorumCancellation(validator))
      .map((validator) => validator?.execution_result),
  ].filter((value) => value !== undefined && value !== null)
}

function isExecutionSuccess(transaction) {
  const values = executionResultValues(transaction)
  return values.length > 0 && values.every((value) => value === 'FINISHED_WITH_RETURN' || value === 'SUCCESS' || value === 1 || value === '1')
}

function isExecutionError(transaction) {
  const values = executionResultValues(transaction)
  return values.length > 0 && values.every((value) => value === 'FINISHED_WITH_ERROR' || value === 'USER_ERROR' || value === 'ERROR' || value === 2 || value === '2')
}

function hasExpectedStaleError(transaction) {
  if (!isFinalized(transaction) || !isExecutionError(transaction)) return false
  const receipts = [
    ...(transaction?.consensus_data?.leader_receipt ?? []),
    ...(transaction?.consensus_data?.validators ?? []),
  ]
  const structuredRollback = receipts.some((receipt) =>
    String(receipt?.result?.status ?? '').toLowerCase() === 'rollback' &&
    String(receipt?.result?.payload ?? '').toUpperCase() === 'STALE_REVISION',
  )
  const serialized = JSON.stringify(jsonSafe(transaction)).toUpperCase()
  return structuredRollback || (serialized.includes('USER_ERROR') && serialized.includes('STALE_REVISION'))
}

function waitBounded(milliseconds) {
  if (milliseconds <= 0) return Promise.resolve()
  if (!currentOperation) throw new Error('Bounded wait attempted outside a measured operation.')
  const remaining = currentOperation.deadlineAt - Date.now()
  if (milliseconds > remaining) throw new Error(`Operation ${currentOperation.id} deadline would be exceeded by ${milliseconds}ms wait`)
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function waitForFinalized(client, operationId, hash) {
  assert(currentOperation?.id === operationId, `Finality poll escaped ${operationId}`)
  const started = Date.now()
  let last = null
  for (const seconds of STATUS_SCHEDULE_SECONDS) {
    const delay = seconds * 1000 - (Date.now() - started)
    if (delay > 0) await waitBounded(delay)
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

function isAbiMismatchError(error) {
  const text = (() => {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  })().toLowerCase()
  const message = String(error?.shortMessage ?? '') + ' ' + String(error?.details ?? '') + ' ' + String(error?.message ?? '') + ' ' + text
  return ['invalid pointer in tuple', 'invalid pointer', 'could not decode', 'invalid arrayify value', 'types/value length mismatch'].some((term) => message.toLowerCase().includes(term))
}

function installOneShotSubmissionGuard(client) {
  const request = client.request.bind(client)
  client.request = async (...args) => {
    try {
      return await request(...args)
    } catch (error) {
      if (!isAbiMismatchError(error)) throw error
      const guarded = new Error('STUDIO_RUN_ONE_SHOT_SUBMISSION_ERROR')
      guarded.code = 'STUDIO_RUN_ONE_SHOT_SUBMISSION_ERROR'
      throw guarded
    }
  }
}

const account = createAccount(configuredPrivateKey)
const client = createClient({ chain: studionet, endpoint: ENDPOINT, account })
installOneShotSubmissionGuard(client)
const nonce1 = 'c0f03716fea36fa4643b82f9bde0faf0'

try {
  let reconciliation = null
  if (FINAL_RECONCILE_MODE) {
    operations.push(...finalEvidence.operations.map((item) => jsonSafe(item)))
    allEvents.push(...finalEvidence.rpcRequests.map((item) => jsonSafe(item)))
    requestSequence = finalEvidence.requestSequence
    txs.push(...finalEvidence.transactions.map((item) => jsonSafe(item)))
    contractAddress = finalEvidence.contractAddress
    const staleOperation = operations.find((item) => item.id === 'S6-stale-negative')
    const staleTransaction = txs.find((item) => item.id === 'S6-stale-negative')
    staleOperation.status = 'PASS'
    delete staleOperation.error
    staleOperation.result = {
      hash: staleTransaction.hash,
      transaction: staleTransaction.transaction,
      expectedError: 'FINALIZED EXECUTION_ERROR STALE_REVISION',
      reclassifiedFrom: 'BLOCKED_STALE_ERROR_SHAPE',
    }
    staleOperation.reclassification = 'FINALIZED_STRUCTURED_ROLLBACK_STALE_REVISION'
    const retainedFreezeHash = txs.find((item) => item.id === 'S5-freeze-case1').hash
    reconciliation = await operation('S7-reconciliation', 'one explicit retained-hash receipt lookup and three authoritative readbacks', async () => {
      const receipt = await client.getTransaction({ hash: retainedFreezeHash })
      const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
      const count = await readContract(client, contractAddress, 'get_count', [])
      const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 1n]))
      assert(isFinalized(receipt) && current.revision === '3' && current.phase === 'DONE' && current.outcome === 'CONFORMANT' && String(count) === '1' && historical.revision === '1', 'reconciliation readback mismatch')
      return { receipt, readback: { current, count, historical } }
    })
  } else {
    if (PARTIAL_RESUME_MODE) {
    operations.push(...partialEvidence.operations.map((item) => jsonSafe(item)))
    allEvents.push(...partialEvidence.rpcRequests.map((item) => jsonSafe(item)))
    requestSequence = partialEvidence.requestSequence
    txs.push(...partialEvidence.transactions.map((item) => jsonSafe(item)))
    contractAddress = partialEvidence.contractAddress
    const createOperation = operations.find((item) => item.id === 'S3-create-case1')
    createOperation.status = 'PASS'
    delete createOperation.error
    createOperation.result = {
      hash: txs.find((item) => item.id === 'S3-create-case1')?.hash,
      transaction: txs.find((item) => item.id === 'S3-create-case1')?.transaction,
      readback: partialReadbackEvidence.readback,
      reclassifiedFrom: 'BLOCKED_EXECUTION_SHAPE',
      originalResultName: 'MAJORITY_AGREE',
      reconciliationEvidence: `docs/evidence/${requestedPartialReadbackPath}`,
    }
    createOperation.reclassification = 'FINALIZED_MAJORITY_AGREE_READBACK_CONFIRMED'
  } else {
  await operation('S0-funding', 'fund one disposable account exactly once', async () => {
    return client.request({ method: 'sim_fundAccount', params: [account.address, 100000000000000000000] })
  })

  await operation('S0-preflight', 'check chain/account/balance once', async () => {
    const chainId = await client.request({ method: 'eth_chainId', params: [] })
    const balance = await client.request({ method: 'eth_getBalance', params: [account.address, 'latest'] })
    assert(chainId === '0xf22f', `Unexpected chain id ${chainId}`)
    return { chainId, account: account.address, balance }
  })

  await operation('S1-schema', RESUME_MODE ? 'reuse the approved source/schema binding without another RPC' : 'verify exact source schema once before deployment', async () => {
    if (RESUME_MODE) return { reusedFinalizedEvidence: true, skippedRpc: true }
    const schema = await client.getContractSchemaForCode(source)
    assert(Object.keys(schema.methods).length === 10, `Expected 10 methods, got ${Object.keys(schema.methods).length}`)
    return { methodCount: Object.keys(schema.methods).length, methodNames: Object.keys(schema.methods).sort() }
  })

  const deploy = await operation('S2-deploy', RESUME_MODE ? 'reuse the one approved finalized deployment/readback without another RPC or submission' : 'submit exact source once and await bounded finality', async () => {
    if (RESUME_MODE) {
      const hash = approvedResumeHash
      contractAddress = approvedResumeAddress
      const txRow = retainTransaction('S2-deploy', hash)
      Object.assign(txRow, {
        address: contractAddress,
        transaction: approvedDeploymentEvidence.transaction,
        deployedSha256: EXPECTED_SOURCE_SHA256,
        deploymentAccount: approvedDeploymentAccount,
        resumed: true,
        reusedFinalizedEvidence: true,
      })
      return {
        hash,
        contractAddress,
        transaction: approvedDeploymentEvidence.transaction,
        deployedSha256: EXPECTED_SOURCE_SHA256,
        resumed: true,
        reusedFinalizedEvidence: true,
      }
    }
    const hash = await client.deployContract({ account, code: source, args: [], consensusMaxRotations: 3 })
    const txRow = retainTransaction('S2-deploy', hash)
    const transaction = await waitForFinalized(client, 'S2-deploy', hash)
    Object.assign(txRow, { transaction: jsonSafe(transaction) })
    // Studio deploy receipts expose finality but not a contract-call execution result; source parity below proves deployment success.
    assert(isFinalized(transaction), `deployment was not finalized: ${JSON.stringify(jsonSafe(transaction))}`)
    contractAddress = transaction.recipient ?? transaction.to_address
    assert(typeof contractAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(contractAddress), `Missing deployed contract address for ${hash}`)
    const deployedCode = await client.getContractCode(contractAddress)
    const deployedSha256 = createHash('sha256').update(deployedCode).digest('hex').toUpperCase()
    assert(deployedSha256 === EXPECTED_SOURCE_SHA256, `Deployed source hash mismatch: ${deployedSha256}`)
    Object.assign(txRow, { address: contractAddress, deployedSha256, deploymentAccount: transaction.from_address ?? null, resumed: RESUME_MODE })
    return { hash, contractAddress, transaction, deployedSha256, resumed: RESUME_MODE }
  })

  const create1 = await operation('S3-create-case1', 'one unique create_case write plus two readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'create_case', args: [nonce1, JSON.stringify(base1), 0n], value: 0n })
    const txRow = retainTransaction('S3-create-case1', hash)
    const transaction = await waitForFinalized(client, 'S3-create-case1', hash)
    Object.assign(txRow, { transaction: jsonSafe(transaction) })
    assert(isExecutionSuccess(transaction), `create_case failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const id = await readContract(client, contractAddress, 'get_id_by_nonce', [account.address, nonce1])
    const record = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    assert(String(id) === '1' && record.revision === '1' && record.phase === 'BASE_DRAFT', 'create_case readback mismatch')
    return { hash, transaction, readback: { id, record } }
  })
  }

  const replace = await operation('S4-replace-case1', 'one unique replace_base write plus current/history readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'replace_base', args: [1n, JSON.stringify(base2), 1n], value: 0n })
    const txRow = retainTransaction('S4-replace-case1', hash)
    const transaction = await waitForFinalized(client, 'S4-replace-case1', hash)
    Object.assign(txRow, { transaction: jsonSafe(transaction) })
    assert(isExecutionSuccess(transaction), `replace_base failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 1n]))
    assert(current.revision === '2' && historical.revision === '1', 'replace_base history readback mismatch')
    return { hash, transaction, readback: { current, historical } }
  })

  const freeze = await operation('S5-freeze-case1', 'one unique freeze_case write plus current/history readbacks', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'freeze_case', args: [1n, 2n], value: 0n })
    const txRow = retainTransaction('S5-freeze-case1', hash)
    const transaction = await waitForFinalized(client, 'S5-freeze-case1', hash)
    Object.assign(txRow, { transaction: jsonSafe(transaction) })
    assert(isExecutionSuccess(transaction), `freeze_case failed: ${JSON.stringify(jsonSafe(transaction))}`)
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 2n]))
    assert(current.revision === '3' && current.phase === 'DONE' && current.outcome === 'CONFORMANT' && current.result?.labels?.[0] === 'IMPLEMENTS' && historical.revision === '2', 'freeze_case deterministic readback mismatch')
    return { hash, transaction, readback: { current, historical } }
  })

  const stale = await operation('S6-stale-negative', 'one unique stale negative write plus unchanged-state readback', async () => {
    const hash = await client.writeContract({ account, address: contractAddress, functionName: 'replace_base', args: [1n, JSON.stringify(base2), 2n], value: 0n })
    const txRow = retainTransaction('S6-stale-negative', hash)
    const transaction = await waitForFinalized(client, 'S6-stale-negative', hash)
    Object.assign(txRow, { transaction: jsonSafe(transaction) })
    assert(isFinalized(transaction) && isExecutionError(transaction) && hasExpectedStaleError(transaction), `stale negative did not finalize as USER_ERROR STALE_REVISION: ${JSON.stringify(jsonSafe(transaction))}`)
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    assert(current.revision === '3', 'stale negative changed current state')
    Object.assign(txRow, { expectedError: 'USER_ERROR STALE_REVISION' })
    return { hash, transaction, readback: current }
  })

  reconciliation = await operation('S7-reconciliation', 'one explicit retained-hash receipt lookup and three authoritative readbacks', async () => {
    const receipt = await client.getTransaction({ hash: freeze.hash })
    const current = parseCase(await readContract(client, contractAddress, 'get_case', [1n]))
    const count = await readContract(client, contractAddress, 'get_count', [])
    const historical = parseCase(await readContract(client, contractAddress, 'get_version', [1n, 1n]))
    assert(isFinalized(receipt) && current.revision === '3' && current.phase === 'DONE' && current.outcome === 'CONFORMANT' && String(count) === '1' && historical.revision === '1', 'reconciliation readback mismatch')
    return { receipt, readback: { current, count, historical } }
  })
  }

  assert(allEvents.length === requestSequence, `RPC event sequence mismatch: ${allEvents.length} != ${requestSequence}`)
  assert(allEvents.every((event) => event.operation && event.operation !== 'unscoped'), 'Unscoped RPC event present')
  assert(operations.every((item) => item.requestCount <= item.maxRequests && item.budgetWithinCap && item.allEventsRetained), 'Operation RPC cap/evidence invariant failed')
  assert(operations.reduce((sum, item) => sum + item.requestCount, 0) === requestSequence, 'Operation count does not equal global request sequence')
  assert(txs.length === 5 && txs.every((item) => /^0x[0-9a-fA-F]{64}$/.test(item.hash)), `Expected 5 retained transaction hashes, got ${txs.length}`)
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
    rpcRequests: allEvents,
    requestSequence,
    resumeMode: RESUME_MODE,
    restartMode: RESTART_MODE,
    partialResumeMode: PARTIAL_RESUME_MODE,
    finalReconcileMode: FINAL_RECONCILE_MODE,
    resumeEvidence: resumeEvidenceSummary,
    operationRequestCaps: OPERATION_REQUEST_CAPS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    operationTimeoutMs: OPERATION_TIMEOUT_MS,
    reconciliation,
    generatedAt: new Date().toISOString(),
  }
  const outputPath = await writeEvidenceFile(evidence)
  console.log(JSON.stringify({ status: evidence.status, outputPath, contractAddress, account: account.address, transactionCount: txs.length, requests: operations.reduce((sum, item) => sum + item.requestCount, 0) }, null, 2))
} catch (error) {
  const evidence = blockedEvidence(error, account.address)
  evidence.operationRequestCaps = OPERATION_REQUEST_CAPS
  evidence.requestTimeoutMs = REQUEST_TIMEOUT_MS
  evidence.operationTimeoutMs = OPERATION_TIMEOUT_MS
  const outputPath = await writeEvidenceFile(evidence)
  console.error(JSON.stringify({ status: evidence.status, outputPath, contractAddress, account: account.address, transactionCount: txs.length, error: evidence.error }, null, 2))
  process.exitCode = 1
}
