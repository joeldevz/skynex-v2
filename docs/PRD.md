# Product Requirements Document — Skynex v2 Bootstrap and Installer

## 1. Executive Summary & Systems Context

### Problem Statement

The existing Skynex combines installation assets with orchestration machinery that
is not part of the normal installation path. Resources such as skills, agent prompts,
hooks, and target configuration can drift or be overwritten without a clear,
resource-level update decision.

### Proposed Solution

Build a TypeScript 7 monorepo that owns canonical Skynex resources, compiles portable
intent into target-native artifacts, preserves truly target-native extensions, and
installs them through a transactional, reviewable CLI. OpenCode 2 is the first target.

### Ecosystem Impact

Skynex writes native OpenCode 2 configuration and extension artifacts while preserving
unmanaged user content. Future engines gain dedicated transformers without changing
the canonical domain. A future Task Graph can consume the same domain boundaries but
is not needed for installation.

## 2. Multidimensional Success Metrics (KPIs)

### Performance

- A dry-run over 500 managed files completes within 2 seconds on a local SSD, excluding package installation.
- Update planning reads only managed files and declared destinations, never an entire engine home directory.

### UX & Adoption

- Every mutation is preceded by a path-level summary.
- Every changed skill or agent prompt offers a readable diff before the user decides.
- Cancellation before apply produces zero target mutations.

### Safety & Trust

- No unmanaged file is overwritten or deleted.
- Locally modified managed resources are never silently replaced.
- Every applied plan has a lockfile recording source and installed digests.
- Backups contain only files selected for mutation by the accepted plan.
- A stale or unreadable historical backup cannot block an unrelated installation.

### Cost & Efficiency

- Installation requires no hosted service or database.
- Canonical resources are maintained once unless target semantics require a native asset.

## 3. User Experience & Functionality

### User Personas

- Skynex maintainer publishing resource updates.
- Developer installing Skynex into OpenCode 2.
- Developer with local customizations who needs controlled updates.

### User Stories & Estimations

| ID | User Story | Acceptance Criteria | SP (Est) | Estimation Rationale |
| --- | --- | --- | ---: | --- |
| US-01 | As a developer, I want Skynex to detect OpenCode 2 so that I install into the correct target. | Detection reports version, target paths, and actionable incompatibilities without mutation. | 3 | Requires platform-aware discovery and version validation. |
| US-02 | As a developer, I want to preview installation so that I know exactly what will change. | Plan lists create, update, preserve, and conflict operations by path before confirmation. | 5 | Requires deterministic planning and UI projection. |
| US-03 | As a maintainer, I want one canonical resource definition so that equivalent targets do not drift. | Canonical resources validate against a versioned schema and transform deterministically. | 5 | Introduces the compiler boundary and schemas. |
| US-04 | As a developer, I want updates to explain changed skills and prompts so that I can make informed decisions. | Three-way comparison identifies local edits and displays upstream changes per resource. | 8 | Merge classification and human decisions contain the main complexity. |
| US-05 | As a developer, I want to keep local changes so that an update does not destroy customization. | Keep-local and skip leave bytes unchanged and record an unresolved/new-upstream state. | 5 | Lock semantics must remain truthful after partial acceptance. |
| US-06 | As a developer, I want bounded backups so that protection never scans or blocks on unrelated engines. | Snapshot includes only planned mutations; historical backup failures are isolated. | 5 | Requires strict path derivation and failure classification. |
| US-07 | As a developer, I want failed application to roll back so that target configuration is not left partially updated. | Injected apply failure restores every previously mutated path or reports exact unreconciled paths. | 8 | Transaction ordering and recovery need careful design. |
| US-08 | As a maintainer, I want native OpenCode assets so that exclusive plugins and hooks retain full capability. | Native assets coexist with compiled resources and appear in the same plan and lockfile. | 5 | Two provenance classes must share lifecycle semantics. |

### Non-Goals

- Orchestrating agents or implementing a Task Graph.
- Supporting engines other than OpenCode 2 in the MVP.
- Automatically merging ambiguous prompt changes.
- Treating prompts or hooks as a security boundary.
- Publishing workspace packages to npm.

## 4. AI & Data System Requirements (If Applicable)

No LLM is required by the installer. Diffs and classifications must be deterministic.
The installer must not transmit prompts, configuration, file contents, or metadata.
If AI-assisted conflict explanation is added later, it must be optional and separately
consented to, with local deterministic behavior remaining available.

## 5. Technical Specifications & Risks

### Integration Points

- Local OpenCode 2 configuration and extension directories.
- OpenCode 2 documented configuration, agent, skill, command, plugin, hook, and MCP surfaces.
- Local manifest, lockfile, and scoped backup storage.

### Security & Privacy

- Validate containment and reject symlinks for managed writes and backups.
- Never store credentials in manifests, lockfiles, logs, or backups without an explicit secret policy.
- Use least-privilege file permissions and atomic replacement.
- Treat canonical and target artifacts as trusted release inputs, never as runtime authorization.

### Phased Rollout

- **Bootstrap:** compilable workspace, CLI shell, DDD documentation.
- **MVP:** OpenCode detection, canonical schema, planning, preview, bounded snapshot, apply, verify, lockfile.
- **v1.1:** three-way resource updates, conflict UX, rollback and uninstall hardening.
- **v2.0:** second engine validation and optional Skynex Task Graph discovery phase.

### Technical Risks

- OpenCode 2 extension contracts may change; pin compatibility and verify against current documentation.
- Three-way comparison can misclassify resources if lock data is missing; fail into explicit adoption/conflict flows.
- Filesystem races can invalidate a plan; revalidate preconditions immediately before apply.
- Over-generalizing target-native behavior can create false portability; unsupported semantics remain native.
