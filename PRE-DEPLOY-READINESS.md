# PRE_DEPLOY readiness

Status: DRAFT — no Studio signature, deployment, transaction, GitHub push, or Vercel publication has been performed.

## Contract lifecycle classification

Classification: `INTENTIONALLY FROZEN`

The binding Stage 2 baseline advertises one single contract and explicitly excludes an upgrade mechanism. This product has no `upgrade` entry point or upgrader storage. A post-deployment defect therefore requires a new contract deployment from the reviewed source; the existing address and state are not upgrade-recoverable.

This classification is a release decision, not a claim that the contract survives a chain reset. It must remain visible in the final deployment evidence and be confirmed before the PRE_DEPLOY authorization is accepted.

## Secret-free draft manifest

| Field | Value |
|---|---|
| Network | GenLayer Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://genlayer-explorer.vercel.app` |
| Contract address | Not deployed |
| Deployment transaction | Not submitted |
| Exact source commit | `f9fa45d4bb9fea829ee878b9bc2d3bd8b41fc85c` (correction commit; contract/frontend bytes) |
| Exact source SHA-256 | `AA023CABE575E346739C51DA0C49A6C77BE8ED4DB3C035A23AFDFC32D894BE45` (`contracts/main.py`) |
| Constructor arguments | None (`__init__()` only) |
| Linked contracts | None |
| Upgrade authority | None by intentional-freeze design |
| Studio deployer account | `0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902` (selected in the current Studio session; public address only) |
| Studio role | Deployment/signing account only; no upgrade role |

The manifest must be updated with the contract address and transaction hash after the corresponding gate allows deployment. No private key, seed phrase, token, or credential belongs in this file.

## RPC economy and proof budget

This plan applies both RPC layers: the released frontend and the primary-AI Studio/proof run. It is a budget and operating constraint, not live evidence.

### Frontend Studionet RPC

- `getReadClient()` is the single configured read client. `ContractGateway` shares one cache per chain/contract; cache keys include chain ID, contract, method, and normalized arguments.
- Identical in-flight reads are single-flight. Safe reads are cached for a short bounded window and invalidated after a write, authoritative transition, account/network change, or contract-context change. Invalidated in-flight results cannot repopulate the cache.
- The public screen uses one deliberate `list_cases` read per explicit refresh and reports the returned visible-page count; case selection uses one `get_case` read. There is no continuous background poller. The separate planned/evidence tables are in `docs/RPC-BUDGET.md`.
- A write is submitted once. Finality uses only the lightweight GenLayer transaction object on a bounded `2s -> 4s -> 8s` schedule, then performs the required method-specific authoritative readback. A transient read is retried at most three times with `Retry-After` or bounded exponential backoff plus jitter and cancellation; it never resubmits the write.
- Hidden/unmounted/disconnected views stop or cancel finality waits. RPC failures stay visibly classified as temporary RPC unavailability or reconciliation uncertainty.

### Studio and proof-tooling RPC

- The primary AI uses one in-app Studio tab, one shared chain/RPC reader, one active matrix row, and at most one read in flight. No parallel Studio tabs, ad-hoc scripts, duplicate Explorer refreshes, or competing pollers are allowed.
- For each live write row: take one minimum pre-state snapshot; authorize and submit exactly once; retain the hash immediately; observe completion on the existing Studio transaction journey or with sparse completion-based status checks at `10s -> 20s -> 40s -> 80s` (maximum four checks, one at a time); stop polling when terminal, hidden, disconnected, aborted, or still pending after the bound.
- At terminal state, perform one full transaction/readback inspection and only the minimum authoritative post-state reads needed by that row, followed by one Explorer/RPC corroboration for the consequential write. Stop all status polling before starting the next row.
- On `429`, server-busy, or transient transport failure, honor `Retry-After`; otherwise use bounded backoff, stop before the budget is exhausted, preserve the existing hash/state, and resume with one sparse reconciliation after cooldown. Never replay a write because a status/readback call failed.
- The run records attempted rows, retries, call counts, intervals, hashes, and readback evidence. A pending or unavailable row remains unresolved; it is not converted to PASS by a screenshot, timeout, or assumed Studio result.

## Recovery limits and runbook

- **Local UI/storage reset while chain state remains:** reconnect the recorded public Studio deployment account, restore the exact reviewed release, configure the recorded contract address, and verify the frozen contract through the live matrix. The browser journal is not the source of truth for chain state.
- **Recorded account becomes unavailable:** a frozen contract cannot be upgraded. Keep the old address read-only if it remains available, deploy a replacement from the exact recorded source/constructor manifest, rerun the matrix, then update the public configuration.
- **Studionet or chain-state reset:** the old address/state cannot be recovered by this product. Redeploy from the recorded source and rerun every live proof row; never claim address continuity across a reset.
- **Pending wallet transaction:** preserve the immutable transaction hash and reconcile only that hash. A missing hash never authorizes a second submission.

## Minimum Studio E2E matrix

All rows are secret-free and must be executed only after anonymous `PRE_DEPLOY` approval. Each row records the exact source hash, public Studio account/role, transaction hash, lifecycle, execution result, consensus/finality, authoritative readback, and PASS/FAIL.

| ID | Risk/proof | Method | Expected authoritative result |
|---|---|---|---|
| S1 | Create and nonce identity | `create_case` with a fresh lowercase 32-hex nonce, valid one-function base, parent `0` | `FINALIZED` + successful execution; revision `1`, `BASE_DRAFT`, exact base and creator |
| S2 | Draft replacement and history | `replace_base(id, valid base, 1)` | Revision `2`, `BASE_DRAFT`, exact new base; revision `1` unchanged |
| S3 | Freeze transition | `freeze_case(id, 2)` | Revision `3`, `FROZEN`, both lock flags true; revision `2` unchanged |
| S4 | Positive evaluation | `evaluate_case(id, 3)` with deterministic agreement fixture | Revision `4`, terminal outcome and exact result vector; historical revision `3` unchanged |
| S5 | Negative/no-write boundary | malformed/extra-key base or stale revision | Rejected write and unchanged authoritative pre-state/history |
| S6 | Unresolved retry boundary | agreed `UNKNOWN`, then retry only after cooldown | `UNRESOLVED` then accepted retry/exhaustion with exact attempt count and history |
| S7 | Read-only surface | `get_case`, `get_version`, `get_count`, paginated indexes | Exact canonical records and no mutation |

The live matrix is evidence to be produced in `POST_DEPLOY_TEST`; this document is the PRE_DEPLOY plan and limitation disclosure, not live proof.
