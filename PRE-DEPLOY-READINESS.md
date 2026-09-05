# PRE_DEPLOY readiness

Status: ADAPTED STUDIO RUN BLOCKED_PARTIAL — the approved deterministic-freeze adaptation removes the LLM/validator operation that produced the historical S6 timeout. One exact adapted deployment and create are finalized and retained; the S3 classification correction and S4–S7 continuation require targeted exact-revision review. Historical Studio evidence is not reused as proof for this source; GitHub/Vercel publication and Vercel E2E have not started.

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
| Explorer | https://explorer-studio.genlayer.com/address/0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D |
| Contract address | `0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D` |
| Deployment transaction | `0xfceb8aa2abacfcdf8125482b2e3477ca422fdfb3f4460169dcc14fa45f048fd5` (FINALIZED) |
| Exact source commit | `cd833b78b43e22661ade6a4dddad3fc4269eb07a` |
| Exact source SHA-256 | `E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F` (`contracts/main.py`) |
| Constructor arguments | None (`__init__()` only) |
| Linked contracts | None |
| Upgrade authority | None by intentional-freeze design |
| Studio deployer account | `0x4a12D259dbBe3909d076b5b46B6809999748Fbc7` (offline-selected disposable signer; public address only) |
| Studio role | Deployment/signing account only; no upgrade role |

The prior addresses and transactions remain historical evidence for superseded source bytes only. The adapted deployment above is not a release approval: the remaining continuation, POST_DEPLOY_TEST, GitHub/Vercel publication, Vercel E2E, final review, and Explorer submission remain separate gates. No private key, seed phrase, token, or credential belongs in this file.

The live deployment/readback ledger and the separate Studio/frontend RPC status are in [`docs/VERIFICATION.md`](docs/VERIFICATION.md) and [`docs/RPC-BUDGET.md`](docs/RPC-BUDGET.md).

## Runtime compatibility decision

The exact package/runtime roles and the previously ambiguous `0.39.2` target are resolved in [`docs/RUNTIME-COMPATIBILITY.md`](docs/RUNTIME-COMPATIBILITY.md). In summary, `0.39.2` is the installed `genlayer` CLI version; the contract execution identity is its first-line `Depends` hash; and `genlayer-py 0.16.3`, `genlayer-test 0.29.2`, and `genvm-linter 0.11.0` are separately recorded host-side Direct Mode tools. This decision does not substitute a Python package version for the contract runtime and does not claim hosted Studio E2E.

## RPC economy and proof budget

This plan applies both RPC layers: the released frontend and the primary-AI Studio/proof run. It is a budget and operating constraint, not live evidence.

### Frontend Studionet RPC

- `getReadClient()` is the single configured read client. `ContractGateway` shares one cache per chain/contract; cache keys include chain ID, contract, method, and normalized arguments.
- Identical in-flight reads are single-flight. Safe reads are cached for a short bounded window and invalidated after a write, authoritative transition, account/network change, or contract-context change. Invalidated in-flight results cannot repopulate the cache.
- The public screen uses one deliberate `list_cases` read per explicit refresh and reports the returned visible-page count; case selection uses one `get_case` read. There is no continuous background poller. The separate planned/evidence tables are in `docs/RPC-BUDGET.md`.
- A write is submitted once. Finality uses only the lightweight GenLayer transaction object on a bounded `2s -> 4s -> 8s` schedule, then performs the required method-specific authoritative readback. A transient read is retried at most three times with `Retry-After` or bounded exponential backoff plus jitter and cancellation; it never resubmits the write.
- Hidden/unmounted/disconnected views stop or cancel finality waits. RPC failures stay visibly classified as temporary RPC unavailability or reconciliation uncertainty.

### Studio and proof-tooling RPC

- The primary AI uses one in-app Studio tab or the already reviewed one-shot runner, one shared chain/RPC reader, one active matrix row, and at most one read in flight. No background health monitor, parallel Studio tabs, duplicate Explorer refreshes, or competing pollers are allowed.
- For each live write row: take one minimum pre-state snapshot; authorize and submit exactly once; retain the hash immediately; observe completion on the existing Studio transaction journey or with sparse completion-based status checks at `10s -> 20s -> 40s -> 80s` (maximum four checks, one at a time); stop polling when terminal, hidden, disconnected, aborted, or still pending after the bound.
- At terminal state, perform one full transaction/readback inspection and only the minimum authoritative post-state reads needed by that row, followed by one Explorer/RPC corroboration for the consequential write. Stop all status polling before starting the next row.
- On `429`, server-busy, or transient transport failure, honor `Retry-After`; otherwise use bounded backoff, stop before the budget is exhausted, preserve the existing hash/state, and perform at most one explicit sparse reconciliation. Never replay a write because a status/readback call failed.
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
| S3 | Deterministic freeze and positive consequence | `freeze_case(id, 2)` | Revision `3`, `DONE`, locks true, `CONFORMANT`, exact `IMPLEMENTS` matrix; revision `2` unchanged |
| S4 | Negative/no-write boundary | stale `replace_base(id, base, 2)` after revision `3` | Finalized expected `STALE_REVISION` execution error and unchanged authoritative state/history |
| S5 | Read-only surface | `get_case`, `get_version`, `get_count`, paginated indexes | Exact canonical records and no mutation |

The live matrix is evidence to be produced in `POST_DEPLOY_TEST`; this document is the PRE_DEPLOY plan and limitation disclosure, not live proof.
