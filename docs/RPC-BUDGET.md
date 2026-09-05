# RPC budget matrix

Status: PRE_DEPLOY planning artifact. The rows marked `NOT YET MEASURED` are intentionally not live Studio or Vercel evidence. A later gate must replace those cells with measurements from the exact deployed revision/release; this document never turns a plan into an E2E claim.

Revision binding: the PRE_DEPLOY package binds this matrix to the exact source commit and file hashes recorded in `PRE-DEPLOY-READINESS.md`. Studio and frontend budgets are separate ledgers. A result in one ledger cannot satisfy the other.

## Shared budget rules

- Every RPC request, retry attempt, receipt query, readback, and wallet-provider request is counted in the evidence for the operation that triggered it.
- Reads use one shared FIFO queue. A hidden document pauses scheduled polling; it does not create a second poller. A new request is not submitted to compensate for a paused or uncertain read.
- Retry-After is honored. Retries are bounded; when the bound is exhausted, the hash/journal or read state is preserved and the UI stops automatic work.
- The implementation spends one request slot before every retry attempt: explicit list/detail reads are capped at one network attempt; a write has at most three finality attempts and two authoritative readback attempts; reconciliation has one receipt attempt and two readback attempts. A retry cannot silently amplify a row beyond its matrix maximum.
- Cache keys include chain, contract, method, and arguments. A mutation or explicit refresh invalidates the relevant cache before authoritative readback.
- No full-portfolio or interval polling is used. The landing view performs zero automatic chain reads.

## STUDIO RPC BUDGET MATRIX

Scope: Studio UI, Studio/RPC deployment workflow, and the bounded Studionet E2E run. These rows are independent of the browser frontend matrix.

| ID | Trigger / operation | RPC or Studio action | Planned maximum | Schedule / retry rule | Transaction maximum | Terminal condition and stop rule |
|---|---|---|---:|---|---:|---|
| S0 | Open Studio and select the locked account/network | Network check, account check, selected project/source metadata check | 4 requests total | One pass; no background refresh | 0 | Stop if chain/account/source does not match the locked PRE_DEPLOY package |
| S1 | Confirm source and ABI/schema before deployment | Source hash, schema/ABI, and deployment-input probes | 3 reads | One pass; no duplicate probe after a matching result | 0 | Stop on any source/schema/hash mismatch |
| S2 | Deploy the exact contract once | Deployment submission, bounded status checks, terminal receipt, deployed-source readback | 1 submit + 4 status/receipt checks + 1 source readback | Status at 10/20/40/80 seconds; honor Retry-After; no unbounded SDK poller | 1 | Stop after terminal receipt or after the fourth bounded status check; preserve the deployment hash |
| S3 | Create one case | Write submission, terminal receipt/status, `get_id_by_nonce`, version-1 readback | 1 submit + 4 status/receipt checks + 2 readbacks | One unique nonce; no automatic resubmit; cooldown is observed | 1 | Stop when the receipt is terminal and nonce/version readback agrees |
| S4 | Freeze one case | Write submission, terminal receipt/status, next-version readback | 1 submit + 4 status/receipt checks + 1 readback | One unique operation; retry only inside the bounded status/read policy | 1 | Stop on finalized success, finalized error with failure readback, or reconciliation-required |
| S5 | Evaluate one case | Write submission, terminal receipt/status, next-version semantic readback | 1 submit + 4 status/receipt checks + 1 readback | Do not poll validators indefinitely; preserve evidence on timeout | 1 | Stop only after finality/consensus and semantic outcome readback are authoritative |
| S6 | Retry one unresolved case | Write submission, terminal receipt/status, next-version semantic readback | 1 submit + 4 status/receipt checks + 1 readback | Respect the contract cooldown; no second retry for the same intent | 1 | Stop after the bounded attempt and authoritative history check |
| S7 | Explicit reconciliation of one retained hash | Receipt lookup, then the required historical/semantic readback | 1 receipt + 2 readbacks | One explicit user action; no parallel reconciliation beyond the two-entry UI limit | 0 | Stop at `FINALIZED`, `VERIFIED`, `FINALIZED_ERROR`, or `RECONCILIATION_REQUIRED` |

Studio evidence must report actual requests separately from transactions. The planned maxima above are hard stops for the normal journey; every transient retry attempt is included in the actual count and may cause the operation to stop earlier rather than exceed the declared cap.

## STUDIO RPC BUDGET EVIDENCE

Required for the Studio deploy/E2E gate. Replace `NOT YET MEASURED` only during the exact-revision live run.

