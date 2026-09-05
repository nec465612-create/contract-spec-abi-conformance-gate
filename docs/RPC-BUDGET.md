# RPC budget matrix

Status: ADAPTED STUDIO RUN BLOCKED_PARTIAL. The adapted contract computes exact-signature conformance during `freeze_case` and has no LLM, validator prompt, evaluation retry, cooldown, or health monitor. The locked S0–S7 Studio matrix has one retained adapted run through S3; continuation is review-gated and must not replay deployment/create. Frontend release evidence remains intentionally pending Vercel E2E.

Current source binding: adapted contract source SHA-256 `E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F`, implementation commit `cd833b78b43e22661ade6a4dddad3fc4269eb07a`, exact package HEAD `000e909d9be32cb34f8c6706cd012d5913f8b0b7`. Selected disposable Studio signer: `0x4a12D259dbBe3909d076b5b46B6809999748Fbc7` (public address only). Adapted deployment address is `0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D`; no deployment/create replay is permitted. Studio and frontend budgets are separate ledgers; one cannot satisfy the other.

## STUDIO RPC MEASUREMENT CAPABILITY PROBE — adapted source

STUDIO_CAPABILITY_PROBE_STATUS: COMPLETE
STUDIO_MEASUREMENT_MODE: OBSERVABLE_ACTION_LEDGER
STUDIO_MEASUREMENT_TIMING: PRE_E2E
STUDIO_CAPABILITY_PROBE_AT: 2026-09-06T02:46:00+07:00
STUDIO_FIRST_ACTION_AT: 2026-09-05T20:17:30.019Z
STUDIO_E2E_STARTED_AT: 2026-09-05T20:17:30.019Z
STUDIO_CAPABILITY_TOOL_OR_API: probes/studio_rpc_run.mjs global fetch instrumentation and operation ledger
STUDIO_CAPABILITY_CHECK: node --check probes/studio_rpc_run.mjs plus static verification of global rpcRequests, requestSequence, operation ownership, per-row caps, immediate transaction retention and one-shot submission guard
STUDIO_CAPABILITY_RESULT: every runner-visible Studio JSON-RPC action is assigned to one S0-S7 row; physical transport requests outside the instrument are not claimed
STUDIO_PHYSICAL_COUNT_SOURCE: docs/evidence/studio-rpc-run-1788639450020.json
STUDIO_PHYSICAL_COUNT_CLAIM: OBSERVABLE_LEDGER_ONLY
STUDIO_REPLAY_FOR_MEASUREMENT: NO

The mode was locked before the adapted-source Studio action. The retained run preserves every runner-visible request event, row count, transaction hash, bounded status check, terminal receipt and readback boundary. It made 21 observable requests and retained two hashes; S0–S3 are within cap and all events are operation-scoped. The runner stopped at S3 only because its earlier execution classifier treated quorum-idle receipts as an execution failure. A separate read-only reconciliation confirms create accepted and state is `id=1`, `count=1`, revision `1`, `BASE_DRAFT`. The current continuation path reclassifies only that retained operation and begins at S4; it cannot replay deployment/create.

## Historical Studio RPC measurement capability classification

STUDIO_CAPABILITY_PROBE_STATUS: NOT_APPLICABLE_RETROSPECTIVE_LEGACY
STUDIO_MEASUREMENT_MODE: OBSERVABLE_ACTION_LEDGER
STUDIO_MEASUREMENT_TIMING: RETROSPECTIVE_LEGACY
STUDIO_CAPABILITY_PROBE_AT: NOT_APPLICABLE_RETROSPECTIVE_LEGACY
STUDIO_FIRST_ACTION_AT: 2026-09-05T12:13:53.221Z
STUDIO_E2E_STARTED_AT: 2026-09-05T12:13:53.221Z
STUDIO_CAPABILITY_TOOL_OR_API: retained Studio UI/Explorer evidence plus probes/studio_rpc_run.mjs global fetch instrumentation
STUDIO_CAPABILITY_CHECK: retrospective inspection of actions, hashes, polls, receipts and readbacks; no pre-action probe or replay
STUDIO_CAPABILITY_RESULT: physical request telemetry unavailable for the legacy UI; observable ledger complete for the retained instrumented run through S6 stop
STUDIO_PHYSICAL_COUNT_SOURCE: NOT_APPLICABLE
STUDIO_PHYSICAL_COUNT_CLAIM: NONE
STUDIO_REPLAY_FOR_MEASUREMENT: NO

