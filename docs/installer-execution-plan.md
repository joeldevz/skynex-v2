# Plan: Complete the OpenCode 2 Installer Lifecycle

## Problem

Skynex v2 has a promising but incomplete installer slice: it currently synthesizes placeholder resources in code and can perform a basic install, but it cannot yet load a canonical release catalog, preserve truthful three-way update state, expose lifecycle recovery commands, or validate a complete isolated OpenCode 2 installation. Completing these capabilities lets developers install and maintain Skynex without silently replacing customization or touching unrelated configuration.

## Production Context
- **Status**: development
- **Users**: maintainers and early local users; no published package or production traffic
- **Criticality**: high — filesystem mistakes could overwrite developer configuration even before release
- **Constraints**: Node 24 baseline, pnpm workspace, TypeScript 7 ESM, Clack UI; no TDD requirement; no Task Graph; no npm publication, release, global install, network service, or real user HOME/config mutation

## Scope
### In scope
- Treat the existing uncommitted installer changes as workflow-owned work from accepted prior iterations; preserve and evolve them rather than reverting them.
- Add a versioned canonical catalog, release manifest, canonical resources, and OpenCode-native plugin/hook resources.
- Compile canonical resources deterministically and merge OpenCode JSON/JSONC through a target adapter.
- Implement install and resource-aware update planning with previous-upstream/current-local/next-upstream comparison and explicit user decisions.
- Add bounded snapshots, automatic rollback, backup listing/restoration, owned-resource uninstall, doctor diagnostics, and Clack command flows.
- Add local CI/distribution scaffolding and validate only against isolated temporary HOME/project/state roots.
- Run the real `opencode2` binary only when present and only with isolated environment paths and a read-only/help/config-validation invocation that cannot mutate the real HOME.

### Out of scope
- Task Graph, scheduling, workflow execution, or graph persistence.
- Engines other than OpenCode 2.
- npm publication, release creation, repository publication, package renaming, or real global installation.
- Automated semantic merging of conflicting prompts, agents, skills, hooks, or commands.
- Mutating `~/.config/opencode`, `~/.config/skynex`, or any other real user configuration.

## Requirements

**Dado** un catálogo versionado con recursos canónicos y nativos
**Cuando** se carga y compila para OpenCode 2
**Entonces** cada identidad, versión, origen, digest y destino es válido, único y determinista.

**Dado** un HOME/proyecto aislado con contenido OpenCode gestionado y no gestionado
**Cuando** se previsualiza o aplica `install`
**Entonces** solo aparecen y cambian destinos declarados, el contenido no gestionado se conserva y el lockfile se confirma al final.

**Dado** el upstream anterior, los bytes locales actuales y el upstream nuevo
**Cuando** se ejecuta `update`
**Entonces** cada recurso se clasifica mediante comparación de tres vías y toda modificación local requiere una decisión visible antes de mutar.

**Dado** que el usuario conserva, omite o resuelve localmente un recurso
**Cuando** se escribe el nuevo lockfile
**Entonces** `sourceDigest` e `installedDigest` reflejan la realidad y el upstream pendiente no se presenta como aceptado.

**Dado** un plan aceptado
**Cuando** una escritura o verificación falla
**Entonces** se restauran únicamente los destinos ya mutados o se informa una lista acotada de rutas no reconciliadas.

**Dado** un lockfile válido
**Cuando** se ejecuta uninstall, backup list/restore o doctor
**Entonces** solo se inspeccionan o mutan rutas gestionadas y respaldos declarados, con dry-run/no-mutation donde corresponda.

**Dado** que existe `opencode2`
**Cuando** se ejecuta la validación de integración
**Entonces** usa HOME/XDG y raíces temporales aisladas y una operación segura de solo lectura; si no existe, se registra el skip sin sustituirlo por una instalación.

## Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Traversal or symlink escape writes outside approved roots | high | **Security-sensitive:** normalize paths, reject absolute/`..` manifest destinations, inspect every existing ancestor with `lstat`, refuse symlink/non-regular destinations, and revalidate immediately before each mutation and restore. |
| A malformed or forged lockfile causes arbitrary deletion/restoration | high | **Security-sensitive:** schema-validate lock and backup metadata, derive destinations from approved roots plus validated relative paths, and never trust persisted absolute paths as mutation authority. |
| Config merge overwrites unmanaged OpenCode settings | high | Keep `jsonc-parser` edit-based merging, change only Skynex-owned keys/list entries, preserve comments, and classify pre-existing unmanaged destination collisions instead of replacing them. |
| Lock state lies after keep-local/skip/conflict | high | Persist previous accepted source digest, actual installed digest, and pending upstream digest/version separately; commit lock only after file verification. |
| Backup failure leaves partial state | high | Finish all required snapshots before first mutation; rollback in reverse order; return exact unreconciled paths and preserve transaction metadata for manual recovery. |
| Native plugin/hook code executes with target privileges | high | **Security-sensitive:** ship reviewed static resources, no secrets/network calls/dynamic eval, pin compatibility metadata, and validate target registration syntax in isolation. |
| Historical backup corruption blocks unrelated work | medium | List/restore/retention operate on explicit snapshot metadata; installation never scans or depends on historical backups. |
| Real OpenCode validation mutates user configuration | high | **Security-sensitive:** require a temporary root, override `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME`, use only documented read-only arguments, and skip if safety cannot be proven. |

## Rollback

Code changes are locally reversible with `git restore` only after explicit confirmation for the exact workflow-owned paths. At runtime, every accepted mutation first snapshots the existing selected destination; on apply failure, restore snapshots and remove transaction-created files in reverse order, then report `restoredPaths` and `unreconciledPaths`. A successful transaction can be reversed with `skynex backup restore <transaction-id>` or `skynex uninstall`; neither command may touch resources absent from validated lock/backup metadata.

## Success Criteria
- [ ] Catalog and manifest validation produces deterministic artifacts for canonical and native OpenCode resources with no duplicate IDs or destinations.
- [ ] Install/update previews are mutation-free and apply only after explicit decisions/approval; unmanaged files and config keys survive.
- [ ] All three-way cases (`unchanged`, safe upstream, local-only, converged, conflict, unmanaged collision) have deterministic plan semantics.
- [ ] Rollback, uninstall, backup list/restore, and doctor remain bounded to validated managed paths and report partial failures precisely.
- [ ] `pnpm check` and `pnpm build` pass on Node 24-compatible code; isolated lifecycle verification passes without touching real HOME.
- [ ] If safely available, real `opencode2` accepts/inspects the isolated generated configuration; otherwise verification records an explicit skip.

## Post-implementation verification (2026-09-11)

Completed in isolated temporary roots: a single shared transaction executor now
drives install, uninstall, and restore through prepare/snapshot/apply/verify/
commit/rollback, with the lease held for the entire lifecycle. Verification covers
rollback of replaced and created files plus the prior lock, failed lease
acquisition preserving the winner lease and lock, local-edit refusal, durable
uninstall snapshots, exact restore bytes/state, and unrelated-resource
preservation. `pnpm check`, `pnpm build`, `pnpm verify:installer`, and
`pnpm verify:opencode` pass. The latter only proves the read-only `opencode2
--help` probe when that binary is available; it does not prove plugin loading.

The security model intentionally does not claim immunity to a malicious same-UID
process that wins a TOCTOU race between Node filesystem checks and mutation.

## Bounded functional acceptance (2026-09-11)

| Decision/edge | Result |
|---|---|
| Keep or skip local bytes | **Pass** — bytes remain unchanged and pending upstream is recorded. |
| Accept upstream | **Pass** — replacement is bound to the reviewed resource and lock snapshot. |
| Resolve | **Pass** — interactive update cancels safely with an edit/re-run instruction. |
| Missing managed file | **Pass** — update fails closed before mutation; lock and absence are unchanged. |
| Stale reviewed plan | **Pass** — lease/target snapshot rejects a second local edit before commit. |
| Upstream-only change | **Pass** — noninteractive safe update applies without treating it as a conflict. |
| Conflict/pending with `--yes` | **Pass** — rejected before mutation; unresolved resource and lock remain unchanged. |
| JSON/JSONC selection | **Pass** — explicit preference is validated early for install, update, uninstall, and backup restore; the nonselected file is untouched. |
| JSONC uninstall/restore | **Pass** — comments, unrelated settings, post-install additions, and external plugins survive; selected config restores exactly. |

