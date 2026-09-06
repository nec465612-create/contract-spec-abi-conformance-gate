import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ContractGateway,
  deterministicEvaluation,
  normalizeBaseJson,
  parseJsonStrict,
  type CaseRecord,
} from './chain/contract'
import { assertWalletContext, contractAddress, genlayerChain, runtimeConfigurationMessage, type ContractAddress } from './chain/config'
import { executeContractWrite, reconcileJournalEntry, writeIntent, type WriteProgress } from './chain/write-coordinator'
import { createRpcAttemptBudget, RpcBudgetError, type RpcAttemptBudget } from './chain/rpc'
import { JournalError, JournalStore, type JournalEntry } from './persistence/journal'
import { isRecord, jsonSafe, sha256Hex, stableStringify } from './lib/encoding'
import { requestAccounts, useWalletProviders } from './wallet/providers'
import { isAddress, type WalletOption, type WalletSession } from './wallet/types'
import { TransactionProgress } from './components/TransactionProgress'
import './styles.css'

type RequirementDraft = { id: string; text: string; polarity: 'REQUIRED' | 'FORBIDDEN'; signature: string }

const DEFAULT_REQUIREMENTS: RequirementDraft[] = [
  { id: 'transfer', text: 'The contract exposes this exact transfer function.', polarity: 'REQUIRED', signature: 'transfer(address,uint256)->():nonpayable' },
]

const DEFAULT_ABI = `[
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
]`

function initialNonce(): string {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return '00000000000000000000000000000001'
  }
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function friendlyError(error: unknown): string {
  if (error instanceof JournalError) {
    if (error.code === 'PENDING_CONFLICT') return 'A matching action is already awaiting confirmation. Refresh the case before trying again.'
    if (error.code === 'JOURNAL_LOCK_UNAVAILABLE') return 'This browser cannot safely recover pending actions. Use a browser with transaction recovery enabled.'
    if (error.code === 'JOURNAL_CAPACITY') return 'Local recovery storage is full. Reconcile or export a pending record before submitting another action.'
    if (error.code === 'JOURNAL_SECURE_CONTEXT') return 'Transaction recovery requires a secure browser context. Open the released site over HTTPS or localhost.'
    return 'Local transaction recovery is unavailable. No action was submitted.'
  }
  if (error instanceof Error) {
    if (error instanceof RpcBudgetError) return error.message
    if (error.message.includes('JOURNAL_ERROR:JOURNAL_LOCK_UNAVAILABLE')) return 'Local transaction recovery is unavailable because the exclusive browser lock could not be acquired. No action was submitted.'
    if (error.message.includes('JOURNAL_ERROR:INVALID_JOURNAL_TRANSITION')) return 'The retained transaction is in an invalid recovery state. Keep its hash and export the journal before taking any further action.'
    if (error.message.includes('JOURNAL_ERROR:RESERVATION_NOT_FOUND')) return 'The retained transaction journal record is missing. Do not resubmit; preserve the transaction hash for recovery.'
    if (error.message.includes('JOURNAL_ERROR:IMMUTABLE_JOURNAL_CONTEXT')) return 'The retained transaction journal context changed. Do not resubmit; preserve the transaction hash for recovery.'
    if (error.message === 'BASE_SPEC_SHAPE' || error.message === 'BASE_SPEC_INVALID' || error.message === 'BAD_JSON' || error.message === 'Unexpected end of JSON input') return 'Enter a valid base specification JSON object.'
    if (error.message === 'DUPLICATE_KEY') return 'Duplicate JSON keys are not allowed.'
    if (error.message === 'BASE_SPEC_TOO_LARGE') return 'The base specification is too large for this contract.'
    if (error.message === 'WRONG_NETWORK') return 'Connect the selected wallet to GenLayer Studionet before signing.'
    if (error.message === 'WALLET_ACCOUNT_CHANGED') return 'The selected wallet account changed. Reconnect it before signing.'
    if (error.message.includes('chain RPC is temporarily rate-limited')) return error.message
    if (error.message.includes('AUTHORITATIVE_READBACK_MISMATCH')) {
      const reason = error.message.split(':')[1]
      return reason ? `The transaction finalized, but authoritative reconciliation stopped at ${reason}. Refresh and reconcile before retrying.` : 'The transaction finalized, but the expected case state was not visible yet. Refresh and reconcile before retrying.'
    }
    if (error.message.includes('FAILED_WRITE_POSTSTATE_MISMATCH')) return 'The failed transaction changed a historical revision unexpectedly. Keep the journal blocked and inspect the case.'
    if (error.message.includes('STALE_REVISION')) return 'This case changed on chain. Refresh it before submitting another action.'
    if (error.message.includes('BAD_PHASE')) return 'That action is not available in the case’s current phase.'
    if (error.message.includes('another network context')) return 'This pending action belongs to another network or contract context and is read-only here.'
    if (error.message.includes('awaiting authoritative finality')) return 'Finality is not yet authoritative. Keep the pending record and reconcile it later; do not resubmit.'
    if (error.message.includes('cancelled')) return error.message
  }
  return 'The action could not be completed. Review the case and try again deliberately.'
}

function caseStateHash(record: CaseRecord): Promise<string> {
  return sha256Hex(stableStringify(jsonSafe(record)))
}

function pendingLabel(entry: JournalEntry): string {
  const caseMatch = /^(?:replace_base|freeze_case):(\d+):/.exec(entry.intent)
  if (caseMatch) return `Case #${caseMatch[1]}`
  if (entry.intent.startsWith('create:')) return 'New case'
  return 'Contract action'
}