| Exact revision / network / account | Operation | RPC method or Studio action | Trigger | Planned maximum | Actual count | Interval / attempts | Transaction hash | Retry-After / cooldown observed | Terminal condition | Receipt calls | Readback calls | Transaction count | Variance / explanation |
|---|---|---|---|---:|---:|---|---|---|---|---:|---:|---:|---|
| `NOT YET MEASURED` | S0–S1 preflight | `NOT YET MEASURED` | Studio opening/source selection | 7 reads | `NOT YET MEASURED` | one pass | n/a | `NOT YET MEASURED` | `NOT RUN` | 0 | 0 | 0 | Live Studio evidence required |
| `NOT YET MEASURED` | S2 deployment | `NOT YET MEASURED` | explicit deploy click | 6 reads + 1 tx | `NOT YET MEASURED` | 10/20/40/80s | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT RUN` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | Live Studio evidence required |
| `NOT YET MEASURED` | S3–S7 E2E operations | `NOT YET MEASURED` | one explicit operation each | row-specific | `NOT YET MEASURED` | bounded | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT RUN` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | Live Studio evidence required |

## FRONTEND RPC BUDGET MATRIX

Scope: the released browser frontend. Counts below are per explicit user action and include the frontend's read queue, cache, bounded retry, and journal/reconciliation behavior.

| ID | Screen / workflow trigger | RPC or provider action | Cache key / TTL | Planned maximum | Poll / retry / invalidation | Transaction maximum | Terminal condition |
|---|---|---|---|---:|---|---:|---|
| F0 | Landing page load | No chain request | n/a | 0 | No automatic refresh or polling | 0 | Remains local-only until an explicit action |
| F1 | Explicit `Refresh cases` click | `list_cases(1,4)` | `chain:contract:list_cases:[1,4]` / 5s; explicit refresh invalidates first | 1 chain read | One FIFO read; bounded transient retry; stop on retry budget exhaustion | 0 | Page returned or visible read error |
| F2 | Explicit case selection / `Refresh record` | `get_case(id)` | `chain:contract:get_case:[id]` / 5s; explicit selection invalidates first | 1 chain read | One FIFO read; no interval poll | 0 | Record returned or visible read error |
| F3 | Explicit wallet connect | `eth_requestAccounts`, one `eth_chainId`, one account-context check | provider context only / no cache | 1 chain-id read + wallet request/context checks | One pass; account/network mismatch fails closed | 0 | Selected provider/account/network is locked for the tab |
| F4 | One create-case write | wallet submission; up to 3 finality reads; nonce lookup + version readback | readback keys invalidated before use / 5s cache otherwise | 1 submit + 3 finality reads + 2 readbacks = 6 chain operations in the normal budget | Finality schedule 2/4/8s; bounded transient retry; one explicit reconciliation after uncertainty | 1 | `SUCCESS`, `FAILED`, `REJECTED`, or `RECONCILIATION_REQUIRED` |
| F5 | One case mutation (`replace_base`, `freeze_case`, `evaluate_case`, `retry_case`) | wallet submission; up to 3 finality reads; next-version readback | readback key invalidated before use / 5s cache otherwise | 1 submit + 3 finality reads + 2 readbacks = 6 chain operations in the normal budget | Finality schedule 2/4/8s; bounded transient retry; no automatic resubmit | 1 | Finalized semantic success, finalized error, or retained reconciliation |
| F6 | Explicit journal reconciliation | one receipt lookup; required historical/semantic readback | recovery gateway invalidated before readback / 5s cache otherwise | 1 receipt + up to 2 readbacks | One explicit reconciliation; no duplicate submission; stop after authoritative result | 0 | `VERIFIED`, `FINALIZED_ERROR`, or retained `RECONCILIATION_REQUIRED` |
| F7 | History / revision inspection | No public history polling UI is advertised in this release | n/a | 0 until a future explicit history control exists | If added, one explicit `get_version` click and its own evidence row are required | 0 | No hidden historical polling |

The six-operation write budget is the normal logical budget from the governing frontend rule: one submission, three bounded finality queries, and at most two readbacks. Transient retry attempts are not free; they are counted in measured evidence, honor Retry-After, and terminate the journey before a duplicate write can occur.

## FRONTEND RPC BUDGET EVIDENCE

Required for the exact final release and Vercel E2E gate. The current PRE_DEPLOY package has no public release or live measurement, so these rows remain explicitly unmeasured.

| Exact release / source commit | Workflow ID | Trigger | Planned maximum | Actual RPC/provider count | Cache hits / misses | Retry attempts / Retry-After | Poll intervals / attempts | Transaction hash | Receipt calls | Readback calls | Transaction count | Terminal phase | Variance / explanation |
|---|---|---|---:|---:|---|---|---|---|---:|---:|---:|---|---|
| `NOT YET MEASURED` | F0 | page load | 0 | `NOT YET MEASURED` | n/a | 0 | 0 | n/a | 0 | 0 | 0 | `NOT RUN` | Live release evidence required |
| `NOT YET MEASURED` | F1–F3 | explicit list/detail/connect actions | row-specific | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | n/a | `NOT YET MEASURED` | `NOT YET MEASURED` | 0 | `NOT RUN` | Live release evidence required |
| `NOT YET MEASURED` | F4–F6 | one unique write or reconciliation | row-specific | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | 2/4/8s or explicit reconciliation | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT RUN` | Live release evidence required |

No row in this file is a release approval. The live gate must bind the completed evidence to the deployed source commit, final release URL, network, account context, transaction hashes, finalized receipts, and authoritative readbacks.
