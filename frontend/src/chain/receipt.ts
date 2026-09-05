import { ExecutionResult, TransactionStatus, type GenLayerTransaction } from 'genlayer-js/types'

export type ReceiptFailureKind = 'not-finalized' | 'consensus-failed' | 'execution-failed'

export type ReceiptClassification =
  | { ok: true; receipt: GenLayerTransaction }
  | { ok: false; kind: ReceiptFailureKind; message: string }

function statusIsFinalized(receipt: GenLayerTransaction): boolean {
  return receipt.statusName === TransactionStatus.FINALIZED || receipt.status === TransactionStatus.FINALIZED || receipt.status === 7
}

export function classifyReceipt(receipt: GenLayerTransaction): ReceiptClassification {
  if (!statusIsFinalized(receipt)) {
    return { ok: false, kind: 'not-finalized', message: 'The transaction did not reach finality.' }
  }

  if (receipt.consensus_data?.final === false) {
    return { ok: false, kind: 'consensus-failed', message: 'The transaction did not reach final consensus.' }
  }

  const executionSucceeded = receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN || receipt.txExecutionResult === 1
  if (!executionSucceeded) {
    return { ok: false, kind: 'execution-failed', message: 'The contract execution did not complete successfully.' }
  }

  return { ok: true, receipt }
}

export function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}
