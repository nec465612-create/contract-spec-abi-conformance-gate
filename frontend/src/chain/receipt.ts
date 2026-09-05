import { ExecutionResult, TransactionStatus, type GenLayerTransaction } from 'genlayer-js/types'

export type ReceiptFailureKind = 'not-finalized' | 'consensus-failed' | 'execution-failed' | 'inconsistent'

export type ReceiptClassification =
  | { ok: true; receipt: GenLayerTransaction }
  | { ok: false; kind: ReceiptFailureKind; message: string }

type DecodedField<T> = { value: T | null; contradictory: boolean }

const STATUS_BY_NUMBER = Object.values(TransactionStatus)
const EXECUTION_BY_NUMBER = Object.values(ExecutionResult)

function decodeStatus(value: unknown): TransactionStatus | null {
  if (typeof value === 'string' && STATUS_BY_NUMBER.includes(value as TransactionStatus)) return value as TransactionStatus
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < STATUS_BY_NUMBER.length) return STATUS_BY_NUMBER[value] as TransactionStatus
  return null
}

function decodeExecution(value: unknown): ExecutionResult | null {
  if (typeof value === 'string' && EXECUTION_BY_NUMBER.includes(value as ExecutionResult)) return value as ExecutionResult
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < EXECUTION_BY_NUMBER.length) return EXECUTION_BY_NUMBER[value] as ExecutionResult
  return null
}

function consistentFields<T>(values: unknown[], decode: (value: unknown) => T | null): DecodedField<T> {
  if (values.length === 0) return { value: null, contradictory: false }
  const decoded = values.map(decode)
  if (decoded.some((value) => value === null)) return { value: null, contradictory: true }
  const first = decoded[0] as T
  return decoded.some((value) => value !== first)
    ? { value: null, contradictory: true }
    : { value: first, contradictory: false }
}

export function receiptStatus(receipt: GenLayerTransaction): DecodedField<TransactionStatus> {
  return consistentFields(
    [receipt.statusName, receipt.status].filter((value) => value !== undefined),
    decodeStatus,
  )
}

export function receiptExecution(receipt: GenLayerTransaction): DecodedField<ExecutionResult> {
  return consistentFields(
    [receipt.txExecutionResultName, receipt.txExecutionResult].filter((value) => value !== undefined),
    decodeExecution,
  )
}

export function isFinalizedReceipt(receipt: GenLayerTransaction): boolean {
  const status = receiptStatus(receipt)
  return !status.contradictory && status.value === TransactionStatus.FINALIZED
}

export function classifyReceipt(receipt: GenLayerTransaction): ReceiptClassification {
  const status = receiptStatus(receipt)
  if (status.contradictory) {
    return { ok: false, kind: 'inconsistent', message: 'The transaction receipt contains contradictory status fields.' }
  }
  if (status.value !== TransactionStatus.FINALIZED) {
    return { ok: false, kind: 'not-finalized', message: 'The transaction did not reach finality.' }
  }

  if (receipt.consensus_data?.final !== undefined && typeof receipt.consensus_data.final !== 'boolean') {
    return { ok: false, kind: 'inconsistent', message: 'The transaction receipt contains an invalid consensus field.' }
  }
  if (receipt.consensus_data?.final === false) {
    return { ok: false, kind: 'consensus-failed', message: 'The transaction did not reach final consensus.' }
  }

  const execution = receiptExecution(receipt)
  if (execution.contradictory) {
    return { ok: false, kind: 'inconsistent', message: 'The transaction receipt contains contradictory execution fields.' }
  }
  if (execution.value !== ExecutionResult.FINISHED_WITH_RETURN) {
    return { ok: false, kind: 'execution-failed', message: 'The contract execution did not complete successfully.' }
  }

  return { ok: true, receipt }
}

export function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}
