# Domain Model

## Ubiquitous language

- **Canonical Resource:** target-independent intent maintained once by Skynex.
- **Native Resource:** artifact authored for one target because no faithful canonical representation exists.
- **Target:** an engine installation destination, initially OpenCode 2.
- **Transformer:** pure component that converts a canonical resource into target artifacts.
- **Artifact:** immutable desired file content plus destination metadata.
- **Installation Plan:** ordered, mutation-free description of intended filesystem changes.
- **Managed Resource:** resource previously installed and represented in the lockfile.
- **Local Modification:** installed bytes differing from the installed digest recorded in the lockfile.
- **Update Decision:** explicit choice to accept upstream, keep local, resolve conflict, or skip.
- **Snapshot:** bounded pre-apply copy of only the paths the accepted plan will mutate.
- **Lockfile:** durable record of resource provenance and source/installed digests.

## Bounded contexts

### Catalog

Owns canonical and native resource metadata, versions, dependencies, and compatibility.
It does not know filesystem destinations.

### Compilation

Validates canonical resources and transforms them into target-native artifacts. It is
deterministic and performs no I/O.

### Target Integration

Owns OpenCode 2 paths, formats, merge rules, version compatibility, and post-install
verification. Future targets implement their own integration context.

### Installation Planning

Compares desired artifacts, target state, and lock state. Produces operations and
conflicts without mutation.

### Update Review

Classifies three-way differences and records a human decision for each changed managed
resource. It never applies files.

### Transaction

Creates a bounded snapshot, applies accepted operations atomically where possible,
verifies outcomes, rolls back on failure, and commits lock state last.

### Presentation

Projects application use cases through Clack. Business decisions never depend on
terminal rendering.

### Future Orchestration

Reserved for Task Graph, scheduling, attempts, and execution state. It may depend on
stable resource identities but cannot be introduced into installer transactions.

## Aggregates and invariants

### Resource Package

- Resource IDs are unique within a package version.
- Portable resources have canonical definitions; exclusive behavior is declared native.
- Transformation output is deterministic for canonical input plus target version.

### Installation Plan

- Every operation has provenance, destination, expected prior state, and desired digest.
- No two operations write the same destination.
- The plan contains no path outside validated target and state roots.
- Planning is side-effect free.

### Update Review

- A locally modified resource requires an explicit decision.
- Accept-upstream, keep-local, conflict-resolution, and skip remain distinguishable.
- The lockfile never claims local bytes equal upstream when they do not.

### Installation Transaction

- Snapshot paths are derived only from accepted mutation operations.
- Lockfile update occurs only after target verification succeeds.
- Failure restores prior bytes or returns a bounded list of unreconciled paths.
- Historical snapshots are not preconditions for a new unrelated transaction.

## Domain events

- `InstallationPlanned`
- `ResourceChangeDetected`
- `UpdateDecisionRecorded`
- `SnapshotCreated`
- `InstallationApplied`
- `InstallationVerified`
- `InstallationRolledBack`
- `LockfileCommitted`

These are local application events in the MVP, not a distributed event bus.
