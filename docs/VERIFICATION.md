# Live verification

Status: PRE_DEPLOY REBUILD IN PROGRESS. The user-approved deterministic-freeze adaptation is implemented locally and has no deployment, Studio RPC run, GitHub/Vercel publication, or Vercel E2E evidence. Historical nondeterministic deployment and timeout artifacts remain preserved but are not reusable for this source.

Evidence date: 2026-09-06 (Asia/Saigon)

## Current adapted-source status

| Field | Value |
|---|---|
| Adapted source commit | `cd833b78b43e22661ade6a4dddad3fc4269eb07a` |
| Adapted source SHA-256 | `E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F` |
| Adapted Studio deployment | None |
| Adapted deployment hash | None |
| Adapted live manifest | None |
| Adapted public ABI | 10 methods: 7 views and 3 writes |
| Adapted deterministic terminal path | `freeze_case`: revision `3`, `DONE`, exact-signature result |
| Adapted Studio account | `0x4a12D259dbBe3909d076b5b46B6809999748Fbc7` (deployment/signing role; selected offline, no transaction) |
| Local evidence | Direct Mode `13 passed`; frontend `42 passed`; frontend production build PASS; runner `node --check` PASS; wrong-endpoint fail-closed check PASS with zero requests |
| Release boundary | No Studio RPC, GitHub/Vercel publication, or Vercel E2E has occurred |

The adapted source requires a fresh exact-revision anonymous `PRE_DEPLOY` decision. Studio and frontend RPC ledgers remain separate; the current adapted runner is a proof artifact only until that decision exists.

## Historical superseded-source recovery (not current adapted source)

The following paragraphs and evidence files are bound to the old nondeterministic source and are retained for audit continuity only. They do not establish current deployment, readiness, or release status.

The accepted owner-bound case creator key was not retained, so the historical deployment was not resumed. Its finalized evaluation timeout remains preserved as failed historical evidence with unchanged authoritative state; no evaluation retry was submitted.

A single later read-only status diagnostic is preserved in [studio-rpc-status-diagnostic-1788612789642.json](evidence/studio-rpc-status-diagnostic-1788612789642.json). The endpoint returned an RPC parameter error; no alternate payload or state-changing request was attempted. This diagnostic does not override the existing full/sparse authoritative evidence or claim validator readiness.

A bounded follow-up read-only diagnostic is preserved in [studio-rpc-status-string-compat-1788618280.json](evidence/studio-rpc-status-string-compat-1788618280.json). The same endpoint accepted the string-shaped `gen_getTransactionStatus` parameter and returned `FINALIZED` for the retained S6 hash; `gen_getTransactionLifecycle` is unavailable (`-32601`). This confirms finality and backend method compatibility only. It used zero state-changing requests and does not override the full receipt, semantic readback, or readiness gate.

One reviewer-scoped view diagnostic is preserved in [studio-view-diagnostic-1788618524737.json](evidence/studio-view-diagnostic-1788618524737.json). It used exactly one bounded `gen_call` read for `get_case(1)` and returned HTTP 200 with revision `3`, phase `FROZEN`, `accepted_attempts=0`, and `last_operation=freeze_case`; transaction count and state-changing request count were both zero. This corroborates the sparse authoritative read and does not authorize replacement or override the platform readiness gate.

An exploratory simulation of `evaluate_case(1,3)` is preserved separately as [studio-gen-call-excluded-simulation-1788618468466.json](evidence/studio-gen-call-excluded-simulation-1788618468466.json) and explicitly excluded from review evidence because it invoked a state-modifying method through a simulation path. It produced no transaction or state change, but it is not used to support any gate or release claim.

The timestamped read-only Studio platform health response is preserved in [studio-platform-health-1788613593.json](evidence/studio-platform-health-1788613593.json). It returned HTTP 200 with `status=degraded`, `max_recovery_cycles_exhausted`, one stuck finalization, and a 46-transaction no-progress backlog; GenVM and LLM providers were healthy. The platform artifact is external operational evidence for the current validator/consensus blocker, not readiness or release authorization.

