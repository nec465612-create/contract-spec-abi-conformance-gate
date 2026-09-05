import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ContractGateway,
  normalizeBaseJson,
  type CaseRecord,
} from './chain/contract'
import { contractAddress, runtimeConfigurationMessage, type ContractAddress } from './chain/config'
import { executeContractWrite, reconcileJournalEntry, writeIntent } from './chain/write-coordinator'
import { JournalError, JournalStore, type JournalEntry } from './persistence/journal'
import { jsonSafe, sha256Hex, stableStringify } from './lib/encoding'
import { requestAccounts, useWalletProviders } from './wallet/providers'
import type { WalletOption, WalletSession } from './wallet/types'
import './styles.css'

const SAMPLE_BASE = `{
  "requirements": [
    {
      "id": "transfer",
      "text": "The contract exposes a transfer operation.",
      "polarity": "REQUIRED"
    }
  ],
  "abi": [
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
  ]
}`

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
    return 'Local transaction recovery is unavailable. No action was submitted.'
  }
  if (error instanceof Error) {
    if (error.message === 'BASE_SPEC_SHAPE' || error.message === 'Unexpected end of JSON input') return 'Enter a valid base specification JSON object.'
    if (error.message === 'BASE_SPEC_TOO_LARGE') return 'The base specification is too large for this contract.'
    if (error.message.includes('AUTHORITATIVE_READBACK_MISMATCH')) return 'The transaction finalized, but the expected case state was not visible yet. Refresh and reconcile before retrying.'
    if (error.message.includes('STALE_REVISION')) return 'This case changed on chain. Refresh it before submitting another action.'
    if (error.message.includes('COOLDOWN')) return 'Retry is temporarily unavailable for this case. Wait for the contract cooldown and refresh.'
    if (error.message.includes('BAD_PHASE')) return 'That action is not available in the case’s current phase.'
    if (error.message.includes('cancelled')) return error.message
  }
  return 'The action could not be completed. Review the case and try again deliberately.'
}

function caseStateHash(record: CaseRecord): Promise<`0x${string}`> {
  return sha256Hex(stableStringify({
    id: record.id,
    revision: record.revision,
    phase: record.phase,
    base: record.base,
    outcome: record.outcome,
  }))
}

