# RPC budget matrix

Status: POST_DEPLOY_TEST CHANGES REQUIRED. The original PRE_DEPLOY matrices remain below as historical plan templates. The live Studio evidence is recorded separately; RPC-STUDIO-001 remains open and the frontend release evidence is intentionally pending Vercel E2E.

Revision binding: the live Studio ledger binds to source commit de66367b459ed421b73bdfb7f3d04bf15088ed38, contract source SHA-256 AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45, chain 61999, contract 0x6de11297EaF221eb95A9E34e5A0e418061789250, and account 0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902. Studio and frontend budgets are separate ledgers. A result in one ledger cannot satisfy the other.

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

### Live status

The Studio run produced exactly one deployment and nine unique contract calls, all with retained hashes and Explorer lifecycle confirmation. The transaction count is therefore measured exactly. The Studio UI did not preserve a structured per-operation request ledger that could be exported after the run; the raw UI captures expose automatic sim_fundAccount session/account rows and a later 30 requests per minute rate-limit message, but not a complete historic request count for each receipt, poll, or readback. Those automatic funding rows were not user-triggered actions. Replaying the run to manufacture a count is forbidden by the one-deploy and unique-write rule.

This is an explicit measurement limitation, not a PASS. It is carried into the anonymous POST_DEPLOY_TEST package for independent adjudication. No transaction, funding action, Reset Storage action, duplicate deployment, or duplicate write was performed to fill the gap.

| Exact live row | Planned maximum | Exact measured transaction count | Exact measured readback surface | Actual Studio RPC request count | Status / variance |
|---|---:|---:|---|---|---|
| S0–S1 preflight | 7 reads, 0 tx | 0 | Exact source selected; chain 61999; account and schema context checked | Not reconstructable from the retained Studio UI log | Measurement gap; no replay permitted |
| Deploy | 6 reads + 1 tx | 1 | Terminal deployment receipt and Explorer contract address | Not reconstructable from the retained Studio UI log | Measurement gap; deploy hash retained |
| S1 create_case case 1 | 6 reads + 1 tx | 1 | Case 1 revision 1 and exact creator/base readback | Not reconstructable from the retained Studio UI log | Measurement gap; unique nonce |
| S2 replace_base case 1 | 5 reads + 1 tx | 1 | Current revision 2 plus historical revision 1 | Not reconstructable from the retained Studio UI log | Measurement gap; no replay |
| S3 freeze_case case 1 | 5 reads + 1 tx | 1 | Current revision 3 plus historical revision 2 | Not reconstructable from the retained Studio UI log | Measurement gap; no replay |
| S4 evaluate_case case 1 | 5 reads + 1 tx | 1 | Revision 4, DONE, CONFORMANT, result IMPLEMENTS | Not reconstructable from the retained Studio UI log | Measurement gap; semantic result retained |
| S5 stale negative | 5 reads + 1 tx | 1 | USER_ERROR STALE_REVISION and unchanged revision 4 | Not reconstructable from the retained Studio UI log | Measurement gap; finalized error is intentional |
| S6 create/freeze/evaluate/retry case 2 | Four row-specific budgets, 4 tx | 4 | Revisions 1, 2, 3, and 4; UNKNOWN attempt count 1 to 2 | Not reconstructable from the retained Studio UI log | Measurement gap; one retry after 60-second cooldown |
| S7 read-only reconciliation | 1 receipt + 2 readbacks planned | 0 | get_case(1), get_count(), get_version(1,1), with Finalized selector | Not reconstructable from the retained Studio UI log | Read-only evidence exact; request total unavailable |

The recovery tab hit the observed 30 requests per minute Studio limit. Per the governing rule, retries stopped, the hash/state was preserved, cooldown was honored, and Explorer was used read-only for corroboration. The frontend ledger below remains independent and has not been substituted by this Studio result.
Post-review remediation audit: after the reviewer returned RPC-STUDIO-001, all Studio tabs were closed to stop background traffic. After cooldown, a fresh Contracts tab immediately hit 30 requests per minute -32029 while Studio’s developer log reported gen_getContractSchema and Monaco Linter errors. A Run and Debug deep-link reproduced the rate-limit state. The permitted browser evaluate context has no fetch, XMLHttpRequest, performance, or equivalent request-counter API, and Studio dev logs do not provide a complete successful-request ledger. No API key, Reset Storage action, disposable deployment, or new transaction was used. Actual per-operation Studio RPC counts remain unmeasured; this audit keeps the gate blocked rather than fabricating compliance.

### PRE_DEPLOY template (historical)


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

### Current status

No public release or Vercel browser run exists yet. Actual frontend RPC/provider counts are therefore NOT RUN BY DESIGN, not zero and not a pass. The source-level controls and regression tests are complete: one shared read client, FIFO read queue, cache and single-flight behavior, bounded 2/4/8-second finality checks, three-attempt transient retry budget, Retry-After handling, two-readback write budget, journal reconciliation, and no automatic landing-page chain read. The F0–F7 frontend matrix below remains the required measurement plan for Vercel E2E.

### PRE_DEPLOY evidence template (not run)

Required for the exact final release and Vercel E2E gate. The current PRE_DEPLOY package has no public release or live measurement, so these rows remain explicitly unmeasured.

| Exact release / source commit | Workflow ID | Trigger | Planned maximum | Actual RPC/provider count | Cache hits / misses | Retry attempts / Retry-After | Poll intervals / attempts | Transaction hash | Receipt calls | Readback calls | Transaction count | Terminal phase | Variance / explanation |
|---|---|---|---:|---:|---|---|---|---|---:|---:|---:|---|---|
| `NOT YET MEASURED` | F0 | page load | 0 | `NOT YET MEASURED` | n/a | 0 | 0 | n/a | 0 | 0 | 0 | `NOT RUN` | Live release evidence required |
| `NOT YET MEASURED` | F1–F3 | explicit list/detail/connect actions | row-specific | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | n/a | `NOT YET MEASURED` | `NOT YET MEASURED` | 0 | `NOT RUN` | Live release evidence required |
| `NOT YET MEASURED` | F4–F6 | one unique write or reconciliation | row-specific | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | 2/4/8s or explicit reconciliation | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT RUN` | Live release evidence required |

No row in this file is a release approval. The live gate must bind the completed evidence to the deployed source commit, final release URL, network, account context, transaction hashes, finalized receipts, and authoritative readbacks.