Three further read-only health samples over the next check intervals are preserved in [studio-platform-health-window-1788613802.json](evidence/studio-platform-health-window-1788613802.json). All remained `DEGRADED` with the same recovery exhaustion, stuck finalization, and failed/suppressed progress checks; the readiness predicate therefore remains false.

The later recovery window is preserved in [studio-platform-health-recovery-window-1788617987.json](evidence/studio-platform-health-recovery-window-1788617987.json). Two read-only samples returned top-level and consensus `HEALTHY`, with no exhausted recovery and no orphaned transactions; however, `stuck_finalization_count=1` and the progress-check flags remain, so this is partial recovery evidence and not replacement authorization.

The measurement-mode lock is preserved in [studio-rpc-observable-action-ledger-retrospective-20260906.json](evidence/studio-rpc-observable-action-ledger-retrospective-20260906.json). The physical request count is explicitly `NONE`; the retained instrumented disposable run records 52 observable requests across S0–S6, five submitted hashes, bounded status checks, terminal/readback evidence and zero duplicate transactions. The older frozen UI run remains a retrospective observable-action record with an unreconstructable physical count. This corrects the measurement classification only; it does not convert the S6 `TIMEOUT` or platform-health predicate into PASS.

A fresh bounded read-only health sample is preserved in [studio-platform-health-current-1788630182.json](evidence/studio-platform-health-current-1788630182.json). It reports `status=degraded`, issue `max_recovery_cycles_exhausted`, `stuck_finalization_count=1`, `max_recovery_exhausted_count=1`, `no_progress_check_error=true`, `no_progress_scan_suppressed=true`, and backlog `48`; this is current external platform evidence and keeps the Studio readiness predicate false. No write, retry, redeploy, or release action followed the sample.

## Historical frozen UI binding (not current measured run)

| Field | Value |
|---|---|
| Source commit | de66367b459ed421b73bdfb7f3d04bf15088ed38 |
| Contract source | contracts/main.py |
| Contract source SHA-256 | AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45 |
| ABI/schema file | contract-schema.json |
| ABI/schema SHA-256 | 1B8AFAAA48F5AF435A99D29F54AB1EBAD3E7A78308FCE7CDFD1E446294A71642 |
| Network | GenLayer Studionet |
| Chain ID | 61999 |
| Studio RPC | https://studio.genlayer.com/api |
| Studio account | 0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902 |
| Contract address | 0x6de11297EaF221eb95A9E34e5A0e418061789250 |
| Explorer contract | https://explorer-studio.genlayer.com/address/0x6de11297EaF221eb95A9E34e5A0e418061789250 |
| Studio source file | contract_spec_abi_conformance_gate.py |

The deployed Studio source was the exact reviewed contract source, including its first-line runtime dependency declaration. No private key, seed phrase, wallet credential, or token is recorded here.

## Historical superseded-source local verification

The following verification block is bound to the historical source commit `de66367b459ed421b73bdfb7f3d04bf15088ed38` and is not current adapted-source evidence.

- Contract tests: 15 passed with py -3.13 -m pytest probes/test_runtime_probe.py tests/test_contract.py -q -p no:cacheprovider.
- GenVM lint: passed with PYTHONIOENCODING=utf-8 genvm-lint check contracts/main.py.
- ABI generation: passed with genvm-lint schema contracts/main.py --output contract-schema.json; 12 public methods.
- Frontend tests: 41 passed across 9 files with npm test -- --run from frontend.
- Frontend typecheck: passed with npm run typecheck.
- Frontend production build: passed with npm run build; only the existing Vite chunk-size warning was emitted.
- git diff --check: passed.

## Historical frozen UI transaction ledger (not current measured run)

