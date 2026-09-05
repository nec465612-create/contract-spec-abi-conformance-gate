import { TransactionStatus, type CalldataEncodable, type GenLayerTransaction, type TransactionHash } from 'genlayer-js/types'
import { genlayerChain, getReadClient, getWriteClient, type ContractAddress } from './config'
import { classifyReceipt, isTransactionHash } from './receipt'
import { JournalError, JournalStore, type JournalEntry } from '../persistence/journal'
import type { Eip1193Provider } from '../wallet/types'

export interface ContractWriteRequest<TReadback> {
  provider: Eip1193Provider
  account: ContractAddress
  contract: ContractAddress
  method: string
  args: CalldataEncodable[]
  intent: string
  preRevision: string
  preHash: `0x${string}`
  readback: () => Promise<TReadback>
  onPhase?: (phase: 'SIGNING' | 'SUBMITTED' | 'FINALITY' | 'READBACK') => void
}

export interface ContractWriteResult<TReadback> {
  hash: `0x${string}`
  receipt: GenLayerTransaction
  readback: TReadback
  journal: JournalEntry
}

export interface ReconciliationResult<TReadback> {
  hash: `0x${string}`
  receipt: GenLayerTransaction
  readback: TReadback
  journal: JournalEntry
}

export class WriteCoordinatorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WriteCoordinatorError'
  }
}

function userRejected(error: unknown): boolean {
  if (!error) return false
  const value = error as { code?: unknown; message?: unknown }
  const code = String(value.code ?? '')
  const message = String(value.message ?? '').toLowerCase()
  return code === '4001' || message.includes('user rejected') || message.includes('user denied')
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof JournalError) return error.message
  if (error instanceof WriteCoordinatorError) return error.message
  if (userRejected(error)) return 'The wallet request was cancelled.'
  return 'The transaction could not be verified. It remains available for reconciliation.'
}

export async function executeContractWrite<TReadback>(
  store: JournalStore,
  request: ContractWriteRequest<TReadback>,
): Promise<ContractWriteResult<TReadback>> {
  const entry = await store.reserve({
    chain: String(genlayerChain.id),
    contract: request.contract,
    account: request.account,
    method: request.method,
    intent: request.intent,
    args: request.args,
    pre_revision: request.preRevision,
    pre_hash: request.preHash,
  })
  const client = getWriteClient(request.provider, request.account)
  request.onPhase?.('SIGNING')

  let hash: TransactionHash
  try {
    const returned = await client.writeContract({
      address: request.contract,
      functionName: request.method,
      args: request.args,
      value: 0n,
    })
    if (!isTransactionHash(returned)) throw new Error('INVALID_TRANSACTION_HASH')
    hash = returned as TransactionHash
    await store.markSubmitted(entry, hash)
    request.onPhase?.('SUBMITTED')
  } catch (error) {
    try {
      if (userRejected(error)) await store.markFinalizedError(entry)
      else await store.markReconcile(entry)
    } catch {
      // Preserve the original user-facing failure; the recovery journal will fail closed on next load if needed.
    }
    throw new WriteCoordinatorError(userRejected(error) ? 'USER_REJECTED' : 'SUBMISSION_UNCERTAIN', safeErrorMessage(error))
  }

  let receipt: GenLayerTransaction
  try {
    request.onPhase?.('FINALITY')
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      interval: 1_000,
      retries: 120,
    })
  } catch (error) {
    const current = store.find(entry.reservation)
    if (current.status !== 'RECONCILE') {
      try { await store.markReconcile(current) } catch { /* retain existing pending evidence */ }
    }
    throw new WriteCoordinatorError('FINALITY_UNCERTAIN', safeErrorMessage(error))
  }

  const classified = classifyReceipt(receipt)
  if (!classified.ok) {
    const current = store.find(entry.reservation)
    if (classified.kind === 'execution-failed' || classified.kind === 'consensus-failed') {
      await store.markFinalizedError(current)
    } else {
      await store.markReconcile(current)
    }
    throw new WriteCoordinatorError(classified.kind.toUpperCase(), classified.message)
  }

  try {
    request.onPhase?.('READBACK')
    const readback = await request.readback()
    const current = store.find(entry.reservation)
    const verified = await store.markVerified(current)
    return { hash, receipt, readback, journal: verified }
  } catch (error) {
    const current = store.find(entry.reservation)
    if (current.status !== 'RECONCILE') {
      try { await store.markReconcile(current) } catch { /* keep hash for deliberate retry */ }
    }
    throw new WriteCoordinatorError('READBACK_UNCERTAIN', safeErrorMessage(error))
  }
}

export async function reconcileJournalEntry<TReadback>(
  store: JournalStore,
  entry: JournalEntry,
  readback: () => Promise<TReadback>,
  onPhase?: (phase: 'FINALITY' | 'READBACK') => void,
): Promise<ReconciliationResult<TReadback>> {
  if (!isTransactionHash(entry.tx_hash)) throw new WriteCoordinatorError('NO_TRANSACTION_HASH', 'This pending action has no transaction hash to reconcile.')
  const current = store.find(entry.reservation)
  if (current.status === 'VERIFIED' || current.status === 'FINALIZED_ERROR') throw new WriteCoordinatorError('TERMINAL_JOURNAL_ENTRY', 'This action is already closed.')

  let receipt: GenLayerTransaction
  try {
    onPhase?.('FINALITY')
    receipt = await getReadClient().waitForTransactionReceipt({
      hash: entry.tx_hash as TransactionHash,
      status: TransactionStatus.FINALIZED,
      interval: 1_000,
      retries: 120,
    })
  } catch {
    throw new WriteCoordinatorError('FINALITY_UNCERTAIN', 'The transaction is still awaiting authoritative finality.')
  }

  const classified = classifyReceipt(receipt)
  if (!classified.ok) {
    if (classified.kind === 'execution-failed' || classified.kind === 'consensus-failed') await store.markFinalizedError(current)
    throw new WriteCoordinatorError(classified.kind.toUpperCase(), classified.message)
  }

  try {
    onPhase?.('READBACK')
    const result = await readback()
    const verified = await store.markVerified(store.find(entry.reservation))
    return { hash: entry.tx_hash as `0x${string}`, receipt, readback: result, journal: verified }
  } catch {
    const latest = store.find(entry.reservation)
    if (latest.status !== 'RECONCILE') {
      try { await store.markReconcile(latest) } catch { /* preserve the hash for the next deliberate attempt */ }
    }
    throw new WriteCoordinatorError('READBACK_UNCERTAIN', 'The transaction finalized, but its authoritative state is not visible yet.')
  }
}

export function writeIntent(method: string, caseId: string | null, nonce: string | null): string {
  const value = caseId ? `case:${caseId}:${method}` : `create:${nonce ?? ''}`
  return value.slice(0, 160)
}