| Field | Locked value |
|---|---|
| Probe status | `NOT_APPLICABLE_RETROSPECTIVE_LEGACY` |
| Measurement mode | `OBSERVABLE_ACTION_LEDGER` |
| Measurement timing | `RETROSPECTIVE_LEGACY` |
| Capability source | Existing Studio UI/Explorer evidence plus retained `probes/studio_rpc_run.mjs` global fetch instrumentation |
| Capability result | The legacy UI has no complete physical request counter; the retained disposable run has a complete observable action/request ledger through its bounded S6 stop |
| Physical request source | `NOT_APPLICABLE` |
| Physical request claim | `NONE` |
| Replay or redeploy for measurement | `NO` |
| Locked evidence | [studio-rpc-observable-action-ledger-retrospective-20260906.json](evidence/studio-rpc-observable-action-ledger-retrospective-20260906.json) |

The retained Studio actions predate this capability-probe requirement, so this is an honest retrospective lock. It does not claim that the full POST_DEPLOY matrix passed: the observable ledger stops at S6 after a bounded finality failure, and the later sparse read records `FINALIZED/TIMEOUT` with unchanged state. Missing physical counts are not converted to zero or inferred from transaction totals.

## Shared budget rules

- Every RPC request, retry attempt, receipt query, readback, and wallet-provider request is counted in the evidence for the operation that triggered it.
- Reads use one shared FIFO queue. A hidden document pauses scheduled polling; it does not create a second poller. A new request is not submitted to compensate for a paused or uncertain read.
- Retry-After is honored. Retries are bounded; when the bound is exhausted, the hash/journal or read state is preserved and the UI stops automatic work.
- The frontend implementation spends one request slot before every retry attempt: explicit list/detail reads are capped at one network attempt; a frontend write has at most three finality attempts and two authoritative readback attempts; frontend reconciliation has one receipt attempt and two readback attempts. The adapted Studio runner uses its separate S0–S7 caps below, including four scheduled finality checks where declared. A retry cannot silently amplify a row beyond its matrix maximum.
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
| S5-freeze-case1 | Freeze and deterministically evaluate case 1 | SDK submission envelope, four bounded finality checks, `get_case`, `get_version` | 14 | One unique operation; no resubmit | 1 | Stop only after DONE/CONFORMANT/exact-label readback or terminal error |
| S6-stale-negative | Submit one stale-revision negative control | SDK submission envelope, four bounded finality checks, unchanged-state `get_case` | 13 | Require finalized execution error plus `USER_ERROR STALE_REVISION`; no resubmit | 1 | Stop if error classification or unchanged-state proof is absent |
| S7-reconciliation | Reconcile the retained freeze hash | One receipt lookup, `get_case`, `get_count`, `get_version` | 4 | One explicit read-only pass; no parallel reconciliation | 0 | Stop after all three authoritative readbacks |

The SDK submission envelope is included in each write cap: nonce lookup, gas estimate, gas-price lookup, one raw submission, and its transport receipt check. The one-shot guard disables ABI-mismatch fallback and the transport fuse blocks any second `eth_sendTransaction`/`eth_sendRawTransaction`. Every request is recorded in the global `rpcRequests` list and in exactly one operation; `requestSequence` must equal the sum of all operation counts. Actual requests and transactions are reported separately.

## STUDIO RPC BUDGET EVIDENCE

### Measured disposable-run instrument

The frozen UI run could not be physically reconstructed because its request ledger was never retained. Under the retrospective legacy mode above, this is recorded as an observable-ledger limitation rather than a request-count claim. The later disposable run is instrumented by [probes/studio_rpc_run.mjs](../probes/studio_rpc_run.mjs): it verifies the exact reviewed source commit/hash and exact endpoint, creates one ephemeral account, counts every JSON-RPC method through the installed GenLayerJS transport, records HTTP status, duration, `Retry-After`, terminal result, transaction hash, submission hash, and readback boundary, and writes a machine-readable evidence file under `docs/evidence/`. It stops on a row-cap overflow, rate limit, bounded request/operation deadline, finality timeout, or semantic/readback mismatch; it never resubmits a write.

The adapted runner's explicit S0–S7 sequence is: disposable funding, chain/account preflight, source schema, one deployment, case-1 create/replace/freeze, one stale negative, and retained-freeze-hash reconciliation. It submits five total transactions including deployment and contains no LLM evaluation or retry row. The command is:

```text
STUDIO_RUN_CONFIRM=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN node probes/studio_rpc_run.mjs
```

### Current adapted partial ledger

The exact adapted run is preserved locally in `docs/evidence/studio-rpc-run-1788639450020.json` (SHA-256 `CD5084333797668CA3C13852B51E859111E0C2E264B806A6A1544116FBA68C7C`) and the separate read-only reconciliation in `docs/evidence/studio-adapted-partial-reconciliation-1788639450020.json` (SHA-256 `A785FEE34E60495EB96B24589942195CC3184B1F18FA2DCA5C38C592DB1068B6`). The deployment finalized at `0xfceb8aa2abacfcdf8125482b2e3477ca422fdfb3f4460169dcc14fa45f048fd5`; the create finalized at `0xbaf652eb52d9ac8995e269d10028f4ae48f13cee760d6b82f17cd622e60fbcc9`. The run has `requestSequence=21`, `transactionCount=2`, and status `BLOCKED` only because of the corrected MAJORITY_AGREE/idle-receipt classification. No later write has been made.

| Operation | Planned maximum | Actual RPC count | Transaction hash | Terminal evidence |
|---|---:|---:|---|---|
| S0-funding | 1 | 1 | n/a | PASS |
| S0-preflight | 2 | 2 | n/a | PASS |
| S1-schema | 1 | 1 | n/a | PASS |
| S2-deploy | 13 | 9 | `0xfceb8aa2abacfcdf8125482b2e3477ca422fdfb3f4460169dcc14fa45f048fd5` | FINALIZED; source readback passed |
| S3-create-case1 | 14 | 8 | `0xbaf652eb52d9ac8995e269d10028f4ae48f13cee760d6b82f17cd622e60fbcc9` | FINALIZED MAJORITY_AGREE; read-only state reconciliation passed |
| **Total** | — | **21** | **2 retained hashes** | **BLOCKED_PARTIAL; continuation review required** |

The read-only reconciliation is [studio-adapted-partial-reconciliation-1788639450020.json](evidence/studio-adapted-partial-reconciliation-1788639450020.json). The continuation command, when separately approved, must use the retained evidence paths and `STUDIO_PARTIAL_RESUME=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN`; it starts at S4 and never resubmits S2/S3.

## Historical superseded-source runs (not current adapted source)

Everything below this heading is bound to the old nondeterministic contract and cannot satisfy the current adapted-source PRE_DEPLOY gate. It is retained only to preserve the prior reviewer/audit trail.

The initial measured attempt finalized the deployment before the rate limiter blocked S3. A later exact resume attempt used a fresh disposable account, made 10 counted requests, and was blocked at S3 with HTTP 429 and `Retry-After: 46`; no case write was accepted. The next optimized run made 21 counted requests, retained three hashes, and finalized case 1 create and replace before the quorum-cancellation classification correction. A later replacement attempt was blocked at S0 funding by HTTP 429 with no transaction. The prior explicit replacement made 52 counted requests and finalized evaluate as `MAJORITY_DISAGREE`; the current fresh replacement made 52 counted requests, retained five hashes, finalized deployment/create/replace/freeze, and finalized `evaluate_case` as `TIMEOUT` after validator timeout. The sparse read confirmed no evaluation mutation. The old runner ignored only `CONSENSUS_VALIDATOR_QUORUM_REACHED` cancellation from an idle validator after quorum; actual execution errors, consensus disagreement, and validator timeout remained blocking.

```text
STUDIO_RUN_CONFIRM=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN STUDIO_RESTART_PARTIAL_RUN=CONTRACT_SPEC_ABI_CONFORMANCE_GATE_STUDIO_MEASURED_RUN node probes/studio_rpc_run.mjs
```

The resume command is permanently blocked for this accepted owner-bound partial because its creator key was not retained. The latest replacement deployment also has an unavailable creator key and a finalized `TIMEOUT` evaluation; no evaluate retry is permitted. Any further replacement would require a new exact-revision PRE_DEPLOY review. The historical rows below remain unchanged and still do not claim measurements from the frozen UI run.