function authoritativeMismatch(reason: string): never {
  throw new Error(`AUTHORITATIVE_READBACK_MISMATCH:${reason}`)
}

async function operationMatches(
  record: CaseRecord,
  method: string,
  caller: string,
  args: unknown[],
): Promise<boolean> {
  if (!isRecord(record.last_operation)) return false
  if (typeof record.create_hash !== 'string') return false
  const argsHash = await sha256Hex(stableStringify(args))
  const operation = record.last_operation
  return operation.method === method
    && typeof operation.caller === 'string'
    && operation.caller.toLowerCase() === caller.toLowerCase()
    && typeof operation.args_hash === 'string'
    && operation.args_hash.toLowerCase() === argsHash
    && (method !== 'create_case' || record.create_hash.toLowerCase() === argsHash)
}

function operationPostcondition(record: CaseRecord, method: string, before: CaseRecord): boolean {
  if (record.revision !== String(BigInt(before.revision) + 1n)) return false
  if (method === 'replace_base') {
    return record.phase === 'BASE_DRAFT'
      && !record.base_locked
      && !record.response_locked
      && stableStringify(record.response) === stableStringify(before.response)
      && stableStringify(record.result) === stableStringify(before.result)
      && record.outcome === before.outcome
  }
  if (method === 'freeze_case') {
    const expected = deterministicEvaluation(before.base)
    return record.phase === 'DONE'
      && record.base_locked
      && record.response_locked
      && stableStringify(record.base) === stableStringify(before.base)
      && stableStringify(record.result) === stableStringify(expected.result)
      && record.outcome === expected.outcome
  }
  return false
}

async function isDifferentAcceptedOperation(record: CaseRecord, method: string, caller: string, args: unknown[]): Promise<boolean> {
  if (!isRecord(record.last_operation)) return false
  const operation = record.last_operation
  const acceptedMethods = ['replace_base', 'freeze_case']
  if (typeof operation.method !== 'string' || !acceptedMethods.includes(operation.method)) return false
  if (typeof operation.caller !== 'string' || !/^0x[0-9a-f]{40}$/i.test(operation.caller)) return false
  if (typeof operation.args_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(operation.args_hash)) return false
  const argsHash = await sha256Hex(stableStringify(args))
  return !(operation.method === method
    && operation.caller.toLowerCase() === caller.toLowerCase()
    && operation.args_hash.toLowerCase() === argsHash)
}

async function verifyFailedCaseMutation(
  gateway: ContractGateway,
  caseId: string,
  preRevision: string,
  preHash: string,
  method: string,
  caller: string,
  args: unknown[],
  budget?: RpcAttemptBudget,
): Promise<void> {
  gateway.invalidate()
  const before = await gateway.getVersion(caseId, preRevision, budget)
  if (!before || await caseStateHash(before) !== preHash) throw new Error('FAILED_WRITE_PRESTATE_MISMATCH')
  const nextRevision = String(BigInt(preRevision) + 1n)
  const after = await gateway.getVersion(caseId, nextRevision, budget)
  if (after === null) return
  if (after.id !== caseId || after.revision !== nextRevision || !(await isDifferentAcceptedOperation(after, method, caller, args))) {
    throw new Error('FAILED_WRITE_POSTSTATE_MISMATCH')
  }
}

function outcomeCopy(outcome: string): string {
  if (outcome === 'CONFORMANT') return 'Interface matches submitted requirements'
  if (outcome === 'FORBIDDEN_SURFACE') return 'Forbidden exposure found'
  if (outcome === 'MISSING_REQUIRED_SURFACE') return 'Required operation missing'
  return outcome || 'Awaiting freeze'
}

interface WalletChooserProps {
  open: boolean
  options: WalletOption[]
  busyId: WalletOption['id'] | null
  onChoose: (option: WalletOption) => void
  onClose: () => void
}

export function WalletChooser({ open, options, busyId, onChoose, onClose }: WalletChooserProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      queueMicrotask(() => dialog.querySelector<HTMLButtonElement>('[data-wallet-option]')?.focus())
    } else {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      previousFocus.current?.focus()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="wallet-dialog"
      aria-labelledby="wallet-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-shell">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Secure session</p>
            <h2 id="wallet-dialog-title">Choose a wallet</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close wallet chooser" onClick={onClose}>×</button>
        </div>
        <p className="dialog-copy">Select one of the supported wallets to approve a session.</p>
        <div className="wallet-options" aria-live="polite">
          {options.map((option) => (
            <button
              key={`${option.id}:${option.uuid ?? option.source}`}
              type="button"
              className="wallet-option"
              data-wallet-option
              disabled={busyId !== null}
              onClick={() => onChoose(option)}
            >
              <img src={option.icon} alt="" width="40" height="40" />
              <span>{option.label}</span>
              <span className="wallet-option-arrow">{busyId === option.id ? '…' : '→'}</span>
            </button>
          ))}
          {options.length === 0 && (
            <div className="empty-wallets">
              <strong>No supported wallet detected</strong>
              <span>Install MetaMask, OKX Wallet, or Rabby, then reload this page.</span>
            </div>
          )}
        </div>
        <p className="dialog-footnote">Your session stays in this tab and is cleared when the page is reloaded.</p>
      </div>
    </dialog>
  )
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill status-${value.toLowerCase().replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>
}

