# Contract Spec ABI Conformance Gate — Build Specification

Status: Deterministic-freeze adaptation approved and implemented locally
Submission category: `PROJECT`  
Workflow: Build  
Research baseline: exact approved `STAGE-1.md` and `STAGE-2.md`

## Product baseline

Protocol authors bind each public REQUIRED/FORBIDDEN description to one exact canonical ABI function signature and submit a normalized ABI. The contract validates both shapes, freezes them, computes the complete requirement/function matrix by exact equality, and stores one of `CONFORMANT`, `FORBIDDEN_SURFACE`, or `MISSING_REQUIRED_SURFACE` in the same transaction. Explanatory prose cannot change the result.

The product evaluates only the exact submitted bytes. It does not inspect deployed bytecode, prove implementation correctness, verify external facts, or claim that an interface is secure. The on-chain consequence is eligibility: only `CONFORMANT` is eligible. No token, payment, custody, external API, linked contract, backend, or automatic timer is in scope.

## Lifecycle classification

This single contract is `INTENTIONALLY FROZEN`. The binding Stage 2 baseline excludes an upgrade mechanism, so no upgrader storage or `upgrade` method is part of the public surface. A post-deployment defect requires a replacement deployment from the exact recorded source and constructor manifest; this classification does not claim that address or state survives a Studionet reset. The secret-free account, recovery runbook, and minimum live matrix are recorded in `PRE-DEPLOY-READINESS.md`.

Actors and authority remain exactly as approved:

- Primary/secondary: the creator; may create, replace the complete draft base, and freeze it.
- Any reader: may inspect cases, revisions, actor index, and child cases.
- Primary/secondary: freezing a draft also computes its deterministic terminal result.
- Source of truth: canonicalized requirement and ABI JSON stored by the contract.

## Locked public protocol

The persistent fields, capacities, nonce idempotency, actor/child/history indexes, exact ABI grammar, deterministic result vector, reducer precedence, no-write failure behavior, and readback requirements remain binding. The user-approved deterministic-freeze adaptation in `STAGE-2.md` supersedes the original C1 nondeterministic lifecycle and public interface.

The single deployable contract exposes only:

- `create_case(nonce:str,base_json:str,parent:u256)->u256`
- `replace_base(id:u256,base_json:str,expected_revision:u256)->None`
- `freeze_case(id:u256,expected_revision:u256)->None`
- the seven common views listed in `STAGE-2.md`

## Technical choices and adaptations

- Runtime identity: `0.39.2` is the pinned `genlayer` npm CLI target (`genlayer --version`), not a Python SDK version. The contract's GenVM runtime remains pinned by the stable `Depends` header `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }`; host Direct Mode tooling is recorded separately as `genlayer-py 0.16.3`, `genlayer-test 0.29.2`, and `genvm-linter 0.11.0`. See [`docs/RUNTIME-COMPATIBILITY.md`](docs/RUNTIME-COMPATIBILITY.md) for the exact decision and reproduction commands.
- Contract form: `from genlayer import *`, exactly one `gl.Contract` subclass, class-body `u256` and fully instantiated `TreeMap` fields, no collection reassignment in `__init__`.
- Deterministic consequence: each requirement adds one canonical `signature`; `freeze_case` compares it with every canonical function signature, stores only `IMPLEMENTS`, `VIOLATES`, or `NONE`, applies forbidden precedence, and reaches `DONE` without an LLM, nondeterministic block, retry, cooldown, or external service.
- Address normalization (`SPEC.TECHNICAL_ADAPTATION`): public `Address` calldata may arrive as a runtime Address object or a 20-byte decoded value in current Direct Mode. One contract helper canonicalizes both to lowercase `0x` + 40 hex. This changes no product behavior and prevents environment-specific address failures.
- Frontend: React/Vite with native platform features and the installed GenLayerJS package version selected during implementation. No backend. Reads use one shared client. Writes bind to the exact selected EIP-1193 provider and durable journal reservation.
- RPC budget: the frontend uses shared single-flight reads, short-lived safe-read caching, bounded/cancellable transient retry, and no continuous poller; the Studio/proof run uses one active tab/row, one in-flight read, sparse completion-based status checks, measured call counts, bounded reconciliation by transaction hash/readback, and zero automatic write replay.
- Wallet discovery: render only deduplicated, actually detected MetaMask, OKX Wallet, and Rabby providers. A valid EIP-6963 announcement replaces only the same wallet's legacy entry. Unknown/conflicting providers remain hidden.
- Recovery: Web Locks plus validated localStorage journal are authorization prerequisites for signing. Every hash is immutable; success requires finality, semantic execution success, and exact historical method-specific readback.

