import { useState } from 'react'
import type { WriteProgress } from '../chain/write-coordinator'

const PENDING_PHASES = new Set<WriteProgress['phase']>([
  'WAITING_FOR_WALLET',
  'SUBMITTED',
  'WAITING_FOR_FINALITY',
  'VERIFYING_EXECUTION',
  'VERIFYING_READBACK',
])

const PHASE_LABELS: Record<WriteProgress['phase'], string> = {
  IDLE: 'No transaction in progress',
  WAITING_FOR_WALLET: 'Waiting for wallet confirmation',
  SUBMITTED: 'Transaction submitted',
  WAITING_FOR_FINALITY: 'Waiting for finality',
  VERIFYING_EXECUTION: 'Verifying execution',
  VERIFYING_READBACK: 'Verifying authoritative readback',
  SUCCESS: 'Transaction verified',
  REJECTED: 'Transaction rejected',
  FAILED: 'Transaction finalized with an error',
  RECONCILIATION_REQUIRED: 'Reconciliation required',
}

const PHASE_COPY: Record<WriteProgress['phase'], string> = {
  IDLE: '',
  WAITING_FOR_WALLET: 'Confirm the request in the selected wallet. No success state is shown before the chain checks finish.',
  SUBMITTED: 'The transaction hash is retained in the recovery journal.',
  WAITING_FOR_FINALITY: 'The app is checking finality on a bounded schedule. Hidden tabs pause automatic checks.',
  VERIFYING_EXECUTION: 'Finality is visible; the execution result is being checked before the state can advance.',
  VERIFYING_READBACK: 'The expected post-state is being read from the authoritative contract history.',
  SUCCESS: 'Execution, finality, and authoritative readback all agree.',
  REJECTED: 'The wallet declined the request. Nothing was submitted.',
  FAILED: 'The transaction is finalized as an error after its failure readback was checked. Do not resubmit automatically.',
  RECONCILIATION_REQUIRED: 'The transaction evidence is retained. Continue verification later; do not submit the same action again.',
}

export interface TransactionProgressProps {
  progress: WriteProgress
  explorerUrl?: string
  onReconcile?: () => void
}

export function TransactionProgress({ progress, explorerUrl, onReconcile }: TransactionProgressProps) {
  const [copied, setCopied] = useState(false)
  if (progress.phase === 'IDLE') return null

  const pending = PENDING_PHASES.has(progress.phase)
  const alert = progress.phase === 'FAILED' || progress.phase === 'REJECTED'
  const copyHash = async () => {
    if (!progress.hash || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(progress.hash)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section
      className={`transaction-progress transaction-progress-${progress.phase.toLowerCase()}`}
      data-transaction-phase={progress.phase}
      role={alert ? 'alert' : 'status'}
      aria-live={alert ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label="Transaction progress"
    >
      <div className="transaction-progress-heading">
        <div className="transaction-progress-title">
          {pending && <span className="transaction-progress-spinner" aria-hidden="true" />}
          <strong>{PHASE_LABELS[progress.phase]}</strong>
        </div>
        <span className="transaction-progress-phase">{progress.phase}</span>
      </div>
      <p>{progress.message ?? PHASE_COPY[progress.phase]}</p>
      {progress.hash && (
        <div className="transaction-progress-hash">
          <span>Transaction hash</span>
          <code>{progress.hash}</code>
          <button className="quiet-button" type="button" onClick={() => void copyHash()}>{copied ? 'Copied' : 'Copy hash'}</button>
          {explorerUrl && <a className="transaction-progress-explorer" href={explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}
        </div>
      )}
      {progress.persistenceDegraded && <p className="transaction-progress-warning">Local recovery storage needs attention. Keep this hash before leaving the page.</p>}
      {progress.phase === 'RECONCILIATION_REQUIRED' && onReconcile && (
        <button className="banner-action transaction-progress-reconcile" type="button" onClick={onReconcile}>Continue verification</button>
      )}
    </section>
  )
}