The endpoint is pinned to `https://studio.genlayer.com/api`; any `STUDIO_RPC_ENDPOINT` override that differs from that exact value produces secret-free BLOCKED evidence with zero RPC requests. The instrument also emits one global `rpcRequests` list, operation-local events, row caps, request/operation deadlines, and immediately retained submission hashes. The current deployment, all blocked-run ledgers, accepted partial-write evidence, and superseded recovery are recorded in [studio-rpc-recovery-manifest.json](evidence/studio-rpc-recovery-manifest.json). The latest full ledger is `studio-rpc-run-1788610697042.json` with 52 requests, five retained hashes, and a bounded S6 finality stop. The separate sparse read is [studio-rpc-sparse-read-1788610828786.json](evidence/studio-rpc-sparse-read-1788610828786.json); it confirms finalized `TIMEOUT`, unchanged case state, and no retry.

### Latest measured partial run

Exact source commit `de66367b459ed421b73bdfb7f3d04bf15088ed38`, source SHA-256 `AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45`, chain `61999`, contract `0x976E9e852C00FAbB4137DeaC50e475DE01B3A1F1`, fresh case creator `0x345904aCc1DA18b8a8Af77D4Ae16E99e3f73bFe3`. The run made 52 requests, retained five transaction hashes, and stopped after S6 finality. All operations stayed within their row caps and all 52 global events were scoped.

| Operation | Planned maximum | Actual RPC count | Transaction hash | Terminal evidence |
|---|---:|---:|---|---|
| S0-funding | 1 | 1 | n/a | PASS |
| S0-preflight | 2 | 2 | n/a | PASS |
| S1-schema | 1 | 1 | n/a | PASS |
| S2-deploy | 13 | 9 | `0xef2320...b9e1495` | FINALIZED, MAJORITY_AGREE, source readback passed |
| S3-create-case1 | 14 | 10 | `0x78452b...30f9f4a` | FINALIZED, MAJORITY_AGREE, readbacks passed |
| S4-replace-case1 | 14 | 10 | `0x33caa1...ea0f97` | FINALIZED, MAJORITY_AGREE, readbacks passed |
| S5-freeze-case1 | 14 | 10 | `0x32afee...a06e533` | FINALIZED, MAJORITY_AGREE, readbacks passed |
| S6-evaluate-case1 | 13 | 9 | `0x64c579...80a5fca` | FINALIZED, TIMEOUT; validator votes TIMEOUT/TIMEOUT/IDLE/TIMEOUT/IDLE; state unchanged |
| **Total** | — | **52** | **5 retained hashes** | **BLOCKED_PARTIAL_CASE_ACCEPTED** |

The latest stop was not a rate-limit or runner-classification defect. `evaluate_case` reached `FINALIZED` with `result_name=TIMEOUT` after validator timeout; the vote vector was `TIMEOUT/TIMEOUT/IDLE/TIMEOUT/IDLE`. The separate sparse read confirmed `get_count=1` and case 1 remained revision `3`, `FROZEN`, with `last_operation=freeze_case`; no evaluate retry was submitted. Exact full evidence is `studio-rpc-run-1788610697042.json`; sparse evidence is `studio-rpc-sparse-read-1788610828786.json`.

After that terminal evidence, one separate read-only `gen_getTransactionStatus` diagnostic was attempted against the retained S6 hash. The endpoint returned HTTP 200 with RPC error `-32603` because it could not adapt the object-shaped parameter; no alternate payload was retried. The diagnostic is preserved in [studio-rpc-status-diagnostic-1788612789642.json](evidence/studio-rpc-status-diagnostic-1788612789642.json), records zero state-changing requests, and is not part of the measured S0–S12 request total or release authorization.

A bounded follow-up read-only compatibility diagnostic is preserved in [studio-rpc-status-string-compat-1788618280.json](evidence/studio-rpc-status-string-compat-1788618280.json). Sending the retained hash as the documented method's string-shaped parameter returned HTTP 200 and `FINALIZED`; the unavailable lifecycle method returned `-32601`. This resolves the payload-shape ambiguity without a write, retry, appeal, or alternate lifecycle action. It is out-of-band diagnostic evidence: zero state-changing requests, not part of the S0–S12 total, and not release authorization.

The reviewer-scoped view diagnostic is preserved in [studio-view-diagnostic-1788618524737.json](evidence/studio-view-diagnostic-1788618524737.json). It made exactly one bounded `gen_call` read for `get_case(1)`, returned HTTP 200, and corroborated the sparse state at revision `3` / `FROZEN` with `accepted_attempts=0`; transaction count and state-changing request count were both zero. An exploratory state-method simulation is separately marked excluded in [studio-gen-call-excluded-simulation-1788618468466.json](evidence/studio-gen-call-excluded-simulation-1788618468466.json) and is not part of any budget or gate.