The acceptance runner executes the API edges and real CLI subprocesses in fresh
`/tmp/opencode` roots with isolated HOME/XDG variables. No runtime probe,
download, commit, or global configuration mutation is part of this acceptance.

The lifecycle decision seam is now installer-owned: update planning compares the
accepted upstream digest, recorded installed digest, and current bytes. A local
only edit is preserved while recording its actual digest; keep/skip records the
new upstream as pending; accept-upstream is permitted only for the reviewed
current digest. Unresolved conflicts, including `--yes`, fail before mutation.
Uninstall treats the OpenCode runtime registration as an edit to the selected
JSON/JSONC document, removing only the exact Skynex entry and preserving
comments, unrelated settings, and external plugins; other managed resources
remain individually bounded by their lock digests.

## Technical Context

The accepted architecture separates `domain`, `catalog`, `compiler`, `application`, `installer`, `presentation`, and `targets/opencode`. Today `packages/domain/src/index.ts` has initial resource/install types; `packages/application/src/index.ts` exposes `TargetAdapter.detect()` and `desiredArtifacts()`; `packages/installer/src/index.ts` provides basic `createInstallPlan()`/`applyInstallPlan()` with containment, snapshots, atomic writes, verification, and a schema-1 lock; `targets/opencode/src/index.ts` merges JSONC but embeds placeholder artifacts; and `apps/cli/src/index.ts` exposes only install/doctor. `targets/opencode/resources/{canonical,native,templates}` are empty placeholders. Existing modifications across README, package metadata, lockfile, TS references, ADR 0001, CLI/application/domain/installer/OpenCode code are prior workflow-owned work and must not be discarded.

Use DDD dependency direction: domain types have no I/O; catalog owns release inputs; compiler is pure; application owns use-case ports/results; target integration owns OpenCode mapping/merge/verification; installer owns filesystem transaction infrastructure; CLI only parses/renders and delegates. Split current large `index.ts` files into the paths below and retain package barrel exports for compatibility.

## Implementation Steps

### Step 1: Define lifecycle domain contracts and durable schemas
- **What**: Complete the resource, manifest, lock, comparison, decision, operation, backup, uninstall, and diagnostic vocabulary before adding I/O.
- **Why**: All later slices need one truthful model for provenance and lifecycle invariants.
- **Where**: `packages/domain/src/resources.ts` (proposed), `packages/domain/src/install.ts` (proposed), `packages/domain/src/update.ts` (proposed), `packages/domain/src/state.ts` (proposed), `packages/domain/src/diagnostics.ts` (proposed), `packages/domain/src/index.ts`.
- **How**:
  - Move existing `ResourceKind`, `CanonicalResourceIdentity`, `InstallRoots`, `DesiredArtifact`, and `InstallComponent` into focused modules and re-export them.
  - Add proposed discriminated types:
    ```ts
    export type ResourceOrigin = "canonical" | "native";
    export interface CatalogResource extends CanonicalResourceIdentity {
      readonly origin: ResourceOrigin;
      readonly sourcePath: string;
      readonly component: InstallComponent;
      readonly targets: readonly { id: "opencode-v2"; relativePath: string }[];
    }
    export interface ManagedResourceState extends CanonicalResourceIdentity {
      readonly origin: ResourceOrigin;
      readonly relativePath: string;
      readonly sourceDigest: string;
      readonly installedDigest: string;
      readonly pendingSourceDigest?: string;
      readonly pendingVersion?: string;
    }
    export type ComparisonKind =
      | "create" | "unchanged" | "upstream-only" | "local-only"
      | "converged" | "conflict" | "unmanaged-collision";
    export interface UpdateCandidate {
      readonly artifact: DesiredArtifact;
      readonly previous: ManagedResourceState | null;
      readonly localDigest: string | null;
      readonly comparison: ComparisonKind;
      readonly decision?: UpdateDecision;
    }
    ```
  - Define `InstallOperation` as a discriminated union including `create`, `replace`, `preserve`, `remove`, `restore`, `unchanged`, and `conflict`, each with expected prior digest and validated relative destination.
  - Define schema-versioned `ReleaseManifest`, `InstallLock`, `BackupManifest`, `DoctorReport`, and `TransactionResult { restoredPaths; unreconciledPaths; warnings }`; avoid persisted absolute paths as mutation authority.
  - Add pure constructors/validators for duplicate IDs/destinations, relative POSIX paths, digest format, supported schema/target, explicit decisions, and truthful pending-upstream state.