Explorer showed exactly 10 transactions for this contract: one deployment and nine calls. Each row below has a unique transaction hash. The deployment and every call reached FINALIZED; successful rows show GenVM SUCCESS and Accepted consensus. The negative stale-revision row intentionally shows GenVM ERROR with Accepted consensus and no state mutation.

| Step | Method and fixture | Transaction | Lifecycle evidence | Authoritative result |
|---|---|---|---|---|
| Deploy | Exact reviewed source, no constructor arguments | https://explorer-studio.genlayer.com/tx/0x92e04e6f6074d5a4d688ac54ee5374f70a3de1856c9440aa0fdd73fe6f99d094 | FINALIZED, GenVM SUCCESS, Accepted | Contract address above |
| S1 | create_case, nonce c0f03716fea36fa4643b82f9bde0faf0, parent 0 | https://explorer-studio.genlayer.com/tx/0xfcbf3a83adecfccd83a7ede8a4d6538895dfc2e2480b93a0ebad5673c1cf67dd | FINALIZED, GenVM SUCCESS, Accepted | Case 1 created at revision 1 |
| S2 | replace_base case 1, expected revision 1, ABI function check_v2 | https://explorer-studio.genlayer.com/tx/0x9452ddce5ef186eef7e556de80cc2f621a147c01fa219d3963a0e3072d8c38e9 | FINALIZED, GenVM SUCCESS, Accepted | Revision 2; revision 1 history preserved |
| S3 | freeze_case case 1, expected revision 2 | https://explorer-studio.genlayer.com/tx/0x289a645c90f6fe42e361ca9f5bf7686b6c6861caeee78ab0bf8ad2630566df4c | FINALIZED, GenVM SUCCESS, Accepted | Revision 3 FROZEN; base_locked and response_locked true |
| S4 | evaluate_case case 1, expected revision 3 | https://explorer-studio.genlayer.com/tx/0x42f248b91b4305a8836c4a71df7800c3c11699b76cef66ed79d03290b6ab2960 | FINALIZED, GenVM SUCCESS, Accepted | Revision 4 DONE, outcome CONFORMANT, result labels IMPLEMENTS |
| S5 | stale replace_base case 1, expected revision 3 | https://explorer-studio.genlayer.com/tx/0x2b4e650cde18a2403900e1587a03276ee788d0e69441d843d06fd882c752cb51 | FINALIZED, GenVM ERROR, Accepted | USER_ERROR STALE_REVISION; case 1 remained revision 4 DONE |
| S6-create | create_case unresolved fixture, nonce 6c4158ea665e0aa601a5d0189180473e, parent 0 | https://explorer-studio.genlayer.com/tx/0x8dafd80106e1f82e0c18be0bcafcec79bf71019569e1bb50ae0bb4f57059b236 | FINALIZED, GenVM SUCCESS, Accepted | Case 2 created at revision 1 |
| S6-freeze | freeze_case case 2, expected revision 1 | https://explorer-studio.genlayer.com/tx/0x7c85bd63e058ed6ae040480d007e86f768eed4adf82faf56db42fd8c1d725bed | FINALIZED, GenVM SUCCESS, Accepted | Case 2 revision 2 FROZEN |
| S6-evaluate | evaluate_case case 2, expected revision 2 | https://explorer-studio.genlayer.com/tx/0x47ac017edabfd89ff30e06e1b0f8d4d18bacea6ee77ee5f54eb945cfb88f0750 | FINALIZED, GenVM SUCCESS, Accepted | Case 2 revision 3 UNRESOLVED, UNKNOWN, accepted_attempts 1 |
| S6-retry | retry_case case 2, expected revision 3, after the 60-second cooldown | https://explorer-studio.genlayer.com/tx/0x6e1d187eb44b667cd333ab8409d45ae4353a9a422b167de4854ab5a895e0e229 | FINALIZED, GenVM SUCCESS, Accepted | Case 2 revision 4 UNRESOLVED, UNKNOWN, accepted_attempts 2 |

