# RPC budget matrix

Status: PRE_DEPLOY CHANGES REQUIRED. The original frozen Studio run remains historical evidence only; its RPC-STUDIO-001 measurement gap is not being replayed. The corrected runner has one current finalized disposable deployment with two accepted owner-bound case-1 writes; the run stopped at S4 because quorum-cancelled validator output was not yet classified correctly. A sparse finalized read confirms case count `1`, revision `2`, and `BASE_DRAFT`. The recovery manifest is `BLOCKED_PARTIAL_CASE_ACCEPTED`; frontend release evidence remains intentionally pending Vercel E2E.

Revision binding: the historical frozen Studio ledger binds to source commit de66367b459ed421b73bdfb7f3d04bf15088ed38, contract source SHA-256 AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45, chain 61999, contract 0x6de11297EaF221eb95A9E34e5A0e418061789250, and account 0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902. The current recovery state has the same source binding and one finalized disposable deployment at 0xa84f59Fb13056DF9707D4c0aaFFc730ec275afC5 with hash 0xe2307ea2f953e61c8963cce50225b420b5908652622c7396524c5a7773372509. Its manifest is `BLOCKED_PARTIAL_CASE_ACCEPTED`: case 1 create `0xea49bc...2ebef6` and replace `0x17fd39...eafe8` finalized with `MAJORITY_AGREE`; three validators returned `SUCCESS`, while one idle validator was cancelled after quorum. Sparse finalized readback confirms count `1`, revision `2`, and `BASE_DRAFT`; the creator key was not retained, so this deployment is never resumed. Studio and frontend budgets are separate ledgers. A result in one ledger cannot satisfy the other.

## Shared budget rules

- Every RPC request, retry attempt, receipt query, readback, and wallet-provider request is counted in the evidence for the operation that triggered it.
- Reads use one shared FIFO queue. A hidden document pauses scheduled polling; it does not create a second poller. A new request is not submitted to compensate for a paused or uncertain read.
- Retry-After is honored. Retries are bounded; when the bound is exhausted, the hash/journal or read state is preserved and the UI stops automatic work.
- The frontend implementation spends one request slot before every retry attempt: explicit list/detail reads are capped at one network attempt; a frontend write has at most three finality attempts and two authoritative readback attempts; frontend reconciliation has one receipt attempt and two readback attempts. The Studio runner uses its separate S0–S12 caps below, including four scheduled finality checks where declared. A retry cannot silently amplify a row beyond its matrix maximum.
- Cache keys include chain, contract, method, and arguments. A mutation or explicit refresh invalidates the relevant cache before authoritative readback.
- No full-portfolio or interval polling is used. The landing view performs zero automatic chain reads.

## STUDIO RPC BUDGET MATRIX

Scope: the measured disposable Studionet runner and the Studio deployment workflow. This ledger is independent of the browser frontend matrix. The runner enforces these row-specific caps before sending a request; a cap overflow stops the operation and cannot trigger a resubmission.

