# Runtime compatibility decision

Status: `RESOLVED_FOR_PRE_DEPLOY` for the adapted local build toolchain. The earlier Studio candidate is historical; the deterministic source requires fresh PRE_DEPLOY review and deployment evidence.

Decision date: `2026-09-05`

Adapted source implementation commit: `cd833b78b43e22661ade6a4dddad3fc4269eb07a`

Historical deployed source commit: `de66367b459ed421b73bdfb7f3d04bf15088ed38`

Adapted contract source SHA-256: `E68FF0728C24B26D31127D2FC4C6027350DA54EFAB5329623741EE3E67EFEB7F`

## Decision

The reported `0.39.2` mismatch was a tool-role mismatch, not evidence that the contract was tested against a Python runtime called `0.39.2`.

`0.39.2` is the version of the `genlayer` npm Command Line Tool used for local GenLayer environment operations. It is not the version namespace of `genlayer-py` or `genlayer-test`. The current machine resolves the CLI as `genlayer@0.39.2`, and `genlayer --version` returns `0.39.2`.

The contract's actual GenVM runtime is selected by the first-line `Depends` hash in `contracts/main.py`, not by the host Python package version:

```text
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

The local Direct Mode verification tools are separate host-side packages. Their installed versions are recorded below and are the versions against which the passing local lint/schema/test evidence was produced. They must not be relabeled as `0.39.2`.

## Version and role inventory

| Component | Role | Exact observed version or identity | Verification |
|---|---|---|---|
| `genlayer` npm package | GenLayer CLI and local Studio environment operations | `0.39.2` | `npm list -g genlayer --depth=0`; `genlayer --version` |
| `genlayer` npm artifact | Reproducibility identity for the CLI target | `https://registry.npmjs.org/genlayer/-/genlayer-0.39.2.tgz` | npm registry integrity `sha512-1lbpDEeOiRyYyk3addo/tqRU7AOGCu9fWjhYyMwyna0YCMRxQdY0gddqOmwXVfclBX9Kalgw44gRYfpqNHLrFw==` |
| GenLayer CLI release | Official upstream release/tag for the CLI target | `v0.39.2` | [official release tag](https://github.com/genlayerlabs/genlayer-cli/releases/tag/v0.39.2) and [tagged package metadata](https://raw.githubusercontent.com/genlayerlabs/genlayer-cli/v0.39.2/package.json) |
| GenVM contract runtime | Runtime selected by the contract itself | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` | first line of `contracts/main.py`; `genvm-lint` and schema generation |
| `genlayer-py` | Host-side Python GenLayer SDK used by Direct Mode tooling | `0.16.3` | `py -3.13 -m pip show genlayer-py` |
| `genlayer-test` | Host-side Direct Mode/test framework | `0.29.2` | `py -3.13 -m pip show genlayer-test` |
| `genvm-linter` | Host-side contract lint/schema tool | `0.11.0` | `py -3.13 -m pip show genvm-linter` |
| `genlayer-js` | Browser frontend SDK | `1.1.8` | `frontend/package.json` and `frontend/package-lock.json` |

Host versions observed with this evidence were Python `3.13.6`, Node `v22.22.2`, and npm `12.0.2`.

## Compatibility boundary

This decision resolves the package identity question for PRE_DEPLOY:

- the `0.39.2` target is satisfied by the installed `genlayer` CLI;
- the contract execution identity is the pinned `Depends` hash;
- the local Python versions are explicitly recorded as Direct Mode tooling, not compared numerically with the CLI version;
- the frontend version is independently pinned in the frontend lockfile.

The official CLI reference rendered `0.39.1` in its generated version label when retrieved on this date, while the official upstream `v0.39.2` release tag, npm registry artifact, and installed CLI resolved `0.39.2`. The tagged upstream metadata and command output are the reproducibility evidence for the selected CLI target; the generated documentation-label lag does not change the contract's `Depends` identity or the Python package roles.

This runtime decision does not claim a deployment of the adapted source, Studionet finality, transaction success, authoritative readback, Vercel publication, or public E2E. Earlier Studio evidence is historical and bound separately in `docs/VERIFICATION.md`; the adapted source must pass fresh PRE_DEPLOY and downstream gates.

## Reproduction commands

Run from the project root. These are read-only identity checks; they do not start Studio, deploy, sign, submit, or poll a transaction.

```powershell
npm list -g genlayer --depth=0
genlayer --version
npm view genlayer@0.39.2 version dist.tarball dist.integrity repository.url --json
py -3.13 -m pip show genlayer-py genlayer-test genvm-linter
npm --prefix frontend ls genlayer-js --depth=0
```

The exact contract/runtime header remains subject to the official [first-contract version-comment rule](https://docs.genlayer.com/developers/intelligent-contracts/first-contract). The CLI setup and host package roles follow the official [development setup](https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup), [GenLayer CLI reference](https://docs.genlayer.com/api-references/genlayer-cli), and [upstream v0.39.2 release](https://github.com/genlayerlabs/genlayer-cli/releases/tag/v0.39.2).