## Historical frozen UI readback and no-write proof (not current measured run)

The final read-only Studio surface used the Finalized state selector. It returned:

- get_case(1): revision 4, phase DONE, base_locked true, response_locked true, accepted_attempts 1, outcome CONFORMANT, result {labels: [IMPLEMENTS], v: 1}, last_operation evaluate_case.
- get_count(): 2.
- get_version(1, 1): the original BASE_DRAFT with the original ABI function check; the revision-1 create operation and create hash were unchanged.
- get_version(1, 2): the replacement draft with ABI function check_v2 was preserved after freeze and evaluation.
- The stale S5 transaction returned USER_ERROR STALE_REVISION and the authoritative current case remained revision 4 DONE. No stale write was accepted.
- Case 2 readback after the first evaluation showed UNRESOLVED and UNKNOWN with one accepted attempt. After the cooldown and one retry, it showed UNRESOLVED and UNKNOWN with two accepted attempts. No second retry was submitted.

The Explorer contract page reported 20 validators and exactly 10 contract transactions. No transaction was replayed to compensate for a status or UI problem. Studio storage was not reset.

## Two independent RPC ledgers

The two RPC rules remain separate:

1. Studio/proof-tooling RPC covers Studio opening, source/schema probes, one deployment, write lifecycle observation, receipt/finality checks, authoritative readbacks, cooldown, and recovery.
2. Frontend/release RPC covers the browser release, its one shared read client and FIFO queue, explicit reads, bounded finality checks, retry budget, cache invalidation, journal reconciliation, and Vercel E2E measurements.

The implementation and planned limits for both ledgers are in docs/RPC-BUDGET.md. The Studio transaction cardinality and all hashes are measured above. A structured per-operation Studio RPC request export was not preserved by the Studio UI: raw UI captures exposed automatic sim_fundAccount session/account rows and a later 30 requests per minute rate-limit message, but did not retain a complete machine-readable count for every historic read, receipt check, or poll. The automatic sim_fundAccount rows were not user-triggered funding actions. Because replaying the deployment or writes would violate the one-deploy/unique-write rule, this gap is recorded as a measurement limitation rather than converted into a false PASS.

On the recovery tab, retries stopped at the observed 30 requests per minute limit. The exact contract was reopened after cooldown and the Explorer was used read-only to corroborate state. No Reset Storage action, funding action, duplicate deployment, or duplicate write was performed.

Frontend live counts are intentionally not claimed here: the Vercel release and browser E2E have not started. The frontend matrix remains a required part of the next release gate, not a Studio substitute.

## Remaining gate boundary

## Post-review remediation audit

The retained reviewer report identified RPC-STUDIO-001 as a blocking missing structured per-operation Studio request ledger. Safe recovery attempts were made without replaying the original address: all Studio tabs were closed to stop background traffic; after cooldown, a fresh Contracts tab immediately produced Rate limit exceeded: 30 requests per minute -32029 and gen_getContractSchema errors from the Studio developer log; a fresh Run and Debug deep-link also surfaced the same rate-limit state. The permitted browser evaluate context exposes no fetch, XMLHttpRequest, performance, or equivalent network-counter API, and Studio dev logs expose errors rather than a complete successful-request ledger.

No API key was available, no Reset Storage action was executed, and no disposable deployment was submitted because the Studio service remained rate-limited before a clean measured S0/S1 run could begin. The original contract address remains read-only evidence only. At the time of that historical audit, the evidence did not close RPC-STUDIO-001; it records why replaying or fabricating counts would violate the RPC-economy rule. The later retrospective-ledger correction closes the finding under the current governing rule.

This document preserves the historical frozen Studio deployment/E2E ledger, the current instrumented recovery evidence, and the planned frontend release measurements. It is not a current Studio E2E PASS, Vercel E2E result, GitHub/Vercel final approval, or Explorer submission approval.
