# Verification

Status: Studio E2E PASS and measured Vercel E2E PASS. Final anonymous `POST_GITHUB_VERCEL_FINAL` approval remains separate.

## Release binding

| Field | Verified value |
|---|---|
| Deployed source commit | `4bdd4f669fb83c9f98887ddae41bcbb7833ec834` |
| Contract source SHA-256 | `E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F` |
| Studionet contract | `0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D` |
| Explorer | https://explorer-studio.genlayer.com/address/0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D |
| Deployment transaction | `0xfceb8aa2abacfcdf8125482b2e3477ca422fdfb3f4460169dcc14fa45f048fd5` |
| Final Vercel deployment | `dpl_5BFvjqCAL4cZ5gEzwz7bZEmtYcec` |
| Live app | https://contract-spec-abi-conformance-gate.vercel.app |
| Measured release | https://contract-spec-abi-conformance-gate-qnksbt1yw-nec10.vercel.app/ |

Later commits contain only public documentation/evidence and repository presentation. Dependency analysis confirms no contract bytes, ABI, frontend behavior, configuration, bundle, wallet path, RPC instrumentation, or E2E condition changed; the exact measured result is retained under the documentation/evidence-only scoped-invalidation rule.

## Studio proof

The adapted run completed one deployment and four unique calls with five retained hashes and 53 bounded requests. Deployment, create, replace, and freeze finalized with semantic success. The stale negative finalized with structured `STALE_REVISION` execution error and unchanged state. Final readback was case 1 revision 3, `DONE`, `CONFORMANT`, labels `[IMPLEMENTS]`, with revision-1 history preserved.

| Operation | Transaction | Result |
|---|---|---|
| Deploy | `0xfceb8aa2abacfcdf8125482b2e3477ca422fdfb3f4460169dcc14fa45f048fd5` | FINALIZED; source readback PASS |
| Create | `0xbaf652eb52d9ac8995e269d10028f4ae48f13cee760d6b82f17cd622e60fbcc9` | FINALIZED; revision 1 |
| Replace | `0x1d119d3b7391b01f7e16c6c884e03945e557d92e49164ff9a1acf649e7d81a36` | FINALIZED; revision 2 |
| Freeze | `0xab999a2188b7e1f99adaea235fd771016164e12652619f7620d705662c8d0b5b` | FINALIZED; revision 3, DONE/CONFORMANT/IMPLEMENTS |
| Stale negative | `0xf8402587e60ae09f09331ed9770e5d6c1cea5653d15ae3149ad132b4a392e4b5` | FINALIZED execution error `STALE_REVISION`; state unchanged |

## Exact Vercel E2E proof

Chrome profile 6 tested the exact deployment with OKX Wallet account `0xe8d6c55838c39301c11d54fc9a38b9de298329f6`. The chooser exposed only installed OKX. One create and one freeze were submitted; no duplicate write occurred.

| Journey | Requests | Transaction | Authoritative result |
|---|---:|---|---|
| F0 construction | 0/0 | — | PASS |
| F1 explicit list | 1 per action | — | PASS |
| F2 explicit detail | 1/1 | — | PASS |
| F3 connect | 3 per action | — | Correct OKX identity/account |
| F4 create | 11/11 | `0x6442afeaacc1edcef4e1346d7606e18798561f802058746e3983822b0be859c3` | Case #10 revision 1 verified |
| F5 freeze | 10/11 | `0x8081a94315c879e264511fc4efed7d613040819b65dbccc76a5344180c7bc845` | Revision 2, DONE, CONFORMANT, IMPLEMENTS, frozen/locked |
| Reload/reconnect | 3 provider calls | — | Two journal rows VERIFIED; zero replay |
| F7 idle | 0/0 | — | No hidden polling |

The secret-free 30-event ledger is [vercel-e2e-rpc-evidence-20260907.json](evidence/vercel-e2e-rpc-evidence-20260907.json). Studio and frontend budgets remain separate; details are in [RPC-BUDGET.md](RPC-BUDGET.md).

## Reproducible checks

- Contract/runtime pytest — PASS.
- `genvm-lint check contracts/main.py` — PASS.
- Generated schema — PASS; 10 public methods.
- Frontend tests — 52/52 PASS.
- Typecheck — PASS.
- Production build — PASS with existing non-blocking chunk warning.
- Studio runner syntax and `git diff --check` — PASS.

## Security and limitations

No secret, private key, seed phrase, token, or wallet result is retained. Public addresses and hashes are included for reproducibility. The comparator checks canonical ABI signatures and submitted material, not deployed bytecode or external facts. Normalized V1 limits apply. There is no automatic history polling.

## GenLayer submission category and scorecard

Category: `PROJECT`. Validity gate: PASS for deployed source, live Studio proof, public repository, hosted frontend, and exact-release Vercel E2E; anonymous final approval remains pending.

- GenLayer fit — **4/5**: consensus-backed ownership, revision history, immutable freezing, and canonical conformance result solve the shared-trust problem. The deterministic adaptation intentionally avoids subjective equivalence.
- Contract quality — **4/5**: bounded data, strict normalization, optimistic revisions, immutable history, frozen locks, explicit errors, and positive/negative live proofs. It does not attest deployed bytecode.
- Engineering — **4/5**: layered contract/frontend tests, generated ABI, fail-closed wallet/write lifecycle, one-shot submission, separate measured RPC ledgers, exact source/release binding, and reproducible public evidence. The bundle-size warning remains.
- Frontend / UX — **4/5**: judge-facing create/read/freeze flow, correct EIP-6963 provider identity, explicit progress/failure states, persistent recovery journal, accessible controls, and measured Chrome E2E. History inspection is not exposed as a dedicated UI.

Overall: a strong, complete PROJECT candidate. Submission remains `NOT READY` until exact-revision anonymous `POST_GITHUB_VERCEL_FINAL` approval.
