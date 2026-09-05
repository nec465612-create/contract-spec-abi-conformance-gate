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
| Exact source commit | Fill at the correction commit before review |
| Exact source SHA-256 | Fill at the correction commit before review |
| Constructor arguments | None (`__init__()` only) |
| Linked contracts | None |
| Upgrade authority | None by intentional-freeze design |
| Studio deployer account | `0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902` (selected in the current Studio session; public address only) |
| Studio role | Deployment/signing account only; no upgrade role |

The manifest must be updated with the public Studio account, exact correction commit, source hash, contract address, and transaction hash after the corresponding gate allows each action. No private key, seed phrase, token, or credential belongs in this file.

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
