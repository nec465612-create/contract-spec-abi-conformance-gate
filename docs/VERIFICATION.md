# Live verification

Status: POST_DEPLOY_TEST CHANGES REQUIRED. Studio execution/readbacks are complete, but the anonymous reviewer’s P0 Studio RPC measurement finding remains open; the Vercel browser run has not started.

Evidence date: 2026-09-05 (Asia/Saigon)

## Exact binding

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

## Local verification retained from the exact source revision

- Contract tests: 15 passed with py -3.13 -m pytest probes/test_runtime_probe.py tests/test_contract.py -q -p no:cacheprovider.
- GenVM lint: passed with PYTHONIOENCODING=utf-8 genvm-lint check contracts/main.py.
- ABI generation: passed with genvm-lint schema contracts/main.py --output contract-schema.json; 12 public methods.
- Frontend tests: 39 passed across 8 files with npm test -- --run from frontend.
- Frontend typecheck: passed with npm run typecheck.
- Frontend production build: passed with npm run build; only the existing Vite chunk-size warning was emitted.
- git diff --check: passed.

## Studio deployment and transaction ledger

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

## Readback and no-write proof

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

No API key was available, no Reset Storage action was executed, and no disposable deployment was submitted because the Studio service remained rate-limited before a clean measured S0/S1 run could begin. The original contract address remains read-only evidence only. This audit does not close RPC-STUDIO-001; it records why replaying or fabricating counts would violate the RPC-economy rule.

This document is evidence for the retained exact source, the completed Studio deployment/E2E, and the planned frontend release measurements. It is not a Vercel E2E result, GitHub/Vercel final approval, or Explorer submission approval.
