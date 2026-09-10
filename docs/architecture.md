# Architecture

## Dependency direction

```text
CLI/UI → application use cases → domain
                              ↑
filesystem + OpenCode adapters ┘
```

The domain is pure TypeScript and imports no terminal, filesystem, OpenCode, or Node API.

## Planned repository layout

```text
apps/cli/                    composition root and Clack presentation
packages/domain/             entities, values, policies, domain errors
packages/application/        install/update/doctor use cases and ports
packages/catalog/            canonical resource loading and validation
packages/compiler/           transformer contracts and deterministic pipeline
packages/installer/          plans, snapshots, apply, rollback, lock state
packages/testing/            contract fixtures for targets and filesystems
targets/opencode/            transformer, target adapter, and native resources
docs/                        product, DDD, plans, and ADRs
```

The bootstrap creates these boundary packages with minimal typed entrypoints so dependency
direction can be enforced before installer implementation begins.

## Portable and native resources

```text
canonical definition ──transform──> OpenCode-native artifact
native OpenCode source ────────────> OpenCode-native artifact
                                      ↓
                               one install plan
```

Both artifact classes share provenance, preview, backup, apply, verification, and lock
semantics. They do not need a fake universal plugin or hook API.

## Update model

For every managed resource:

```text
base     = source digest/content recorded at previous install
local    = bytes currently present at destination
upstream = newly compiled desired bytes
```

- `local == base && upstream != base`: safe upstream update.
- `local != base && upstream == base`: local-only modification; preserve.
- `local == upstream`: already current.
- all three differ: require explicit review and possible conflict resolution.

Skills and agent prompts always receive a user-visible semantic label and text diff when
upstream changed, even when safe to apply.

## Non-blocking backup model

- Build an accepted mutation set first.
- Snapshot only existing destinations in that set.
- Store snapshots by transaction ID, target, and resource identity.
- Do not enumerate an engine's entire home directory.
- Do not inspect snapshots from unrelated prior transactions during apply.
- Failure to protect a path about to be mutated blocks that path/transaction before mutation.
- Failure to read, rotate, or delete an old snapshot is a warning and cannot block install.

## Future graph seam

The future graph will orchestrate application commands through explicit ports. It will not
own target formats or installer filesystem logic. No graph fields or workflow state are
added to current domain objects prematurely.