function CaseList({
  ids,
  selectedId,
  count,
  loading,
  onSelect,
  onRefresh,
}: {
  ids: string[]
  selectedId: string | null
  count: string | null
  loading: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <aside className="case-sidebar panel">
      <div className="sidebar-heading">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>Cases</h2>
        </div>
        <button className="quiet-button" type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh cases">↻</button>
      </div>
      <div className="count-block">
        <span className="count-value">{count ?? '—'}</span>
        <span className="count-label">visible cases</span>
      </div>
      <div className="case-list" aria-label="Case list">
        {ids.map((id) => (
          <button key={id} type="button" className={`case-list-item ${selectedId === id ? 'selected' : ''}`} onClick={() => onSelect(id)}>
            <span className="case-list-index">#{id}</span>
            <span className="case-list-arrow">→</span>
          </button>
        ))}
        {ids.length === 0 && <p className="muted">No cases on this contract yet.</p>}
      </div>
      <div className="sidebar-note">
        <span className="note-dot" />
        <span>Read-only case browsing is available before connecting a wallet.</span>
      </div>
    </aside>
  )
}

function CreateCaseForm({
  disabled,
  busy,
  onCreate,
}: {
  disabled: boolean
  busy: boolean
  onCreate: (nonce: string, baseJson: string, parent: string) => void
}) {
  const [nonce, setNonce] = useState(initialNonce)
  const [requirements, setRequirements] = useState<RequirementDraft[]>(DEFAULT_REQUIREMENTS)
  const [abiJson, setAbiJson] = useState(DEFAULT_ABI)
  const [parent, setParent] = useState('0')
  const [abiError, setAbiError] = useState<string | null>(null)

  const basePreview = useMemo(() => {
    try {
      const abi = parseJsonStrict(abiJson)
      if (!Array.isArray(abi)) throw new Error('BASE_SPEC_INVALID')
      const normalized = normalizeBaseJson(JSON.stringify({ requirements, abi }))
      return { normalized, error: null }
    } catch (previewError) {
      return { normalized: null, error: friendlyError(previewError) }
    }
  }, [abiJson, requirements])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!basePreview.normalized) {
      setAbiError(basePreview.error ?? 'ABI JSON must be a valid normalized V1 base specification.')
      return
    }
    setAbiError(null)
    onCreate(nonce.trim(), basePreview.normalized.canonical, parent.trim() || '0')
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          <span>Case nonce</span>
          <input value={nonce} onChange={(event) => setNonce(event.target.value)} maxLength={32} pattern="[0-9a-f]{32}" required aria-describedby="nonce-help" />
          <small id="nonce-help">A unique 32-character lowercase hex value.</small>
        </label>
        <label>
          <span>Parent case</span>
          <input value={parent} onChange={(event) => setParent(event.target.value)} inputMode="numeric" pattern="[0-9]+" required />
          <small>Use 0 for a top-level case.</small>
        </label>
      </div>
      <label>
        <span>Requirements</span>
        <div className="requirements-editor">
          {requirements.map((requirement, index) => (
            <div className="requirement-row" key={`${index}:${requirement.id}`}>
              <div className="requirement-fields">
                <input value={requirement.id} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item))} maxLength={16} placeholder="requirement-id" aria-label={`Requirement ${index + 1} id`} required />
                <select value={requirement.polarity} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, polarity: event.target.value as RequirementDraft['polarity'] } : item))} aria-label={`Requirement ${index + 1} polarity`}>
                  <option value="REQUIRED">REQUIRED</option>
                  <option value="FORBIDDEN">FORBIDDEN</option>
                </select>
              </div>
              <textarea value={requirement.text} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} maxLength={384} rows={3} placeholder="Describe the interface requirement" aria-label={`Requirement ${index + 1} text`} required />
              <input value={requirement.signature} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, signature: event.target.value } : item))} maxLength={512} placeholder="transfer(address,uint256)->():nonpayable" aria-label={`Requirement ${index + 1} canonical signature`} required />
              {requirements.length > 1 && <button className="quiet-button remove-requirement" type="button" onClick={() => setRequirements((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
            </div>
          ))}
          <button className="quiet-button add-requirement" type="button" disabled={requirements.length >= 8} onClick={() => setRequirements((current) => [...current, { id: '', text: '', polarity: 'REQUIRED', signature: '' }])}>+ Add requirement</button>
        </div>
        <small>Each requirement binds one exact canonical function signature. Text is explanatory only; the signature determines the on-chain result.</small>
      </label>
      <label>
        <span>Normalized V1 ABI JSON</span>
        <textarea value={abiJson} onChange={(event) => { setAbiJson(event.target.value); setAbiError(null) }} rows={17} spellCheck={false} aria-label="Normalized ABI JSON" required />
        <small>Use normalized V1 ABI; remove compiler metadata keys. The contract validates all entries before the case is created.</small>
        {(basePreview.error || abiError) && <small className="field-error">{abiError ?? basePreview.error}</small>}
      </label>
      <div className="live-limits" aria-live="polite">
        <span>Live limits</span>
        <strong>{requirements.length}/8 requirements</strong>
        <strong>{basePreview.normalized ? `${basePreview.normalized.metrics.abiEntries}/16 ABI entries` : 'ABI entries: invalid JSON'}</strong>
        <strong>{basePreview.normalized ? `${basePreview.normalized.metrics.bytes}/8192 UTF-8 bytes` : '—'}</strong>
        <strong>{basePreview.normalized ? `${basePreview.normalized.metrics.parameterNodes}/32 parameter nodes` : '—'}</strong>
        <strong>{basePreview.normalized ? `${basePreview.normalized.metrics.depth}/4 tuple depth` : '—'}</strong>
      </div>
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={disabled || busy}>{busy ? 'Preparing…' : 'Create case'}</button>
        {disabled && <span className="inline-hint">Connect a wallet to create a case.</span>}
      </div>
    </form>
  )
}