function pendingLabel(entry: JournalEntry): string {
  const caseMatch = /^case:(\d+):/.exec(entry.intent)
  if (caseMatch) return `Case #${caseMatch[1]}`
  if (entry.intent.startsWith('create:')) return 'New case'
  return 'Contract action'
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
        <span className="count-label">total cases</span>
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
  const [baseJson, setBaseJson] = useState(SAMPLE_BASE)
  const [parent, setParent] = useState('0')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onCreate(nonce.trim(), baseJson, parent.trim() || '0')
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
        <span>Base specification</span>
        <textarea value={baseJson} onChange={(event) => setBaseJson(event.target.value)} rows={18} spellCheck={false} aria-label="Base specification JSON" required />
        <small>Requirements and ABI entries are validated by the contract before the case is created.</small>
      </label>
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={disabled || busy}>{busy ? 'Preparing…' : 'Create case'}</button>
        {disabled && <span className="inline-hint">Connect a wallet to create a case.</span>}
      </div>
    </form>
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

  useEffect(() => {
    void (async () => {
      try {
        setJournalEntries(journal.loadAll())
        await journal.probe()
        setJournalReady(true)
      } catch {
        setJournalError('Transaction recovery is unavailable in this browser. Writes are disabled until local storage is available.')
      }
    })()
  }, [journal])

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
      const [count, page] = await Promise.all([gateway.getCount(), gateway.listCases()])
      setCaseCount(count)
      setCaseIds(page.ids)
    } catch {
      setError('Cases could not be loaded. Check the release configuration and try again.')
    } finally {
      setLoadingCases(false)
    }
  }, [gateway])

  useEffect(() => {
    if (journalReady) void refreshCases()
  }, [journalReady, refreshCases])

  const loadCase = useCallback(async (id: string) => {
    if (!gateway) return
    setSelectedId(id)
    setLoadingCase(true)
    setError(null)
    try {
      const record = await gateway.getCase(id)
      setSelectedCase(record)
      if (record) setReplaceJson(JSON.stringify(record.base, null, 2))
    } catch {
      setError('This case could not be read from the contract.')
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
    try {
      await executeContractWrite(journal, request)
      refreshJournal()
      gateway?.invalidate()
      await refreshCases()
      if (selectedId) await loadCase(selectedId)
      setNotice(successMessage)
    } catch (writeError) {
      setError(friendlyError(writeError))
    } finally {
      refreshJournal()
      setBusyAction(null)
    }
  }

  const reconcilePending = async (entry: JournalEntry) => {
    if (!gateway || !contractAddress) return
    setBusyAction('reconcile')
    setError(null)
    try {
      await reconcileJournalEntry(journal, entry, async () => {
        const createMatch = /^create:([0-9a-f]{32})$/.exec(entry.intent)
        if (createMatch) {
          const id = await gateway.getIdByNonce(entry.account as ContractAddress, createMatch[1])
          if (id === '0') throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          const record = await gateway.getCase(id)
          if (!record || record.revision !== '1') throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          return record
        }
        const caseMatch = /^case:(\d+):[a-z_]+$/.exec(entry.intent)
        if (!caseMatch) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        const record = await gateway.getCase(caseMatch[1])
        const expectedRevision = String(BigInt(entry.pre_revision) + 1n)
        if (!record || record.revision !== expectedRevision) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        return record
      })
      gateway.invalidate()
      refreshJournal()
      await refreshCases()
      if (selectedId) await loadCase(selectedId)
      setNotice(`${pendingLabel(entry)} was reconciled and verified.`)
    } catch (reconcileError) {
      setError(friendlyError(reconcileError))
    } finally {
      refreshJournal()
      setBusyAction(null)
    }
  }

  const createCase = async (nonce: string, baseJson: string, parent: string) => {
    if (!session || !gateway || !contractAddress) return
    setError(null)
    try {
      if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('BAD_NONCE')
      if (!/^\d+$/.test(parent)) throw new Error('BAD_PARENT')
      const { canonical } = normalizeBaseJson(baseJson)
      const preHash = await sha256Hex(canonical)
      const parentId = BigInt(parent)
      let createdId = ''
      await runWrite({
        provider: session.provider,
        account: session.account as ContractAddress,
        contract: contractAddress,
        method: 'create_case',
        args: [nonce, canonical, parentId],
        intent: writeIntent('create_case', null, nonce),
        preRevision: '0',
        preHash,
        readback: async () => {
          createdId = await gateway.getIdByNonce(session.account as ContractAddress, nonce)
          if (createdId === '0') throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          const record = await gateway.getCase(createdId)
          if (!record || record.revision !== '1') throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
          return record
        },
      }, 'Case created and verified on chain.')
      if (createdId) await loadCase(createdId)
    } catch (createError) {
      setError(friendlyError(createError))
    }
  }

  const runCaseAction = async (method: 'replace_base' | 'freeze_case' | 'evaluate_case' | 'retry_case') => {
    if (!session || !selectedCase || !gateway || !contractAddress) return
    const expectedRevision = selectedCase.revision
    const preHash = await caseStateHash(selectedCase)
    let args: [bigint, string, bigint] | [bigint, bigint]
    let canonical: string | null = null
    if (method === 'replace_base') {
      try {
        canonical = normalizeBaseJson(replaceJson).canonical
      } catch (replaceError) {
        setError(friendlyError(replaceError))
        return
      }
      args = [BigInt(selectedCase.id), canonical, BigInt(expectedRevision)]
    } else {
      args = [BigInt(selectedCase.id), BigInt(expectedRevision)]
    }
    const nextRevision = String(BigInt(expectedRevision) + 1n)
    await runWrite({
      provider: session.provider,
      account: session.account as ContractAddress,
      contract: contractAddress,
      method,
      args,
      intent: writeIntent(method, selectedCase.id, null),
      preRevision: expectedRevision,
      preHash,
      readback: async () => {
        const updated = await gateway.getCase(selectedCase.id)
        if (!updated || updated.revision !== nextRevision) throw new Error('AUTHORITATIVE_READBACK_MISMATCH')
        return updated
      },
    }, method === 'replace_base' ? 'Base specification replaced and verified.' : `${method.replace('_', ' ')} finalized and verified.`)
  }

  const configMessage = runtimeConfigurationMessage()
  const writesDisabled = !session || !journalReady || Boolean(journalError) || !contractAddress
  const pendingEntries = journalEntries.filter((entry) => entry.status !== 'VERIFIED' && entry.status !== 'FINALIZED_ERROR')

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
        {pendingEntries.length > 0 && <div className="banner pending"><span className="banner-icon">↻</span><span>{pendingLabel(pendingEntries[0])} has a pending transaction that must be reconciled before another action.</span>{pendingEntries[0].tx_hash ? <button className="banner-action" type="button" disabled={busyAction !== null || !gateway} onClick={() => void reconcilePending(pendingEntries[0])}>{busyAction === 'reconcile' ? 'Checking…' : 'Reconcile'}</button> : <span className="pending-note">Awaiting transaction evidence</span>}</div>}

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
                <p className="section-intro">Start with the user-facing requirements and the ABI surface they describe. The contract validates the shape and locks the source before evaluation.</p>
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
                  <div><span>Attempts</span><strong>{selectedCase.accepted_attempts}</strong></div>
                  <div><span>Outcome</span><strong>{selectedCase.outcome || 'Awaiting evaluation'}</strong></div>
                </div>
                <div className="record-grid">
                  <div className="record-block">
                    <div className="block-heading"><span>Base specification</span><span className="block-meta">{selectedCase.base_locked ? 'Frozen' : 'Editable'}</span></div>
                    {selectedCase.phase === 'BASE_DRAFT' && <textarea className="record-editor" value={replaceJson} onChange={(event) => setReplaceJson(event.target.value)} rows={16} spellCheck={false} aria-label="Edit base specification JSON" />}
                    {selectedCase.phase !== 'BASE_DRAFT' && <pre className="json-view">{JSON.stringify(jsonSafe(selectedCase.base), null, 2)}</pre>}
                  </div>
                  <div className="record-block result-block">
                    <div className="block-heading"><span>Evaluation result</span><span className="block-meta">{selectedCase.response_locked ? 'Locked' : 'Pending'}</span></div>
                    {selectedCase.outcome ? <div className="outcome-card"><span className="outcome-kicker">Contract outcome</span><strong>{selectedCase.outcome}</strong><p>Labels are stored with the frozen source revision.</p></div> : <div className="empty-result"><span className="result-mark">∿</span><strong>No evaluation yet</strong><span>Freeze the base specification to make it eligible for evaluation.</span></div>}
                    <pre className="json-view compact">{JSON.stringify(jsonSafe(selectedCase.result), null, 2)}</pre>
                  </div>
                </div>
                <div className="action-bar">
                  {!session && <span className="inline-hint">Connect the creating wallet to edit this case.</span>}
                  {selectedCase.phase === 'BASE_DRAFT' && <button className="secondary-button" type="button" disabled={writesDisabled || busyAction !== null} onClick={() => void runCaseAction('replace_base')}>{busyAction === 'replace_base' ? 'Saving…' : 'Replace base'}</button>}
                  {selectedCase.phase === 'BASE_DRAFT' && <button className="primary-button" type="button" disabled={writesDisabled || busyAction !== null} onClick={() => void runCaseAction('freeze_case')}>{busyAction === 'freeze_case' ? 'Freezing…' : 'Freeze case'}</button>}
                  {selectedCase.phase === 'FROZEN' && <button className="primary-button" type="button" disabled={writesDisabled || busyAction !== null} onClick={() => void runCaseAction('evaluate_case')}>{busyAction === 'evaluate_case' ? 'Evaluating…' : 'Evaluate case'}</button>}
                  {selectedCase.phase === 'UNRESOLVED' && selectedCase.accepted_attempts < 3 && <button className="primary-button" type="button" disabled={writesDisabled || busyAction !== null} onClick={() => void runCaseAction('retry_case')}>{busyAction === 'retry_case' ? 'Retrying…' : 'Retry evaluation'}</button>}
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
