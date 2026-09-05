import { TransactionStatus, type CalldataEncodable, type GenLayerTransaction, type TransactionHash } from 'genlayer-js/types'
import { genlayerChain, getReadClient, getWriteClient, type ContractAddress } from './config'
import { classifyReceipt, isFinalizedReceipt, isTransactionHash, receiptStatus } from './receipt'
import { JournalError, JournalStore, type JournalEntry } from '../persistence/journal'
import type { Eip1193Provider } from '../wallet/types'
import { RpcBudgetError, sharedRpcReadQueue, sleepWithSignal, waitForDocumentVisible, withRpcRetry } from './rpc'

export interface ContractWriteRequest<TReadback> {
  provider: Eip1193Provider
  account: ContractAddress
  contract: ContractAddress
  method: string
  args: CalldataEncodable[]
  intent: string
  preRevision: string
  preHash: string
  readback: () => Promise<TReadback>
  failureReadback: () => Promise<void>
  signal?: AbortSignal
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
  if (error instanceof RpcBudgetError) return error.message
  if (userRejected(error)) return 'The wallet request was cancelled.'
  return 'The transaction could not be verified. It remains available for reconciliation.'
}

function rpcWriteErrorMessage(): string {
  return 'The chain RPC is temporarily rate-limited or unavailable. The transaction hash is retained; wait and reconcile later without resubmitting.'
}

/**
 * Uses the current SDK's lightweight transaction read with a bounded 2/4/8-second
 * schedule. Transient RPC failures use the shared bounded retry policy; it
 * deliberately does not use an unbounded SDK poller.
 */
async function waitForFinality(hash: TransactionHash, signal?: AbortSignal): Promise<GenLayerTransaction> {
  const client = getReadClient()
  let last: GenLayerTransaction | undefined
  for (const delay of [2_000, 4_000, 8_000]) {
    await waitForDocumentVisible(signal)
    await sleepWithSignal(delay, signal)
    await waitForDocumentVisible(signal)
    last = await withRpcRetry(() => sharedRpcReadQueue.run(() => client.getTransaction({ hash }), signal), { signal })
    const status = receiptStatus(last)
    if (status.contradictory) throw new WriteCoordinatorError('INVALID_RECEIPT', 'The transaction receipt contains contradictory status fields.')
    if (isFinalizedReceipt(last)) return last
    if (status.value === TransactionStatus.CANCELED || status.value === TransactionStatus.VALIDATORS_TIMEOUT || status.value === TransactionStatus.LEADER_TIMEOUT) return last
  }
  throw new WriteCoordinatorError('FINALITY_UNCERTAIN', last ? `The transaction remains ${last.statusName ?? 'pending'} after bounded checks.` : 'The transaction remains pending after bounded checks.')
}

async function preserveUncertain(store: JournalStore, entry: JournalEntry): Promise<void> {
  try {
    const current = store.find(entry.reservation)
    if (current.status === 'SIGNING' || current.status === 'SUBMITTED') await store.markReconcile(current)
  } catch {
    // A storage outage must not cause an automatic second wallet submission.
  }
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

  let hash: TransactionHash | undefined
  let submitted = false
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
    submitted = true
    request.onPhase?.('SUBMITTED')
  } catch (error) {
    if (userRejected(error) && !hash) {
      try {
        await store.removeUnsigned(entry)
      } catch {
        throw new WriteCoordinatorError('JOURNAL_CLEANUP_FAILED', 'The wallet request was cancelled, but local recovery could not be updated. Do not retry until the journal is reviewed.')
      }
      throw new WriteCoordinatorError('USER_REJECTED', 'The wallet request was cancelled.')
    }
    // A hash returned by the wallet is evidence even if the first local write
    // failed. Preserve it before leaving the submission path.
    if (hash && !submitted) {
      try { await store.markReconcile(entry, hash) } catch { /* keep the original uncertainty visible */ }
    }
    await preserveUncertain(store, entry)
    throw new WriteCoordinatorError('SUBMISSION_UNCERTAIN', safeErrorMessage(error))
  }

  if (!hash) throw new WriteCoordinatorError('SUBMISSION_UNCERTAIN', 'The wallet did not return a transaction hash.')

  let receipt: GenLayerTransaction
  try {
    request.onPhase?.('FINALITY')
    receipt = await waitForFinality(hash, request.signal)
  } catch (error) {
    await preserveUncertain(store, entry)
    throw new WriteCoordinatorError(error instanceof RpcBudgetError ? 'RPC_UNAVAILABLE' : 'FINALITY_UNCERTAIN', error instanceof RpcBudgetError ? rpcWriteErrorMessage() : safeErrorMessage(error))
  }

  const classified = classifyReceipt(receipt)
  if (!classified.ok) {
    const current = store.find(entry.reservation)
    if (classified.kind === 'execution-failed' || classified.kind === 'consensus-failed') {
      try {
        await request.failureReadback()
        await store.markFinalizedError(store.find(entry.reservation))
      } catch (error) {
        await preserveUncertain(store, entry)
        throw new WriteCoordinatorError(error instanceof RpcBudgetError ? 'RPC_UNAVAILABLE' : 'FINALIZED_ERROR_READBACK_UNCERTAIN', error instanceof RpcBudgetError ? rpcWriteErrorMessage() : 'The transaction failed at finality, but its pre-state could not be authoritatively checked. The record remains blocked.')
      }
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
    await preserveUncertain(store, entry)
    throw new WriteCoordinatorError(error instanceof RpcBudgetError ? 'RPC_UNAVAILABLE' : 'READBACK_UNCERTAIN', error instanceof RpcBudgetError ? rpcWriteErrorMessage() : safeErrorMessage(error))
  }
}