function ConformanceMatrix({ record }: { record: CaseRecord }) {
  const functions = record.base.abi.filter((entry) => entry.type === 'function')
  const labels = Array.isArray(record.result.labels) ? record.result.labels : []
  if (functions.length === 0 || labels.length === 0) return null

  return (
    <div className="matrix-block">
      <div className="block-heading"><span>Conformance matrix</span><span className="block-meta">Frozen source comparison</span></div>
      <div className="matrix-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              {functions.map((entry, index) => <th scope="col" key={`${String(entry.name)}:${index}`}>{typeof entry.name === 'string' ? entry.name : `Function ${index + 1}`}</th>)}
            </tr>
          </thead>
          <tbody>
            {record.base.requirements.map((requirement, rowIndex) => (
              <tr key={requirement.id}>
                <th scope="row"><span>{requirement.id}</span><small>{requirement.polarity} · {requirement.signature}</small></th>
                {functions.map((_, columnIndex) => {
                  const label = typeof labels[rowIndex * functions.length + columnIndex] === 'string' ? String(labels[rowIndex * functions.length + columnIndex]) : '—'
                  return <td key={`${requirement.id}:${columnIndex}`}><span className={`matrix-label matrix-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{label}</span></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function App() {
  const walletOptions = useWalletProviders()
  const gateway = useMemo(() => (contractAddress && !runtimeConfigurationMessage() ? new ContractGateway(contractAddress) : null), [])
  const journal = useMemo(() => new JournalStore(), [])
  const [journalReady, setJournalReady] = useState(false)
  const [journalError, setJournalError] = useState<string | null>(null)
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [session, setSession] = useState<WalletSession | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [chooserBusy, setChooserBusy] = useState<WalletOption['id'] | null>(null)
  const [caseIds, setCaseIds] = useState<string[]>([])
  const [caseCount, setCaseCount] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null)
  const [loadingCases, setLoadingCases] = useState(false)
  const [loadingCase, setLoadingCase] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [replaceJson, setReplaceJson] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writeProgress, setWriteProgress] = useState<WriteProgress>({ phase: 'IDLE' })
  const [journalPage, setJournalPage] = useState(0)
  const writeAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setJournalEntries(await journal.initialize())
      } catch {
        try {
          setJournalEntries(journal.loadAll())
        } catch {
          setJournalError('Transaction recovery is unavailable in this browser. Reads and writes are disabled until local storage is available.')
        }
      }
      try {
        await journal.probe()
        setJournalReady(true)
      } catch {
        setJournalReady(false)
        setJournalError('Transaction signing is disabled until secure storage and an exclusive recovery lock are available. Read-only browsing remains available.')
      }
    })()
  }, [journal])

  useEffect(() => {
    if (!session) return undefined
    const provider = session.provider
    const invalidateSession = (message: string) => {
      writeAbortRef.current?.abort()
      gateway?.invalidate()
      setSession(null)
      setChooserOpen(false)
      setNotice(null)
      setError(message)
    }
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0]
      const account = Array.isArray(accounts) && typeof accounts[0] === 'string' && isAddress(accounts[0]) ? accounts[0].toLowerCase() : ''
      if (account !== session.account.toLowerCase()) invalidateSession('The selected wallet account changed. Reconnect before signing.')
    }
    const onChainChanged = () => invalidateSession('The selected wallet network changed. Reconnect to GenLayer Studionet before signing.')
    const onDisconnect = () => invalidateSession('The selected wallet disconnected. Reconnect before signing.')
    provider.on?.('accountsChanged', onAccountsChanged)
    provider.on?.('chainChanged', onChainChanged)
    provider.on?.('disconnect', onDisconnect)
    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged)
      provider.removeListener?.('chainChanged', onChainChanged)
      provider.removeListener?.('disconnect', onDisconnect)
    }
  }, [gateway, session])

  useEffect(() => () => {
    writeAbortRef.current?.abort()
  }, [])

  const refreshJournal = useCallback(() => {
    try {
      setJournalEntries(journal.loadAll())
    } catch {
      setJournalError('Transaction recovery is unavailable in this browser. Writes are disabled until local storage is available.')
    }
  }, [journal])

  const refreshCases = useCallback(async () => {
    if (!gateway) return
    setLoadingCases(true)
    setError(null)
    try {
      gateway.invalidate()
      const page = await gateway.listCases('1', '4', createRpcAttemptBudget(1))
      setCaseCount(String(page.ids.length))
      setCaseIds(page.ids)
    } catch (loadError) {
      setError(friendlyError(loadError))
    } finally {
      setLoadingCases(false)
    }
  }, [gateway])

  const loadCase = useCallback(async (id: string) => {
    if (!gateway) return
    setSelectedId(id)
    setLoadingCase(true)
    setError(null)
    try {
      gateway.invalidate()
      const record = await gateway.getCase(id, createRpcAttemptBudget(1))
      setSelectedCase(record)
      if (record) setReplaceJson(JSON.stringify(record.base, null, 2))
    } catch (loadError) {
      setError(friendlyError(loadError))
      setSelectedCase(null)
    } finally {
      setLoadingCase(false)
    }
  }, [gateway])

  const connect = async (option: WalletOption) => {
    if (!journalReady || journalError) {
      setError('Transaction recovery is still being checked. Wait a moment before connecting a wallet.')
      return
    }
    setChooserBusy(option.id)
    setError(null)
    try {
      const [account] = await requestAccounts(option)
      await assertWalletContext(option.provider, account)
      setSession({ id: option.id, label: option.label, icon: option.icon, provider: option.provider, account })
      setChooserOpen(false)
      setNotice(`${option.label} is connected for this tab.`)
    } catch (connectError) {
      setError(friendlyError(connectError))
    } finally {
      setChooserBusy(null)
    }
  }

  const runWrite = async <T,>(request: Parameters<typeof executeContractWrite<T>>[1], successMessage: string) => {
    setBusyAction(request.method)
    setError(null)
    setNotice(null)
    const controller = new AbortController()
    writeAbortRef.current = controller
    try {
      await assertWalletContext(request.provider, request.account)
      const completed = await executeContractWrite(journal, { ...request, signal: controller.signal, onProgress: setWriteProgress })
      refreshJournal()
      gateway?.invalidate()
      if (isRecord(completed.readback) && completed.readback.v === 1 && typeof completed.readback.id === 'string' && typeof completed.readback.revision === 'string') {
        const record = completed.readback as unknown as CaseRecord
        setSelectedId(record.id)
        setSelectedCase(record)
        setReplaceJson(JSON.stringify(record.base, null, 2))
      }
      setNotice(successMessage)
    } catch (writeError) {
      setError(friendlyError(writeError))
    } finally {
      if (writeAbortRef.current === controller) writeAbortRef.current = null
      refreshJournal()
      setBusyAction(null)
    }
  }

  const reconcilePending = async (entry: JournalEntry) => {
    if (entry.chain !== String(genlayerChain.id)) {
      setError('This pending action belongs to another network context and is read-only here.')
      return
    }
    const recoveryGateway = new ContractGateway(entry.contract)
    const reconcileKey = `reconcile:${entry.reservation}`
    const controller = new AbortController()
    writeAbortRef.current = controller
    setBusyAction(reconcileKey)
    setError(null)
    try {
      const reconciled = await reconcileJournalEntry(journal, entry, async (budget) => {
        recoveryGateway.invalidate()
        const createMatch = /^create:(0x[0-9a-f]{40}):([0-9a-f]{32})$/.exec(entry.intent)
        if (createMatch) {
          if (entry.method !== 'create_case' || createMatch[1] !== entry.account) authoritativeMismatch('CREATE_INTENT')
          const args = JSON.parse(entry.args_json) as unknown
          if (!Array.isArray(args) || args.length !== 3 || args[0] !== createMatch[2] || typeof args[1] !== 'string' || typeof args[2] !== 'string' || String(BigInt(args[2])) !== args[2]) authoritativeMismatch('CREATE_ARGS')
          const { parsed } = normalizeBaseJson(args[1])
          const id = await recoveryGateway.getIdByNonce(entry.account as ContractAddress, createMatch[2], budget)
          if (id === '0') authoritativeMismatch('CREATE_ID')
          const record = await recoveryGateway.getVersion(id, '1', budget)
          if (!record || record.id !== id || record.revision !== '1' || record.primary.toLowerCase() !== entry.account || record.parent !== args[2]) authoritativeMismatch('CREATE_RECORD')
          if (!(await operationMatches(record, 'create_case', entry.account, [createMatch[2], parsed, args[2]]))) authoritativeMismatch('CREATE_OPERATION')
          return record
        }
        const caseMatch = /^(replace_base|freeze_case):([1-9][0-9]*):([0-9]+)$/.exec(entry.intent)
        if (!caseMatch) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        if (String(BigInt(caseMatch[3])) !== entry.pre_revision) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        const args = JSON.parse(entry.args_json) as unknown
        if (!Array.isArray(args) || args.length < 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
          throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        }
        if (entry.method !== caseMatch[1] || args[0] !== caseMatch[2] || args[1] !== caseMatch[3]) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        const expectedRevision = String(BigInt(caseMatch[3]) + 1n)
        const operationArgs: unknown[] = [caseMatch[2]]
        if (caseMatch[1] === 'replace_base') {
          if (args.length !== 3 || args[2] !== caseMatch[3]) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          const { parsed } = normalizeBaseJson(args[1])
          operationArgs.push(parsed, caseMatch[3])
        } else {
          if (args.length !== 2) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          operationArgs.push(caseMatch[3])
        }
        const before = await recoveryGateway.getVersion(caseMatch[2], caseMatch[3], budget)
        if (!before || await caseStateHash(before) !== entry.pre_hash) throw new Error('FAILED_WRITE_PRESTATE_MISMATCH')
        const record = await recoveryGateway.getVersion(caseMatch[2], expectedRevision, budget)
        if (!record || record.id !== caseMatch[2] || record.revision !== expectedRevision || record.primary.toLowerCase() !== entry.account || !operationPostcondition(record, caseMatch[1], before)) {
          throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        }
        if (!(await operationMatches(record, caseMatch[1], entry.account, operationArgs))) {
          throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        }
        return record
      }, async (budget) => {
        recoveryGateway.invalidate()
        const createMatch = /^create:(0x[0-9a-f]{40}):([0-9a-f]{32})$/.exec(entry.intent)
        if (createMatch) {
          const id = await recoveryGateway.getIdByNonce(entry.account as ContractAddress, createMatch[2], budget)
          if (id !== '0') throw new Error('FAILED_WRITE_POSTSTATE_MISMATCH')
          return
        }
        const caseMatch = /^(replace_base|freeze_case):([1-9][0-9]*):([0-9]+)$/.exec(entry.intent)
        if (!caseMatch || String(BigInt(caseMatch[3])) !== entry.pre_revision) throw new Error('FAILED_WRITE_PRESTATE_MISMATCH')
        const args = JSON.parse(entry.args_json) as unknown
        if (!Array.isArray(args) || args.length < 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string' || args[0] !== caseMatch[2] || args[1] !== caseMatch[3]) {
          throw new Error('FAILED_WRITE_PRESTATE_MISMATCH')
        }
        const operationArgs: unknown[] = [caseMatch[2]]
        if (caseMatch[1] === 'replace_base') {
          if (args.length !== 3 || args[2] !== caseMatch[3]) throw new Error('FAILED_WRITE_PRESTATE_MISMATCH')
          const { parsed } = normalizeBaseJson(args[1])
          operationArgs.push(parsed, caseMatch[3])
        } else {
          if (args.length !== 2) throw new Error('FAILED_WRITE_PRESTATE_MISMATCH')
          operationArgs.push(caseMatch[3])
        }
        await verifyFailedCaseMutation(recoveryGateway, caseMatch[2], entry.pre_revision, entry.pre_hash, caseMatch[1], entry.account, operationArgs, budget)
      }, setWriteProgress, controller.signal)
      recoveryGateway.invalidate()
      gateway?.invalidate()
      refreshJournal()
      if (isRecord(reconciled.readback) && reconciled.readback.v === 1 && typeof reconciled.readback.id === 'string' && typeof reconciled.readback.revision === 'string') {
        const record = reconciled.readback as unknown as CaseRecord
        setSelectedId(record.id)
        setSelectedCase(record)
        setReplaceJson(JSON.stringify(record.base, null, 2))
      }
      setNotice(`${pendingLabel(entry)} was reconciled and verified.`)
    } catch (reconcileError) {
      setError(friendlyError(reconcileError))
    } finally {
      if (writeAbortRef.current === controller) writeAbortRef.current = null
      refreshJournal()
      setBusyAction(null)
    }
  }

  const reconcileProgress = () => {
    if (!writeProgress.hash || busyAction !== null) return
    const entry = journalEntries.find((candidate) => candidate.tx_hash.toLowerCase() === writeProgress.hash?.toLowerCase())
    if (entry) void reconcilePending(entry)
  }

  const exportJournal = () => {
    try {
      const payload = JSON.stringify(journal.loadAll(), null, 2)
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'genlayer-journal.json'
      link.click()
      URL.revokeObjectURL(url)
      setNotice('The recovery journal was exported. Keep it with the release evidence if reconciliation is needed.')
    } catch {
      setError('The recovery journal could not be exported.')
    }
  }

  const createCase = async (nonce: string, baseJson: string, parent: string) => {
    if (!session || !gateway || !contractAddress) return
    setError(null)
    try {
      if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('BAD_NONCE')
      if (!/^\d+$/.test(parent)) throw new Error('BAD_PARENT')
      const { canonical, parsed } = normalizeBaseJson(baseJson)
      const parentId = BigInt(parent)
      const preHash = await sha256Hex(stableStringify([nonce, parsed, parentId.toString()]))
      await runWrite({
        provider: session.provider,
        account: session.account as ContractAddress,
        contract: contractAddress,
        method: 'create_case',
        args: [nonce, canonical, parentId],
        intent: writeIntent('create_case', null, null, session.account, nonce),
        preRevision: '0',
        preHash,
        readback: async (budget) => {
          gateway.invalidate()
          const id = await gateway.getIdByNonce(session.account as ContractAddress, nonce, budget)
          if (id === '0') throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          const record = await gateway.getVersion(id, '1', budget)
          if (!record || record.id !== id || record.revision !== '1' || record.primary.toLowerCase() !== session.account.toLowerCase() || record.parent !== parentId.toString()) {
            throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          }
          if (!(await operationMatches(record, 'create_case', session.account, [nonce, parsed, parentId.toString()]))) {
            throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          }
          return record
        },
        failureReadback: async (budget) => {
          gateway.invalidate()
          const failedId = await gateway.getIdByNonce(session.account as ContractAddress, nonce, budget)
          if (failedId !== '0') throw new Error('FAILED_WRITE_POSTSTATE_MISMATCH')
        },
      }, 'Case created and verified on chain.')
    } catch (createError) {
      setError(friendlyError(createError))
    }
  }

  const runCaseAction = async (method: 'replace_base' | 'freeze_case') => {
    if (!session || !selectedCase || !gateway || !contractAddress) return
    const expectedRevision = selectedCase.revision
    const preHash = await caseStateHash(selectedCase)
    let args: [bigint, string, bigint] | [bigint, bigint]
    let operationArgs: unknown[]
    if (method === 'replace_base') {
      try {
        const { canonical, parsed } = normalizeBaseJson(replaceJson)
        args = [BigInt(selectedCase.id), canonical, BigInt(expectedRevision)]
        operationArgs = [selectedCase.id, parsed, expectedRevision]
      } catch (replaceError) {
        setError(friendlyError(replaceError))
        return
      }
    } else {
      args = [BigInt(selectedCase.id), BigInt(expectedRevision)]
      operationArgs = [selectedCase.id, expectedRevision]
    }
    const nextRevision = String(BigInt(expectedRevision) + 1n)
    await runWrite({
      provider: session.provider,
      account: session.account as ContractAddress,
      contract: contractAddress,
      method,
      args,
      intent: writeIntent(method, selectedCase.id, expectedRevision, null, null),
      preRevision: expectedRevision,
      preHash,
      readback: async (budget) => {
        gateway.invalidate()
        const updated = await gateway.getVersion(selectedCase.id, nextRevision, budget)
        if (!updated || updated.revision !== nextRevision || updated.primary.toLowerCase() !== session.account.toLowerCase() || !operationPostcondition(updated, method, selectedCase)) {
          throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        }
        if (!(await operationMatches(updated, method, session.account, operationArgs))) {
          throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        }
        return updated
      },
      failureReadback: (budget) => verifyFailedCaseMutation(gateway, selectedCase.id, expectedRevision, preHash, method, session.account, operationArgs, budget),
    }, method === 'replace_base' ? 'Base specification replaced and verified.' : `${method.replace('_', ' ')} finalized and verified.`)
  }

  const configMessage = runtimeConfigurationMessage()
  const writesDisabled = !session || !journalReady || Boolean(journalError) || !contractAddress
  const pendingEntries = journalEntries.filter((entry) => entry.status !== 'VERIFIED' && entry.status !== 'FINALIZED_ERROR')
  const pendingContextMatches = pendingEntries.length > 0 && pendingEntries[0].chain === String(genlayerChain.id)
  const journalPageCount = Math.max(1, Math.ceil(journalEntries.length / 4))
  const visibleJournalEntries = journalEntries.slice(journalPage * 4, journalPage * 4 + 4)
  useEffect(() => {
    setJournalPage((page) => Math.min(page, journalPageCount - 1))
  }, [journalPageCount])

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ABI Conformance Gate home">
          <span className="brand-mark">AG</span>
          <span><strong>ABI Conformance</strong><small>GATE</small></span>
        </a>
        <div className="topbar-actions">
          {session ? (
            <button className="session-button" type="button" onClick={() => setSession(null)} title="Disconnect this tab">
              <img src={session.icon} alt="" width="24" height="24" />
              <span>{shortenAddress(session.account)}</span>
              <span className="session-dot" />
            </button>
          ) : (
            <button className="secondary-button" type="button" disabled={!journalReady || Boolean(journalError)} onClick={() => setChooserOpen(true)}>Connect wallet</button>
          )}
        </div>
      </header>

      <main className="page-wrap">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Contract specification registry</p>
            <h1>Make interface promises <em>verifiable.</em></h1>
            <p className="hero-lede">Create a frozen specification, compare it with a contract ABI, and preserve the result as a reviewable case.</p>
          </div>
          <div className="hero-orbit" aria-hidden="true"><span /><span /><span /></div>
        </section>

        {configMessage && <div className="banner warning"><span className="banner-icon">!</span><span>{configMessage} Add <code>VITE_CONTRACT_ADDRESS</code> before using this release.</span></div>}
        {journalError && <div className="banner warning"><span className="banner-icon">!</span><span>{journalError}</span></div>}
        {notice && <div className="banner success"><span className="banner-icon">✓</span><span>{notice}</span></div>}
        {error && <div className="banner error"><span className="banner-icon">×</span><span>{error}</span><button className="banner-close" type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
        <TransactionProgress progress={writeProgress} onReconcile={writeProgress.phase === 'RECONCILIATION_REQUIRED' ? reconcileProgress : undefined} />
        {pendingEntries.length > 0 && <div className="banner pending"><span className="banner-icon">↻</span><span>{pendingLabel(pendingEntries[0])} has a pending transaction that must be reconciled before another action.</span>{pendingEntries[0].tx_hash && pendingContextMatches ? <button className="banner-action" type="button" disabled={busyAction !== null} onClick={() => void reconcilePending(pendingEntries[0])}>{busyAction === `reconcile:${pendingEntries[0].reservation}` ? 'Checking…' : 'Reconcile'}</button> : <span className="pending-note">{pendingEntries[0].tx_hash ? 'Read-only: different network' : 'Awaiting transaction evidence'}</span>}</div>}

        {journalEntries.length > 0 && <section className="journal-panel panel" aria-label="Transaction recovery journal">
          <div className="journal-heading">
            <div><p className="eyebrow">Recovery</p><h2>Transaction journal</h2></div>
            <div className="journal-actions"><span className="journal-capacity">{journalEntries.length}/32 records</span><button className="quiet-button" type="button" onClick={exportJournal}>Export</button></div>
          </div>
          <div className="journal-list">
            {visibleJournalEntries.map((entry) => {
              const currentContext = entry.chain === String(genlayerChain.id)
              const contractMatches = Boolean(contractAddress) && entry.contract.toLowerCase() === contractAddress?.toLowerCase()
              const unresolved = entry.status !== 'VERIFIED' && entry.status !== 'FINALIZED_ERROR'
              const canReconcile = unresolved && Boolean(entry.tx_hash) && currentContext
              const reconcileKey = `reconcile:${entry.reservation}`
              return (
                <div className="journal-row" key={entry.reservation}>
                  <div className="journal-row-main"><strong>{pendingLabel(entry)}</strong><code>{entry.reservation.slice(0, 8)}…</code></div>
                  <StatusPill value={entry.status} />
                  <span className="journal-context">{!currentContext ? 'Read-only chain' : !contractMatches ? 'Stored contract' : entry.tx_hash ? 'Hash retained' : 'Awaiting hash'}</span>
                  {canReconcile ? <button className="banner-action" type="button" disabled={busyAction !== null} onClick={() => void reconcilePending(entry)}>{busyAction === reconcileKey ? 'Checking…' : 'Reconcile'}</button> : <span className="journal-state">{entry.status === 'VERIFIED' ? 'Verified' : entry.status === 'FINALIZED_ERROR' ? 'Finalized error' : 'Blocked'}</span>}
                </div>
              )
            })}
          </div>
          {journalPageCount > 1 && <div className="journal-pagination"><button className="quiet-button" type="button" disabled={journalPage === 0} onClick={() => setJournalPage((page) => page - 1)}>Previous</button><span>Page {journalPage + 1} of {journalPageCount}</span><button className="quiet-button" type="button" disabled={journalPage >= journalPageCount - 1} onClick={() => setJournalPage((page) => page + 1)}>Next</button></div>}
        </section>}

        <div className="workspace-grid">
          <CaseList ids={caseIds} selectedId={selectedId} count={caseCount} loading={loadingCases} onSelect={loadCase} onRefresh={() => void refreshCases()} />
          <section className="workspace-panel">
            {loadingCase && <div className="loading-state"><span className="spinner" />Loading case…</div>}
            {!loadingCase && !selectedCase && (
              <div className="panel content-panel">
                <div className="section-heading">
                  <div><p className="eyebrow">New case</p><h2>Create a conformance case</h2></div>
                  <span className="section-index">01</span>
                </div>
                <p className="section-intro">Bind each public requirement to one canonical ABI signature. Freezing computes and stores the deterministic conformance result.</p>
                <div className="public-boundary-note">
                  <strong>Public and permanent</strong>
                  <p>All submitted text will be public and permanent. Do not include private information, credentials or personal records.</p>
                  <p>Assessment of this exact submitted material only; not verification of external facts.</p>
                  <p>No deployed-code correctness claim.</p>
                </div>
                <CreateCaseForm disabled={writesDisabled} busy={busyAction === 'create_case'} onCreate={(nonce, base, parent) => void createCase(nonce, base, parent)} />
              </div>
            )}
            {!loadingCase && selectedCase && (
              <div className="panel content-panel">
                <div className="section-heading case-heading">
                  <div><p className="eyebrow">Case #{selectedCase.id}</p><h2>Conformance record</h2></div>
                  <div className="case-heading-meta"><StatusPill value={selectedCase.phase} /><span>Revision {selectedCase.revision}</span></div>
                </div>
                <div className="record-summary">
                  <div><span>Owner</span><strong>{shortenAddress(selectedCase.primary)}</strong></div>
                  <div><span>Parent</span><strong>{selectedCase.parent === '0' ? 'Top-level' : `Case #${selectedCase.parent}`}</strong></div>
                  <div><span>Evaluation</span><strong>Deterministic</strong></div>
                  <div><span>Outcome</span><strong>{selectedCase.outcome || 'Awaiting freeze'}</strong></div>
                </div>
                <div className="record-grid">
                  <div className="record-block">
                    <div className="block-heading"><span>Base specification</span><span className="block-meta">{selectedCase.base_locked ? 'Frozen' : 'Editable'}</span></div>
                    {selectedCase.phase === 'BASE_DRAFT' && <textarea className="record-editor" value={replaceJson} onChange={(event) => setReplaceJson(event.target.value)} rows={16} spellCheck={false} aria-label="Edit base specification JSON" />}
                    {selectedCase.phase !== 'BASE_DRAFT' && <pre className="json-view">{JSON.stringify(jsonSafe(selectedCase.base), null, 2)}</pre>}
                  </div>
                  <div className="record-block result-block">
                    <div className="block-heading"><span>Conformance result</span><span className="block-meta">{selectedCase.response_locked ? 'Locked' : 'Pending'}</span></div>
                    {selectedCase.outcome ? <div className="outcome-card"><span className="outcome-kicker">Contract outcome</span><strong>{outcomeCopy(selectedCase.outcome)}</strong><p>{selectedCase.outcome} · exact-signature labels are stored with the frozen revision.</p></div> : <div className="empty-result"><span className="result-mark">=</span><strong>No result yet</strong><span>Freeze the base specification to compute its exact-signature result.</span></div>}
                    <pre className="json-view compact">{JSON.stringify(jsonSafe(selectedCase.result), null, 2)}</pre>
                  </div>
                </div>
                <ConformanceMatrix record={selectedCase} />
                <div className="public-boundary-note case-boundary-note">
                  <p>Assessment of this exact submitted material only; not verification of external facts.</p>
                  <p>No deployed-code correctness claim.</p>
                </div>
                <div className="action-bar">
                  {!session && <span className="inline-hint">Connect the creating wallet to edit this case.</span>}
                  {selectedCase.phase === 'BASE_DRAFT' && <button className="secondary-button" type="button" disabled={writesDisabled || busyAction !== null} onClick={() => void runCaseAction('replace_base')}>{busyAction === 'replace_base' ? 'Saving…' : 'Replace base'}</button>}
                  {selectedCase.phase === 'BASE_DRAFT' && <button className="primary-button" type="button" disabled={writesDisabled || busyAction !== null} onClick={() => void runCaseAction('freeze_case')}>{busyAction === 'freeze_case' ? 'Freezing…' : 'Freeze & evaluate'}</button>}
                  <button className="quiet-button refresh-record" type="button" onClick={() => void loadCase(selectedCase.id)} disabled={loadingCase}>Refresh record</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <WalletChooser open={chooserOpen} options={walletOptions} busyId={chooserBusy} onChoose={(option) => void connect(option)} onClose={() => setChooserOpen(false)} />
    </div>
  )
}
