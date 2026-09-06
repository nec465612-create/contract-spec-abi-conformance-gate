import { ExecutionResult, TransactionStatus, type GenLayerTransaction } from 'genlayer-js/types'
import { classifyReceipt, isTransactionHash } from './receipt'

describe('transaction truth checks', () => {
  it('requires finality and semantic execution success', () => {
    expect(classifyReceipt({ statusName: TransactionStatus.PROPOSING })).toMatchObject({ ok: false, kind: 'not-finalized' })
    expect(classifyReceipt({ statusName: TransactionStatus.FINALIZED, txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR })).toMatchObject({ ok: false, kind: 'execution-failed' })
    expect(classifyReceipt({ statusName: TransactionStatus.FINALIZED, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN })).toMatchObject({ ok: true })
  })

  it('rejects an explicit non-final consensus flag', () => {
    expect(classifyReceipt({ statusName: TransactionStatus.FINALIZED, consensus_data: { final: false }, txExecutionResult: 1 })).toMatchObject({ ok: false, kind: 'consensus-failed' })
  })

  it('rejects contradictory status and execution representations', () => {
    expect(classifyReceipt({ statusName: TransactionStatus.FINALIZED, status: TransactionStatus.PROPOSING, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN })).toMatchObject({ ok: false, kind: 'inconsistent' })
    expect(classifyReceipt({ statusName: TransactionStatus.FINALIZED, status: 7, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN, txExecutionResult: 2 })).toMatchObject({ ok: false, kind: 'inconsistent' })
  })

  it('classifies the current Studio consensus receipt shape', () => {
    expect(classifyReceipt({
      statusName: TransactionStatus.FINALIZED,
      consensus_data: {
        final: true,
        leader_receipt: [{ execution_result: 'SUCCESS', vote: 'agree' }],
        validators: [
          { execution_result: 'SUCCESS', vote: 'agree' },
          { execution_result: 'ERROR', vote: 'idle', genvm_result: { error_code: 'CONSENSUS_VALIDATOR_QUORUM_REACHED' } },
        ],
      },
    } as unknown as GenLayerTransaction)).toMatchObject({ ok: true })
  })

  it('accepts only a 32-byte transaction hash', () => {
    expect(isTransactionHash(`0x${'a'.repeat(64)}`)).toBe(true)
    expect(isTransactionHash('0xabc')).toBe(false)
    expect(isTransactionHash('not-a-hash')).toBe(false)
  })
})