- **Acceptance**: Domain compiles with no Node filesystem imports; invalid paths/duplicates/unsupported schemas are rejected; all later APIs can represent partial update, rollback, uninstall, and restore without optional-field ambiguity.
- **Status**: [ ] pending

### Step 2: Materialize and load the canonical release catalog
- **What**: Replace code-embedded placeholder content with a versioned manifest and checked-in resources.
- **Why**: Maintainers need one inspectable source of truth and deterministic release input.
- **Where**: `targets/opencode/resources/manifest.json` (proposed), `targets/opencode/resources/canonical/agents/skynex-orchestrator.md`, `targets/opencode/resources/canonical/skills/safe-install/SKILL.md`, `targets/opencode/resources/canonical/commands/skynex-doctor.md`, `targets/opencode/resources/canonical/config/opencode.jsonc`, `targets/opencode/resources/native/plugins/skynex-runtime.ts`, `targets/opencode/resources/native/hooks/skynex-hooks.ts`, `packages/catalog/src/schema.ts` (proposed), `packages/catalog/src/load-catalog.ts` (proposed), `packages/catalog/src/index.ts`, package metadata/TS references.
- **How**:
  - Store explicit manifest `schemaVersion`, release version, target compatibility, resource ID/kind/origin/version/component/source path/destination/dependencies; include hooks in `InstallComponent` or map hooks under an explicitly documented native-runtime component.
  - Implement proposed `loadCatalog(input: { manifestPath: string }): Promise<ResourceCatalog>` and `validateManifest(value: unknown): ReleaseManifest`. Resolve resource bytes only beneath the manifest resource root; reject symlinks, traversal, duplicate IDs/destinations, undeclared files, and missing files. **Security-sensitive.**
  - Keep canonical Markdown/frontmatter portable and native plugin/hook TypeScript target-specific. The native resources must be static, contain no secrets/network access/dynamic code loading, and expose the OpenCode 2 plugin/hook contract selected from current target documentation.
  - Add package dependencies/references from catalog to domain only; do not put OpenCode path logic in catalog.
  - Remove `.gitkeep` files once directories contain actual resources.
- **Acceptance**: One manifest load returns every declared resource with exact bytes and provenance; two loads produce identical ordering/digests; malformed paths, symlinks, duplicates, and undeclared/missing inputs fail before planning.
- **Status**: [ ] pending

### Step 3: Implement the pure compiler and OpenCode transformer
- **What**: Compile canonical resources and combine them with native resources into deterministic OpenCode artifacts while preserving unmanaged config.
- **Why**: Catalog intent and target-specific filesystem behavior must remain separate.
- **Where**: `packages/compiler/src/contracts.ts` (proposed), `packages/compiler/src/compile.ts` (proposed), `packages/compiler/src/index.ts`, `targets/opencode/src/transformer.ts` (proposed), `targets/opencode/src/config-merge.ts` (proposed), `targets/opencode/src/adapter.ts` (proposed), `targets/opencode/src/index.ts`, `targets/opencode/package.json`, related tsconfigs.
- **How**:
  - Add proposed pure contract:
    ```ts
    export interface ResourceTransformer<TOptions> {
      readonly targetId: string;
      transform(resource: LoadedResource, options: TOptions): readonly DesiredArtifact[];
    }
    export function compileCatalog(
      catalog: ResourceCatalog,
      transformer: ResourceTransformer<OpenCodeTransformOptions>,
      options: OpenCodeTransformOptions,
    ): readonly DesiredArtifact[];
    ```
  - Move `mergeConfig(source, includePlugin)` from the current target barrel into `config-merge.ts`; change only `$schema` and uniquely identified Skynex plugin/hook registration entries, preserve comments/unknown keys/order as far as `jsonc-parser` permits, and reject malformed config or non-array registration fields.
  - Transform canonical agents/skills/commands/config to OpenCode paths; pass native plugin/hook bytes through with declared provenance. Sort by manifest order or stable `(kind,id,path)` order and reject duplicate output paths.
  - Evolve `TargetAdapter.desiredArtifacts(...)` to receive a loaded catalog/selection rather than synthesize strings. Add `verify(roots, artifacts): Promise<TargetVerification>` to the application target port; detection remains read-only and reports both-config ambiguity and compatibility evidence.
  - Verify current OpenCode 2 config/plugin/hook field names and signatures against current official documentation before locking resource syntax; if documentation conflicts materially with the accepted shape, return that fact rather than guessing.
