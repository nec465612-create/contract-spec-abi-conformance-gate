# ABI Conformance Gate

ABI Conformance Gate turns a public interface specification into a frozen, revisioned on-chain record and deterministically checks its canonical function signatures against a normalized ABI.

[Live app](https://contract-spec-abi-conformance-gate.vercel.app) · [Studionet contract](https://explorer-studio.genlayer.com/address/0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D) · [Verification](docs/VERIFICATION.md)

## Trust problem and design

Teams can silently change prose requirements, ABI files, or a comparison result after review. This project makes the submitted specification, revision history, ownership, lock state, canonical signatures, and result authoritative on GenLayer instead of trusting a mutable document or frontend.

Create a case, optionally replace its editable base with an expected revision, then freeze it. The contract stores `IMPLEMENTS`, `MISSING`, or `FORBIDDEN_PRESENT` labels and the aggregate outcome. GenLayer is the shared consensus/state layer; the React frontend only normalizes input, discovers wallets, submits explicit transactions, and renders authoritative reads. Local journal and RPC evidence are recovery aids, never the source of truth.

## Intelligent Contract

The contract provides seven views and three writes: create, replace, and freeze/evaluate. Revision preconditions reject stale writes. Frozen base/result fields cannot change. Validators execute the same canonical comparison; no subjective LLM decision is used in this deterministic adaptation.

## Transaction lifecycle

Each click permits one wallet submission. The app records the returned hash, polls finality on a bounded 5/10/20-second schedule, requires execution `SUCCESS`, then performs at most two authoritative readbacks. Reloaded unresolved hashes can be reconciled explicitly; verified entries are never replayed. See [RPC budgets](docs/RPC-BUDGET.md).

## Run locally

Requires Node.js 20+, npm, and a browser wallet on GenLayer Studionet.

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Set `VITE_CONTRACT_ADDRESS=0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D`. The fixed Studionet configuration is in `frontend/src/chain/config.ts`.

## Tests and deployment

```powershell
py -3.13 -m pytest probes/test_runtime_probe.py tests/test_contract.py -q -p no:cacheprovider
cd frontend
npm test -- --run
npm run typecheck
npm run build
```

Current results: contract/runtime PASS; frontend 52/52 PASS; typecheck PASS; production build PASS with a non-blocking bundle-size warning. Contract source SHA-256 is `E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F`.

The Studionet contract is `0xBf6DF2A308D0C9916dBC6a15b0325CBdc9D8498D`; deployment transaction `0xfceb8aa2abacfcdf8125482b2e3477ca422fdfb3f4460169dcc14fa45f048fd5` finalized successfully. Full source parity and live proofs are in [Verification](docs/VERIFICATION.md).

## Security and limitations

Wallet identity is checked before submission; contract ownership and revisions authorize mutation; submitted text is public and permanent; no credentials belong in cases or environment files. The contract has no privileged reset path.

- Canonical signatures use the supported normalized V1 ABI subset.
- Conformance proves interface shape, not deployed bytecode correctness or external facts.
- The frontend lists four cases per explicit request and has no automatic history polling.
- The production bundle emits a non-blocking size warning.