export async function reconcileJournalEntry<TReadback>(
  store: JournalStore,
  entry: JournalEntry,
  readback: () => Promise<TReadback>,
  failureReadback: () => Promise<void>,
  onPhase?: (phase: 'FINALITY' | 'READBACK') => void,
  signal?: AbortSignal,
): Promise<ReconciliationResult<TReadback>> {
  if (entry.chain !== String(genlayerChain.id)) throw new WriteCoordinatorError('OLD_CONTEXT_READONLY', 'This pending action belongs to another network context and remains read-only.')
  if (!isTransactionHash(entry.tx_hash)) throw new WriteCoordinatorError('NO_TRANSACTION_HASH', 'This pending action has no transaction hash to reconcile.')
  const current = store.find(entry.reservation)
  if (current.status === 'VERIFIED' || current.status === 'FINALIZED_ERROR') throw new WriteCoordinatorError('TERMINAL_JOURNAL_ENTRY', 'This action is already closed.')

  let receipt: GenLayerTransaction
  try {
    onPhase?.('FINALITY')
    receipt = await withRpcRetry(() => sharedRpcReadQueue.run(() => getReadClient().getTransaction({ hash: entry.tx_hash as TransactionHash }), signal), { signal })
  } catch (error) {
    throw new WriteCoordinatorError(error instanceof RpcBudgetError ? 'RPC_UNAVAILABLE' : 'FINALITY_UNCERTAIN', error instanceof RpcBudgetError ? rpcWriteErrorMessage() : 'The transaction is still awaiting authoritative finality.')
  }

  const classified = classifyReceipt(receipt)
  if (!classified.ok) {
    if (classified.kind === 'execution-failed' || classified.kind === 'consensus-failed') {
      try {
        await failureReadback()
        await store.markFinalizedError(store.find(entry.reservation))
      } catch (error) {
        await preserveUncertain(store, entry)
        throw new WriteCoordinatorError(error instanceof RpcBudgetError ? 'RPC_UNAVAILABLE' : 'FINALIZED_ERROR_READBACK_UNCERTAIN', error instanceof RpcBudgetError ? rpcWriteErrorMessage() : 'The transaction failed at finality, but its pre-state could not be authoritatively checked. The record remains blocked.')
      }
    }
    throw new WriteCoordinatorError(classified.kind.toUpperCase(), classified.message)
  }

  try {
    onPhase?.('READBACK')
    const result = await readback()
    const verified = await store.markVerified(store.find(entry.reservation))
    return { hash: entry.tx_hash as `0x${string}`, receipt, readback: result, journal: verified }
  } catch (error) {
    await preserveUncertain(store, entry)
    throw new WriteCoordinatorError(error instanceof RpcBudgetError ? 'RPC_UNAVAILABLE' : 'READBACK_UNCERTAIN', error instanceof RpcBudgetError ? rpcWriteErrorMessage() : 'The transaction finalized, but its authoritative state is not visible yet.')
  }
}

export function writeIntent(method: string, caseId: string | null, expectedRevision: string | null, account: string | null, nonce: string | null): string {
  if (caseId && expectedRevision) return `${method}:${caseId}:${expectedRevision}`
  if (account && nonce) return `create:${account.toLowerCase()}:${nonce}`
  throw new Error('INVALID_WRITE_INTENT')
}