- **Acceptance**: Same catalog/options/current-config input yields byte-identical artifacts; config merge preserves unmanaged keys/comments; plugin and hook are both registered exactly once; no compiler module performs filesystem I/O.
- **Status**: [ ] pending

### Step 4: Build lock-aware three-way planning and explicit decisions
- **What**: Replace two-way digest replacement with a side-effect-free planner that consumes desired artifacts, validated lock state, and only declared local destinations.
- **Why**: Updates must never silently overwrite local modifications or misstate accepted upstream state.
- **Where**: `packages/application/src/ports.ts` (proposed), `packages/application/src/use-cases/plan-install.ts` (proposed), `packages/application/src/use-cases/plan-update.ts` (proposed), `packages/installer/src/state-store.ts` (proposed), `packages/installer/src/planner.ts` (proposed), `packages/installer/src/digest.ts` (proposed), `packages/installer/src/index.ts`.
- **How**:
  - Add ports `CatalogPort`, `TargetPort`, `InstallationStatePort`, and `ManagedFileReader`; application use cases orchestrate them without importing `node:fs`.
  - Implement `readInstallLock(roots): Promise<InstallLock | null>` with strict schema validation. Treat malformed state as a diagnostic/blocker, never as authority for mutation. **Security-sensitive.**
  - Implement proposed `createLifecyclePlan(input: { mode: "install" | "update"; target; roots; artifacts; lock; decisions }): Promise<InstallationPlan>` and classify each resource using `base = previous sourceDigest`, `local = digest(current bytes)`, `upstream = desired sourceDigest`:
    - no local/no lock → `create`; local/no lock → `unmanaged-collision` requiring skip/adopt or a separately explicit replace decision;
    - local == base and upstream != base → `upstream-only` safe replace;
    - local != base and upstream == base → `local-only` preserve;
    - local == upstream → `converged`/unchanged;
    - all differ → `conflict`, requiring `accept-upstream`, `keep-local`, `resolve-conflict`, or `skip`.
  - For `resolve-conflict`, accept explicit resolved bytes and digest them; do not implement automatic merging. For keep/skip, retain prior `sourceDigest`, record actual `installedDigest`, and set pending upstream digest/version.
  - Record expected local digest on every mutating operation for race detection. Read only manifest destinations and lock-owned destinations; never scan target trees.
- **Acceptance**: Install/update planning performs zero writes; every three-way case has the specified operation/decision requirement; noninteractive unresolved decisions fail with resource/path detail; kept/skipped state remains pending and truthful.
- **Status**: [ ] pending

### Step 5: Harden bounded transactions, backup metadata, and rollback
- **What**: Turn basic apply into an explicit prepare/snapshot/apply/verify/commit transaction with bounded recovery.
- **Why**: The current implementation can leave created files behind if verification or lock commit fails and does not report incomplete rollback.
- **Where**: `packages/installer/src/path-policy.ts` (proposed), `packages/installer/src/snapshot-store.ts` (proposed), `packages/installer/src/transaction.ts` (proposed), `packages/installer/src/state-store.ts`, `packages/installer/src/index.ts`.
- **How**:
  - Extract and strengthen current `assertContained()`/`assertSafeAncestors()` as proposed `validateManagedPath(root, relativePath)` and `assertSafeMutationTarget(root, destination)`. Reject absolute/traversal/NUL paths and symlink ancestors for target, state, temp, backup, restore, remove, and lock operations. **Security-sensitive.**
  - Implement proposed `applyInstallationPlan(plan, deps): Promise<TransactionResult>` in phases: revalidate all expected digests; create transaction metadata; snapshot every existing mutating destination to `stateRoot/backups/<transactionId>/files/<relativePath>`; atomically write/remove; call target verification; atomically commit schema-versioned lock last.
  - Required current snapshots are blocking and must complete before mutation. Historical list/read/retention failures become warnings and cannot block an unrelated transaction.
  - On any post-mutation failure, restore replacements/removals and remove transaction-created files in reverse order; independently catch each recovery failure and return/throw a typed `RollbackIncompleteError` with exact `restoredPaths` and `unreconciledPaths`.
  - Write backup manifest with transaction ID, timestamp, target/scope, operation, relative path, prior digest, snapshot presence, and resulting digest; use `0700` directories and `0600` state/snapshot files, preserving executable mode only where OpenCode requires it.
  - Remove obsolete monolithic logic only after barrel exports route existing callers to the new transaction API.