| ID | Trigger / operation | RPC or Studio action | Planned maximum | Schedule / retry rule | Transaction maximum | Terminal condition and stop rule |
|---|---|---|---:|---|---:|---|
| S0-funding | Fund one disposable account exactly once | `sim_fundAccount` | 1 | One request; no retry | 0 | Stop on any funding error |
| S0-preflight | Check chain, account, and balance | `eth_chainId`, `eth_getBalance` | 2 | One pass; no background refresh | 0 | Stop if chain is not 61999 or balance is unavailable |
| S1-schema | Verify exact source schema before deployment | `gen_getContractSchemaForCode` | 1 | One pass; no duplicate schema probe | 0 | Stop on source/schema/hash mismatch |
| S2-deploy | Deploy the exact contract once | SDK submission envelope, four bounded finality checks, deployed-source readback | 13 | Finality schedule 10/20/40/80 seconds; request timeout 30s; operation deadline 240s; no automatic retry | 1 | Stop at finality, cap overflow, timeout, or source-parity failure; preserve the hash immediately |
| S3-create-case1 | Create case 1 | SDK submission envelope, four bounded finality checks, `get_id_by_nonce`, `get_case` | 14 | One unique nonce; one-shot submission fuse; no resubmit | 1 | Stop when terminal receipt and both readbacks agree |
| S4-replace-case1 | Replace case 1 base | SDK submission envelope, four bounded finality checks, `get_case`, `get_version` | 14 | One unique operation; no resubmit | 1 | Stop on final success/error or reconciliation-required |
| S5-freeze-case1 | Freeze case 1 | SDK submission envelope, four bounded finality checks, `get_case`, `get_version` | 14 | One unique operation; no resubmit | 1 | Stop on final success/error or reconciliation-required |
| S6-evaluate-case1 | Evaluate conformant case 1 | SDK submission envelope, four bounded finality checks, semantic `get_case` | 13 | One unique operation; no resubmit | 1 | Stop only after finality and semantic readback |
| S7-stale-negative | Submit one stale-revision negative control | SDK submission envelope, four bounded finality checks, unchanged-state `get_case` | 13 | Require finalized `FINISHED_WITH_ERROR` plus `USER_ERROR STALE_REVISION`; no resubmit | 1 | Stop if error classification or unchanged-state proof is absent |
| S8-create-case2 | Create the exact unknown fixture | SDK submission envelope, four bounded finality checks, `get_id_by_nonce`, `get_case` | 14 | One unique nonce; no resubmit | 1 | Stop when terminal receipt and both readbacks agree |
| S9-freeze-case2 | Freeze case 2 | SDK submission envelope, four bounded finality checks, semantic `get_case` | 13 | One unique operation; no resubmit | 1 | Stop on final success/error or reconciliation-required |
| S10-evaluate-case2 | Evaluate unknown case 2 | SDK submission envelope, four bounded finality checks, semantic `get_case` | 13 | One unique operation; no resubmit | 1 | Stop only after finality and `UNKNOWN` readback |
| S11-retry-case2 | Read cooldown, wait once, and retry case 2 | One `get_case`, bounded cooldown wait, SDK submission envelope, four bounded finality checks, semantic `get_case` | 15 | `last_accepted_at` must be numeric and the wait must be ≤120s; no second retry | 1 | Stop before writing on invalid/excessive cooldown; otherwise stop after finality/readback |
| S12-reconciliation | Reconcile the retained evaluate hash | One receipt lookup, `get_case`, `get_count`, `get_version` | 4 | One explicit read-only pass; no parallel reconciliation | 0 | Stop after all three authoritative readbacks |

The SDK submission envelope is included in each write cap: nonce lookup, gas estimate, gas-price lookup, one raw submission, and its transport receipt check. The one-shot guard disables ABI-mismatch fallback and the transport fuse blocks any second `eth_sendTransaction`/`eth_sendRawTransaction`. Every request is recorded in the global `rpcRequests` list and in exactly one operation; `requestSequence` must equal the sum of all operation counts. Actual requests and transactions are reported separately.

## STUDIO RPC BUDGET EVIDENCE

### Measured disposable-run instrument

The frozen UI run could not be repaired because its request ledger was never retained. A fresh disposable run is therefore instrumented before any new deployment by [probes/studio_rpc_run.mjs](../probes/studio_rpc_run.mjs). It verifies the exact reviewed source commit/hash and exact endpoint, creates one ephemeral account, counts every JSON-RPC method through the installed GenLayerJS transport, records HTTP status, duration, `Retry-After`, terminal result, transaction hash, submission hash, and readback boundary, and writes a machine-readable evidence file under `docs/evidence/`. It stops on a row-cap overflow, rate limit, bounded request/operation deadline, malformed cooldown, finality timeout, or semantic/readback mismatch; it never resubmits a write.

The runner's explicit S0–S12 sequence is: disposable funding, chain/account preflight, source schema, one deployment, case-1 create/replace/freeze/evaluate, stale negative, case-2 create/freeze/evaluate, one cooldown-respecting retry, and retained-hash reconciliation. The unknown fixture is the exact prior case-2 fixture: the requirement intentionally asks about an external policy absent from the input and ABI, so the expected result is `UNKNOWN`. S11 owns both the cooldown read and wait; S12 owns one receipt plus three readbacks. The command is:

```text
STUDIO_RUN_CONFIRM=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN node probes/studio_rpc_run.mjs
```

The initial measured attempt finalized the deployment before the rate limiter blocked S3. A later exact resume attempt used a fresh disposable account, made 10 counted requests, and was blocked at S3 with HTTP 429 and `Retry-After: 46`; no case write was accepted. After the optimized resume path was reviewed, one explicit run made 21 counted requests, retained three hashes, and finalized case 1 create and replace writes before stopping at S4 classification. The separate sparse finalized read returned count `1`, revision `2`, and `BASE_DRAFT`. The runner now ignores only `CONSENSUS_VALIDATOR_QUORUM_REACHED` cancellation from an idle validator after quorum; actual execution errors remain blocking.

```text
STUDIO_RUN_CONFIRM=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN STUDIO_RESTART_PARTIAL_RUN=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN node probes/studio_rpc_run.mjs
```

The resume command is permanently blocked for this accepted owner-bound partial because its creator key was not retained. After a fresh exact-revision PRE_DEPLOY review, the single replacement command above is permitted; it creates exactly one new disposable deployment and is not a retry of either accepted case write. The historical rows below remain unchanged and still do not claim measurements from the frozen UI run.

The endpoint is pinned to `https://studio.genlayer.com/api`; any `STUDIO_RPC_ENDPOINT` override that differs from that exact value produces secret-free BLOCKED evidence with zero RPC requests. The instrument also emits one global `rpcRequests` list, operation-local events, row caps, request/operation deadlines, and immediately retained submission hashes. The current deployment, all blocked-run ledgers, accepted partial-write evidence, and superseded accepted-case recovery are recorded in [studio-rpc-recovery-manifest.json](evidence/studio-rpc-recovery-manifest.json). The latest sparse read is separate read-only corroboration in [studio-rpc-sparse-read-1788607499448.json](evidence/studio-rpc-sparse-read-1788607499448.json); it does not inflate or replace the full-run ledger.

### Latest measured partial run

Exact source commit `de66367b459ed421b73bdfb7f3d04bf15088ed38`, source SHA-256 `AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45`, chain `61999`, contract `0xa84f59Fb13056DF9707D4c0aaFFc730ec275afC5`, fresh case creator `0xb7e803f91336AA8646D7aD6E90327C3811c583D2`. The run made 21 requests, retained three transaction hashes, and stopped after S4. S1/S2 reused locally validated evidence and therefore made zero new RPC calls.

| Operation | Planned maximum | Actual RPC count | Transaction hash | Terminal evidence |
|---|---:|---:|---|---|
| S0-funding | 1 | 1 | n/a | PASS |
| S0-preflight | 2 | 2 | n/a | PASS |
| S1-schema | 1 | 0 | n/a | PASS; exact prior schema evidence reused |
| S2-deploy | 13 | 0 | `0xe2307ea2...3372509` | PASS; exact prior FINALIZED/source-readback evidence reused |
| S3-create-case1 | 14 | 10 | `0xea49bc...2ebef6` | FINALIZED, MAJORITY_AGREE, four SUCCESS validators; readbacks passed |
| S4-replace-case1 | 14 | 8 | `0x17fd39...eafe8` | FINALIZED, MAJORITY_AGREE; three SUCCESS validators and one idle quorum-cancelled validator; state readback preserved separately |
| **Total** | — | **21** | **3 retained hashes** | **BLOCKED_PARTIAL_CASE_ACCEPTED** |

The `S4` stop was a runner classification defect, not a rate-limit or submission failure. The idle validator returned `CONSENSUS_VALIDATOR_QUORUM_REACHED` after the quorum had already succeeded; the correction ignores that cancellation only and continues to reject any real execution error. The exact full evidence is `studio-rpc-run-1788607357538.json`; the two-request sparse finalized read is `studio-rpc-sparse-read-1788607499448.json`.

### Historical frozen UI status (not the new measured run)

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