## Feasibility probe

Observed at `2026-09-05T06:26:39+07:00` with Python 3.13.6, `genvm-lint 0.11.0`, `gltest` from the installed Python environment, and the stable Studio dependency above.

Probe source SHA-256: `60A8DD26568696DE844AD7D03FC66784EED33F9984A6551961A6197CE62701C8`  
Probe test SHA-256: `CA17CB707B5A5C4D6479CFEAE1CD2271647BE31AA847ACDF76E5612283BAD5AB`  
Generated schema SHA-256: `0B7F14679AED61EC85E5B9DF1C83FC4BB16FD7C91DDC7D1EEF8CFFEC5323735B`

Results:

- `genvm-lint check probes/runtime_probe.py`: PASS; one discoverable contract, three views, one write.
- `genvm-lint schema probes/runtime_probe.py --output probe-schema.json`: PASS; `address`, `int`, and `string` ABI families exported as expected.
- `py -3.13 -m pytest probes/test_runtime_probe.py -q -p no:cacheprovider`: PASS, 2 tests.
- Persistent `u256`, `TreeMap[u256,str]`, `TreeMap[str,u256]`, Address calldata, JSON response mode, custom validator capture, validator disagreement, and explicit closure pickling all passed.

The first Direct Mode run exposed `AttributeError: 'bytes' object has no attribute 'as_hex'`. Root cause was verified in the installed gltest calldata roundtrip: production-shaped Address input is decoded to 20 bytes before the method runs. The shared canonical address helper fixed both write and read paths; the exact lint/schema/Direct Mode sequence then passed.

The original probe proved the pinned runtime and ABI/storage primitives. Its nondeterministic closure result is now historical and not relied on by the product. The adapted source contains no `gl.nondet`, `run_nondet`, LLM call, validator closure, or external fetch; current lint/schema and Direct Mode tests are the binding feasibility evidence.

## Risk-based test and proof plan

Contract implementation must cover:

- exact JSON key sets, duplicate keys at every depth, bool-as-int, controls, Unicode byte limits, CRLF handling, aggregate/record/result caps, all ABI entry schemas, tuple recursion/depth/node limits, aliases, array suffixes, and duplicate callable identity before consensus;
- every state/caller/revision/capacity transition, nonce replay/conflict, parent rules, actor/child pagination, exact historical snapshots, revision reservations, and unchanged complete state on every rejected path;
- exact canonical-signature grammar, tuple/array signatures, every deterministic label/polarity combination, row-major length, reducer precedence, and no-write rejection for malformed targets;
- source schema equality against all ten public signatures and current linter/runtime discovery;
- frontend 0/1/3-wallet discovery, each single-wallet identity, unknown/conflicting provider, deduplication, same-wallet replacement, selected-provider-only calls, reload disconnection, accessible modal behavior, and public-language scan;
- journal interruption at each storage step, orphan recovery, 32/33 capacity, lock/storage failure with zero wallet calls, immutable reservation/hash, conflict rules, bounded polling/RPC counts, finality/execution/readback classification, and create identity resolved by nonce/version 1 rather than aggregate count;
- complete public journeys: create/edit/freeze-and-evaluate, positive/forbidden/missing outcomes, ignored ABI entries, overloads, nested tuple arrays, and no-write failures.

PRE_DEPLOY will require exact-source lint/schema/layered test evidence, source/spec/protocol parity, selected Studio account, and a minimum-sufficient Studio matrix before any deployment transaction.

## Current official sources checked

Retrieved on 2026-09-06; the nondeterminism sources document why the retired design carried validator/LLM liveness and cost, not a mechanism used by the adapted contract:

- https://docs.genlayer.com/developers/intelligent-contracts/first-contract
- https://docs.genlayer.com/developers/intelligent-contracts/storage
- https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism
- https://docs.genlayer.com/developers/intelligent-contracts/features/calling-llms
- https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle
- https://docs.genlayer.com/api-references/genlayer-linter
- https://docs.genlayer.com/api-references/genlayer-js
- https://docs.genlayer.com/developers/decentralized-applications/writing-data
- https://docs.genlayer.com/developers/decentralized-applications/querying-a-transaction
- https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio
- https://eips.ethereum.org/EIPS/eip-6963