- **Acceptance**: No mutation begins before all required snapshots succeed; race/symlink/path-policy failures occur before touching bytes; injected filesystem/verification/lock failures restore all recoverable paths and report exact residuals; lock is always last.
- **Status**: [ ] pending

### Step 6: Add uninstall and backup list/restore use cases
- **What**: Complete reversible lifecycle operations using validated ownership metadata.
- **Why**: Users need bounded removal and explicit recovery after successful transactions.
- **Where**: `packages/application/src/use-cases/plan-uninstall.ts` (proposed), `packages/application/src/use-cases/list-backups.ts` (proposed), `packages/application/src/use-cases/restore-backup.ts` (proposed), `packages/installer/src/uninstall.ts` (proposed), `packages/installer/src/backup-service.ts` (proposed), barrels.
- **How**:
  - Add proposed APIs:
    ```ts
    export function createUninstallPlan(input: { roots: InstallRoots; lock: InstallLock }): Promise<InstallationPlan>;
    export function listBackups(roots: InstallRoots): Promise<BackupSummary[]>;
    export function createRestorePlan(input: { roots: InstallRoots; transactionId: string }): Promise<InstallationPlan>;
    ```
  - Uninstall includes only lock-owned paths. If current digest differs from lock `installedDigest`, classify conflict and require preserve or explicit remove; never recursively remove parent directories, except empty Skynex-created directories proven by transaction metadata.
  - Backup listing reads only immediate validated backup manifests under the exact state backup root, returns corrupt entries as warnings, and never blocks install/update.
  - Restore verifies transaction ID format, manifest containment, snapshot digest, current expected digest/decision, and target compatibility; then executes through the same transaction engine, creating a new backup of overwritten current bytes. **Security-sensitive.**
  - Update lock state after uninstall/restore only after target verification; preserve unrelated managed entries during partial component operations.
- **Acceptance**: Uninstall cannot delete unmanaged or locally modified content without an explicit decision; list is read-only and tolerant of corrupt historical entries; restore is itself reversible and cannot escape target/state roots.
- **Status**: [ ] pending

### Step 7: Implement doctor and complete the Clack command surface
- **What**: Expose application use cases through a thin, consistent CLI with readable decisions/diffs and reliable noninteractive behavior.
- **Why**: Lifecycle safety must be visible and operable without embedding business rules in presentation code.
- **Where**: `packages/application/src/use-cases/doctor.ts` (proposed), `packages/presentation/src/clack-presenter.ts` (proposed), `packages/presentation/src/index.ts`, `apps/cli/src/args.ts` (proposed), `apps/cli/src/commands/{install,update,uninstall,backup,doctor}.ts` (proposed), `apps/cli/src/index.ts`, package metadata/TS references, `README.md`, `targets/opencode/README.md`.
- **How**:
  - Add command grammar:
    ```text
    skynex install [--global|--project <dir>] [--dry-run] [--yes] [--config json|jsonc]
    skynex update  [same scope] [--dry-run] [--yes]
    skynex uninstall [same scope] [--dry-run] [--yes]
    skynex backup list [same scope]
    skynex backup restore <transaction-id> [same scope] [--dry-run] [--yes]
    skynex doctor [same scope] [--json]
    ```
  - Parse flags strictly: reject unknown flags, missing values, mutually exclusive scopes, unsafe `--state-dir` ambiguity, and noninteractive conflict execution without explicit decisions. `--yes` confirms only already-safe operations; it must not auto-resolve local modifications.
  - Presenter displays path-level operations and readable line diffs for changed agent/skill/command/config resources, then asks a per-resource decision for conflicts/local changes. Cancellation before apply performs zero writes.
  - `doctor` checks Node compatibility, target detection/config ambiguity, manifest/resource validity, state/lock schema, managed-file drift, pending updates, backup-manifest health, path/symlink safety, and optional `opencode2` availability; return nonzero only for actionable errors, not warnings.
  - Split the current CLI while preserving shebang and a single `runCli(argv, env): Promise<number>` entry suitable for isolated validation; move all Clack calls behind presentation functions.