The earlier rate-limited replacement attempt remains retained as `studio-rpc-run-1788608380680.json`: S0-funding `1/1`, request sequence `1`, transaction count `0`, and no deployment or case write. Its separate sparse read confirmed the prior deployment state. It was not retried automatically.

### Historical frozen UI status (not the new measured run)

The Studio run produced exactly one deployment and nine unique contract calls, all with retained hashes and Explorer lifecycle confirmation. The transaction count is therefore measured exactly. The Studio UI did not preserve a structured per-operation request ledger that could be exported after the run; the raw UI captures expose automatic sim_fundAccount session/account rows and a later 30 requests per minute rate-limit message, but not a complete historic request count for each receipt, poll, or readback. Those automatic funding rows were not user-triggered actions. Replaying the run to manufacture a count is forbidden by the one-deploy and unique-write rule.

This is an explicit measurement limitation, not a PASS and not a physical-count claim. It is carried into the anonymous POST_DEPLOY_TEST package for independent adjudication under `OBSERVABLE_ACTION_LEDGER`. No transaction, funding action, Reset Storage action, duplicate deployment, or duplicate write was performed to fill the gap.

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
Historical post-review remediation audit: after the reviewer returned RPC-STUDIO-001, all Studio tabs were closed to stop background traffic. After cooldown, a fresh Contracts tab immediately hit 30 requests per minute -32029 while Studio’s developer log reported gen_getContractSchema and Monaco Linter errors. A Run and Debug deep-link reproduced the rate-limit state. The permitted browser evaluate context has no fetch, XMLHttpRequest, performance, or equivalent network-counter API, and Studio dev logs do not provide a complete successful-request ledger. No API key, Reset Storage action, disposable deployment, or new transaction was used. Actual per-operation Studio RPC counts remained unmeasured in that audit; it kept the gate blocked rather than fabricating compliance. The later retrospective observable-action ledger is the current measurement classification.

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

The six-operation write budget is the normal logical budget from the governing frontend rule: one submission, three bounded finality queries, and at most two readbacks. Transient retry attempts are not free; they are counted in measured evidence, honor Retry-After, and terminate the journey before a duplicate write can occur. The frontend write coordinator also installs a per-submission one-shot transport guard, so GenLayerJS ABI-mismatch fallback cannot issue a second wallet send; the retained journal entry remains the reconciliation boundary.

## FRONTEND RPC BUDGET EVIDENCE

### Current status

No public release or Vercel browser run exists yet. Actual frontend RPC/provider counts are therefore NOT RUN BY DESIGN, not zero and not a pass. The source-level controls and regression tests are complete: one shared read client, FIFO read queue, cache and single-flight behavior, bounded 2/4/8-second finality checks, three-attempt transient retry budget, Retry-After handling, two-readback write budget, one-shot submission protection against SDK fallback, journal reconciliation, and no automatic landing-page chain read. The F0–F7 frontend matrix below remains the required measurement plan for Vercel E2E.

### PRE_DEPLOY evidence template (not run)

Required for the exact final release and Vercel E2E gate. The current PRE_DEPLOY package has no public release or live measurement, so these rows remain explicitly unmeasured.

| Exact release / source commit | Workflow ID | Trigger | Planned maximum | Actual RPC/provider count | Cache hits / misses | Retry attempts / Retry-After | Poll intervals / attempts | Transaction hash | Receipt calls | Readback calls | Transaction count | Terminal phase | Variance / explanation |
|---|---|---|---:|---:|---|---|---|---|---:|---:|---:|---|---|
| `NOT YET MEASURED` | F0 | page load | 0 | `NOT YET MEASURED` | n/a | 0 | 0 | n/a | 0 | 0 | 0 | `NOT RUN` | Live release evidence required |
| `NOT YET MEASURED` | F1–F3 | explicit list/detail/connect actions | row-specific | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | n/a | `NOT YET MEASURED` | `NOT YET MEASURED` | 0 | `NOT RUN` | Live release evidence required |
| `NOT YET MEASURED` | F4–F6 | one unique write or reconciliation | row-specific | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | 2/4/8s or explicit reconciliation | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT YET MEASURED` | `NOT RUN` | Live release evidence required |

No row in this file is a release approval. The live gate must bind the completed evidence to the deployed source commit, final release URL, network, account context, transaction hashes, finalized receipts, and authoritative readbacks.