- **Acceptance**: Help documents every command; dry-run/cancellation change no bytes; interactive conflicts require one visible decision each; `--yes` cannot overwrite local edits by default; doctor is read-only and supports stable JSON output.
- **Status**: [ ] pending

### Step 8: Add non-TDD verification fixtures and CI/distribution scaffolding
- **What**: Add post-implementation lifecycle verification and a private distributable CLI artifact without publishing it.
- **Why**: The user authorized verification but explicitly excluded TDD and publication.
- **Where**: `scripts/verify-installer.mjs` (proposed), `scripts/verify-opencode2.mjs` (proposed), `fixtures/installer/` (proposed), `.github/workflows/ci.yml` (proposed), `apps/cli/package.json`, root `package.json`, `pnpm-lock.yaml`, `README.md`.
- **How**:
  - Add scripts `verify:installer`, `verify:opencode`, and `pack:cli`; `pack:cli` uses a local output directory such as `/tmp/opencode/skynex-pack` or an ignored `artifacts/` folder and must not invoke publish/release/global install.
  - `verify-installer.mjs` creates a fresh directory under `/tmp/opencode`, sets isolated `HOME` and all XDG roots, and drives built CLI scenarios: fresh install dry-run/apply/idempotency; config preservation; upstream-only update; local-only/keep; conflict/skip/accept/resolved; race refusal; bounded backup; injected rollback; backup list/restore; uninstall conflict/preserve/remove; corrupt lock/backup doctor results. Assert real HOME sentinels and repository paths are unchanged.
  - For security-sensitive cases, include traversal manifest, absolute lock path, symlink ancestor/destination, forged backup ID, snapshot digest mismatch, and unmanaged collision checks. These are verification fixtures, not a red-first TDD gate.
  - `verify-opencode2.mjs` first resolves `opencode2`; if absent, print a structured skip. If present, inspect its help to select a documented read-only validation/help invocation, set temporary HOME/XDG/config/state/cache, point it only at generated isolated configuration, disable network/update behavior where supported, and abort/skip rather than run if read-only safety is uncertain. Never execute plugins/hooks against the real user environment.
  - CI uses Node 24 and pnpm 10.15.1 with frozen lockfile, then `pnpm check`, `pnpm build`, and `pnpm verify:installer`; real OpenCode validation may be conditional because the binary may be absent. No publish/release job or credentials.
- **Acceptance**: Local checks and isolated lifecycle script pass; CI contains no publication/global-install step; pack creates an inspectable local artifact; real `opencode2` validation either proves isolated acceptance with command/environment evidence or reports a safe skip.
- **Status**: [ ] pending

## Verification

Run only after implementation, from `/home/clasing/umibu/skynex-v2`:

```bash
# Toolchain baseline: implementation must remain Node 24 compatible even if the local shell is newer.
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm verify:installer

# Local distribution artifact only; no npm publish/global install.
pnpm pack:cli -- --pack-destination /tmp/opencode/skynex-pack

# Optional, guarded, isolated and read-only; script records pass or skip.
pnpm verify:opencode

git status --short
git diff --check
```

Manual evidence to retain in the implementation handoff:
- Temporary HOME/XDG/target/state paths used and sentinel hashes proving real user config was untouched.
- Plan output and lock records for all three-way classifications and decisions.
- Backup manifest plus rollback/restore results, including empty `unreconciledPaths` on successful recovery.
- Doctor JSON for healthy, drifted, pending-update, malformed-lock, and corrupt-historical-backup cases.
- Exact guarded `opencode2` command/version and isolated environment when run, or the explicit reason it was safely skipped.

Coverage gap accepted by scope: this plan does not introduce a TDD/red-first workflow; verification is post-implementation. It also does not validate npm publication, real global installation, another engine, or any Task Graph behavior.
