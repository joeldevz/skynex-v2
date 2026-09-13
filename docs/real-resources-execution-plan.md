# Plan: Migrate the Approved Real OpenCode 2 Resources

## Problem

Skynex v2 still ships placeholder agents, skills, commands, and runtime assets. Developers need the approved current global resources and Sky Agents behavior delivered as portable, reviewable OpenCode 2 artifacts without copying private configuration or letting validation touch their real installation.

## Production Context
- **Status**: development
- **Users**: maintainers and early local users; no published package or production traffic
- **Criticality**: high — prompts can grant tool authority and profile application can rewrite global agent model assignments
- **Constraints**: Node 24, pnpm 10.15.1, TypeScript ESM, installed `/home/clasing/.opencode/bin/opencode2` beta 19425; no TDD/red-first gate; all tests use isolated HOME/XDG roots; source inventory is `.skynex/tasks/real-resources/global-inventory.json` (SHA-256 `e77b256d2b992b021eaa12c8e85e35cbf04ef2a69b9d49f8569363fe1f2022f2`); never import model/provider/MCP/credential/personal values

## Scope
### In scope
- Import exactly 13 agents: all inventoried global agents except `advisor`, `manager`, and `linear-orchestrator`, including `mentor`.
- Import the complete `_shared` directory and the 10 approved skills: `diagnose`, `grill-me`, `infrastructure-quality-tooling`, `prd`, `review-pr`, `security`, `tdd-discipline`, `triage`, `visual-recap`, and `write-a-skill`, including every inventoried reference/template/support file.
- Generate OpenCode 2 managed agent entries containing mode and minimum permissions, but no model/provider/MCP/credential/personal configuration.
- Vendor and adapt the nine inventoried Sky Agents source modules as a repository package/native plugin with relative imports and declared package dependencies; profile CRUD remains non-mutating.
- Make profile application a separate explicit-confirmation transaction that backs up and changes only managed global agent `model` assignments.
- Extend catalog ownership, selected-component installation, JSON/JSONC AST edits, isolated verification, documentation, and dual security review.

### Out of scope
- Nodeterm, Herdr, branding, legacy workflow plugin, historical workflow/TaskGraph behavior, commands, and any global resources not listed above.
- Importing source configuration values, model assignments, providers, MCP definitions, credentials, preferences, backups, evals, runtime state, or `node_modules`.
- Applying a profile during install/update, silently applying one, or mutating real global configuration during tests.
- Automatic prompt semantic merging, package publication, network operations, or tests against the real HOME.

## Requirements

**Dado** el inventario sanitizado autorizado y la fuente global actual sin drift
**Cuando** se genera el catálogo real
**Entonces** contiene exactamente los 13 agentes, los 10 skills completos y sus archivos auxiliares, y ningún dato/configuración excluido.

**Dado** un agente importado
**Cuando** se instala para OpenCode 2
**Entonces** su entrada gestionada declara modo y permisos mínimos, conserva configuración no gestionada y no declara modelo, proveedor, MCP ni credenciales.

**Dado** Sky Agents instalado
**Cuando** se crea, edita, lista, elimina o selecciona un perfil
**Entonces** solo cambia el almacén de perfiles aislado; instalar Sky Agents nunca cambia asignaciones globales.

**Dado** un perfil seleccionado
**Cuando** el usuario solicita `Apply`
**Entonces** se muestra el diff exacto, se exige confirmación explícita, se crea un backup acotado y solo después se actualizan los campos `agent.<id>.model` gestionados mediante la transacción común.

**Dado** un slice con `tdd=false` o una ejecución de diagnóstico sin gateway seguro
**Cuando** los prompts resuelven la ruta
**Entonces** no imponen TDD y el diagnóstico bloquea sin sustituir el gateway por shell.

**Dado** una selección de componentes
**Cuando** se instala o actualiza
**Entonces** solo se planifican recursos pertenecientes a `configuration | agents | skills | commands | plugins`; en esta entrega `commands` queda vacío y cada archivo instalable tiene identidad propia.

## Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Source drift or accidental import of private config | high | Reproducible allowlist importer, exact inventory digest and per-file SHA-256 checks, fail closed before writing generated resources; review generated diff for forbidden keys/paths. |
| Agent permissions exceed intended authority | high | Explicit per-agent capability map, deny-by-default generated entries, schema validation, and two independent security reviews. |
| JSONC rewrite clobbers comments or post-install edits | high | Use `jsonc-parser` AST edits per owned path; never serialize the whole document; re-read and verify expected digest in the installer transaction. |
| Profile install implicitly changes models | high | Keep install/profile CRUD non-mutating; expose `Apply` separately and require interactive confirmation regardless of prior installer approval. |
| Failed profile apply leaves partial assignments | high | Snapshot selected config and lock/state first, use the existing leased transaction executor, commit state last, rollback exact bytes on failure. |
| Vendored Sky Agents uses obsolete V2 plugin/client/RPC/TUI APIs | high | Pin verified compatible dependencies, adapt to official V2 contracts, and run an isolated beta-19425 load/RPC smoke check; block release if documented API is insufficient. |
| Auxiliary skill files lose ownership/update tracking | medium | One manifest resource per physical file, preserving relative directory structure and independent digests. |

## Rollback

Repository rollback is a normal revert of the implementation commit. Runtime install/update rollback uses `executeTransaction()` snapshots and lock restoration. Profile Apply writes a transaction backup under `<stateRoot>/backups/<transactionId>/` containing the selected config's prior exact bytes and manifest; failure restores those bytes, while a successful apply is reversed with the existing bounded backup restore path. No rollback may derive mutation paths from untrusted absolute metadata.

## Success Criteria
- [ ] Catalog validation proves exactly 13 agent entry files plus all inventoried files belonging to the 10 approved skill directories and `_shared`, with one manifest identity per physical file.
- [ ] Generated config contains only managed agent mode/minimum-permission fields and the required plugin registration; forbidden private keys and absolute source paths are absent.
- [ ] Sky Agents builds from vendored sources and profile CRUD/install are proven non-mutating.
- [ ] Profile Apply cannot run without its own explicit confirmation and pre-mutation backup; injected failure restores config and state exactly.
- [ ] Component selection installs only selected leaves; no placeholder command or resource remains.
- [ ] Post-implementation Node 24 checks, isolated installer scenarios, isolated OpenCode 2 compatibility smoke checks, and two independent security reviews pass.

## Technical Context

The current catalog schema in `packages/catalog/src/schema.ts` validates one resource per ID/destination and the fixed component enum already is `configuration | agents | skills | commands | plugins`. `loadCatalog()` rejects symlinks and undeclared files, while `openCodeTarget.desiredArtifacts()` currently defaults to all five components and `mergeConfig()` only edits `$schema` and the `plugins` array. The existing manifest has five placeholders, including a command that is not selected for this migration. `executeTransaction()` already supplies lease, snapshot, verification, lock-last commit, and rollback semantics. The CLI currently treats plugins as executable content and supports isolated roots, but it has no profile command.

The sanitized inventory is the implementation source of truth for path/hash allowlisting. It records 16 candidate agents, 24 global-skill files, two absolute-path wrappers, nine Sky Agents source files, and dependency names. The approved subset excludes three agents but retains every physical file under `_shared` and the ten named skill directories. The inventory records source locations only for controlled regeneration; those absolute locations must never appear in shipped resources.

Official V2 migration guidance already establishes that agents, commands, and complete skill directories remain compatible, while plugin/server/client integrations require migration. Before coding Sky Agents, re-check the official V2 migration, plugins, CLI plugins, RPC/server/client, agents, permissions, configuration, and backup/config-location pages against beta 19425. Context7 was unavailable due an invalid API key, so exact plugin/TUI signatures remain a documented implementation gate rather than something to guess in this plan.

## Implementation Steps

### Step 1: Add a reproducible sanitized resource importer
- **What**: Turn the approved inventory into a deterministic, fail-closed generator for checked-in catalog inputs.
- **Why**: Manual copying cannot prove completeness, provenance, or exclusion of sensitive values.
- **Where**: `scripts/import-real-resources.mjs` (proposed), `.skynex/tasks/real-resources/global-inventory.json` (read-only input), `targets/opencode/resources/provenance.json` (proposed), `targets/opencode/resources/canonical/agents/**`, `targets/opencode/resources/canonical/skills/**`.
- **How**:
  - Implement proposed CLI `node scripts/import-real-resources.mjs --inventory <path> --source-root <path> --sky-agents-root <path> --output-root <path> --check|--write` with `--check` as the verification default. Parse schema fields, recompute the full inventory SHA-256, and require `e77b256d2b992b021eaa12c8e85e35cbf04ef2a69b9d49f8569363fe1f2022f2` before any output.
  - Hard-code the approved agent allowlist (`coder`, `diagnostic-researcher`, `infrastructure-engineer`, `mentor`, `pr-reviewer`, `security`, `skill-validator`, `skynex-orchestrator`, `task-classifier`, `tech-planner`, `test-engineer`, `test-reviewer`, `verifier`) and skill-root allowlist (`_shared` plus the ten named skills). Reject any missing, duplicate, symlinked, extra, hash-mismatched, absolute, or traversal path.
  - Copy bytes without reading configuration files. Add a scanner that rejects absolute source-root strings and forbidden configuration vocabulary (`provider`, `mcp`, credential/token/secret keys, copied model assignments); allow ordinary prose references only through an explicit reviewed exception list so the scanner does not silently delete instructions.
  - Emit stable `provenance.json` with inventory digest, each source-relative path, source digest, generated destination, transformation ID/version, and generated digest—never source absolute roots or config values. Generate to `/tmp/opencode/skynex-real-resources` first, compare, then atomically replace only approved catalog paths under `--write`.
  - Preserve all skill directory structure. Auxiliary files such as `_shared/*.md`, `diagnose/scripts/hitl-loop.template.sh`, `prd/references/*.md`, `triage/{AGENT-BRIEF,OUT-OF-SCOPE}.md`, and `visual-recap/{README,references/*}.md` remain separate outputs.
- **Acceptance**: Two generations are byte-identical; `--check` reports no drift; removing or changing one source file fails; generated provenance has no absolute machine paths; counts match the exact allowlists.
- **Status**: [ ] pending

### Step 2: Normalize prompts and generate least-privilege agent configuration
- **What**: Apply narrowly specified V2 metadata and policy transformations without importing personal configuration.
- **Why**: Compatible Markdown still needs managed mode/permission declarations and inherited workflow language must match the approved route semantics.
- **Where**: `scripts/lib/real-resource-transforms.mjs` (proposed), `targets/opencode/resources/canonical/agents/*.md`, `targets/opencode/resources/canonical/skills/{diagnose,tdd-discipline}/**`, `targets/opencode/resources/canonical/config/managed-agents.json` (proposed).
- **How**:
  - Implement pure proposed functions `transformAgent(source, policy): string`, `transformSkillFile(path, source): string`, and `buildManagedAgentConfig(policies): Record<string, ManagedAgentEntry>`. Keep body text unchanged except reviewed replacements identified in provenance.
  - Define an explicit `AgentPolicy` map for all 13 IDs: `mode: "subagent"` (or the documented V2 equivalent) and a deny-by-default minimum permission map. The implementation must derive no permissions from the source global config; each allowed tool class is code-reviewed per role.
  - Generate only `{ mode, permission }` (using exact official schema names after Step 0 documentation verification). Add a structural denylist that fails if any generated entry contains `model`, `provider`, `mcp`, credentials, or unknown top-level fields.
  - Harmonize mandatory TDD text so it is conditional on `slice.tdd === true`; for this route (`slice.tdd=false`) implementation and verification remain post-test. Update diagnose instructions to require the secure diagnostic gateway and return blocked when unavailable, explicitly prohibiting shell fallback.
  - Treat prompts as untrusted data: transformations are exact anchored replacements with expected match counts; zero or multiple matches fail generation and require review rather than broad regex rewriting.
- **Acceptance**: Every approved agent has exactly one validated managed entry; no forbidden field is emitted; golden transformed excerpts prove route-scoped TDD and fail-closed diagnosis; unchanged source sections retain their digests modulo declared transforms.
- **Status**: [ ] pending

### Step 3: Model every physical resource and selection leaf in the catalog
- **What**: Replace placeholders with manifest entries for all approved files and generated config.
- **Why**: Update ownership, selective install, and drift reporting operate per manifest resource, not per implicit directory.
- **Where**: `packages/domain/src/resources.ts`, `packages/catalog/src/schema.ts`, `packages/catalog/src/load-catalog.ts`, `targets/opencode/resources/manifest.json`, `targets/opencode/src/transformer.ts`, `scripts/verify-installer-catalog.mjs`.
- **How**:
  - Keep the closed `InstallComponent` enum exactly `configuration | agents | skills | commands | plugins`; do not add a Sky Agents component. Map its runtime leaves to `plugins`, managed agent config to `configuration`, agent Markdown to `agents`, and every skill file to `skills`.
  - Declare each physical output as an individual `CatalogResource`; use stable IDs such as `agent.<name>`, `skill.<skill-name>.<relative-file-slug>`, `config.managed-agents`, and `plugin.sky-agents.<module>`. Keep one destination per identity and preserve `skills/<name>/<relative path>` ownership.
  - Remove the placeholder `safe-install`, `skynex-doctor`, placeholder runtime/hook entries and files unless one is explicitly required by the real selected assets; do not introduce commands because this migration selected none.
  - Extend manifest validation with optional immutable provenance fields (`sourceDigest`, `transform`) or join by resource ID from `provenance.json`; proposed `validateProvenance(manifest, provenance): void` must prove every declared generated file has exactly one provenance record and every record is declared.
  - In `openCodeTransformer`, filter each leaf only by its declared component. Verify empty `commands` is valid and selecting `skills` cannot pull `plugins`, config, or agents.
- **Acceptance**: Catalog loader rejects orphan/missing/duplicate provenance; all canonical/native files are declared individually; component matrix checks prove exact leaf selection; no placeholder command ships.
- **Status**: [ ] pending

### Step 4: Expand AST-preserving managed OpenCode configuration
- **What**: Merge managed agent entries and plugin registration without replacing unrelated or post-install configuration.
- **Why**: The current `mergeConfig(source, includePlugin)` cannot install generated agent policy and whole-object serialization would clobber user edits.
- **Where**: `targets/opencode/src/config-merge.ts`, `targets/opencode/src/index.ts`, `targets/opencode/src/transformer.ts`, `packages/application/src/index.ts`, `scripts/verify-installer-catalog.mjs`, `scripts/verify-installer-updates.mjs`.
- **How**:
  - Replace the boolean API with proposed:
    ```ts
    export interface ManagedConfigSelection {
      readonly pluginPackages: readonly string[];
      readonly agents: Readonly<Record<string, ManagedAgentEntry>>;
    }
    export function mergeManagedConfig(source: string, selection: ManagedConfigSelection): string;
    export function removeManagedConfig(source: string, ownership: ManagedConfigOwnership): string;
    ```
  - Parse JSON/JSONC once, reject malformed/non-object roots and wrong-shaped `plugin`/`plugins` or `agent` nodes according to the verified official schema. Apply `jsonc-parser.modify()` edits only at `$schema` when absent, each owned plugin array element, and each owned `agent.<id>.mode`/permission leaf.
  - Never replace an entire pre-existing agent object. Preserve unowned keys, comments, ordering where `jsonc-parser` permits, unknown plugins, and post-install fields. If an owned leaf has a conflicting unmanaged value, surface an installer conflict instead of overwriting it.
  - Represent the config edit as one `opencode-config` artifact with ownership metadata listing exact JSON paths, so uninstall removes only Skynex-owned leaves and prunes an empty managed object only when safe.
  - Update `TargetAdapter.desiredArtifacts()` to compile selected leaf resources first, then synthesize the single config artifact only when `configuration` or `plugins` requires registration. Installing only agents/skills must not create unrelated config except where official discovery requires it; document that dependency explicitly if docs prove it is required.
- **Acceptance**: JSON and JSONC fixtures retain comments, external plugins, unmanaged agents/models, and post-install additions; install/update/uninstall are idempotent; collisions become reviewed conflicts; forbidden values are never copied.
- **Status**: [ ] pending

### Step 5: Vendor and adapt Sky Agents to documented V2 contracts
- **What**: Create a portable workspace package from the nine inventoried modules and replace absolute wrappers.
- **Why**: The wrappers point outside the repository and V2 plugin/client/RPC/TUI surfaces are migration-breaking.
- **Where**: `packages/sky-agents/package.json` (proposed), `packages/sky-agents/tsconfig.json` (proposed), `packages/sky-agents/src/{catalog,confirm-profile,index,manage-profile,profiles,rpc,save-model,storage,tui}.{ts,tsx}` (proposed), `targets/opencode/resources/native/plugins/sky-agents.ts` (proposed), `targets/opencode/package.json`, root `tsconfig.json`, `pnpm-lock.yaml`.
- **How**:
  - Vendor the nine source-reference files through Step 1 and replace all machine-absolute imports with relative/package imports. Do not copy either wrapper or `node_modules`.
  - Declare only dependencies actually imported after adaptation, starting from inventory evidence: `@opencode-ai/client`, `@opencode-ai/plugin`, `@opentui/core`, `@opentui/solid`, `jsonc-parser`, and `solid-js`; pin versions verified against beta 19425 and remove unused dependencies after compile. Add project references in dependency order.
  - Adapt plugin export, client creation, server/RPC calls, and TUI component signatures to official V2 docs. If no stable documented TUI/CLI-plugin surface supports a feature, return a blocking compatibility finding rather than reaching into internal APIs.
  - Define ports so behavior is testable and bounded:
    ```ts
    export interface ProfileStore { list(): Promise<Profile[]>; get(id: string): Promise<Profile|null>; save(profile: Profile): Promise<void>; remove(id: string): Promise<void>; }
    export interface ProfileApplyPort { preview(profileId: string): Promise<ProfileApplyPlan>; apply(plan: ProfileApplyPlan, confirmation: ExplicitApplyConfirmation): Promise<TransactionResult>; }
    export function createSkyAgentsPlugin(deps: SkyAgentsDependencies): Plugin;
    ```
  - Store profiles under the supplied Skynex state root, not OpenCode global config. Ensure list/get/create/update/delete/select only use `ProfileStore`; they must not call `ProfileApplyPort.apply()`.
  - Ship compiled/package-resolvable plugin output through catalog resources or a local package registration supported by OpenCode; manifest resources must never enumerate `node_modules`. The installer/package manager owns dependencies, while catalog owns Skynex source/build artifacts.
- **Acceptance**: Workspace build resolves no external absolute path; dependency audit matches imports; plugin loads in an isolated beta-19425 environment; profile CRUD changes only isolated profile storage; unsupported official APIs block rather than invoke internals.
- **Status**: [ ] pending

### Step 6: Implement explicit, transactional profile Apply
- **What**: Add a separately authorized mutation path for global managed-agent model assignments.
- **Why**: Profiles are useful only if applying them is safe, visible, reversible, and never coupled to install.
- **Where**: `packages/domain/src/install.ts`, `packages/application/src/profile-apply.ts` (proposed), `packages/installer/src/profile-apply.ts` (proposed), `packages/installer/src/transaction.ts`, `packages/installer/src/backup-service.ts`, `packages/sky-agents/src/{confirm-profile,save-model,rpc,tui}.{ts,tsx}`, `apps/cli/src/index.ts` or a thin command module if CLI exposure is required by the documented integration.
- **How**:
  - Define `ProfileApplyPlan` with target config relative path, selected managed agent IDs, current/desired model values, current config digest, exact JSON ownership paths, and `scope: "global"`. Reject project scope, unknown agents, unknown config shape, provider/MCP edits, or any desired path outside `agent.<approved-id>.model`.
  - `previewProfileApply()` reads only the selected global JSON/JSONC file and returns a human-readable before/after diff without writing. Profile model strings come from the user's locally authored profile, not imported defaults.
  - Require a fresh opaque `ExplicitApplyConfirmation` generated only after the exact plan digest is rendered and the user chooses the literal Apply action. Installer `--yes`, plugin installation approval, profile selection, or profile save must never satisfy this confirmation.
  - Convert the AST edit into a single config replacement operation and call existing `executeTransaction({ plan, lockBytes, verify, expectedPreviousLockDigest })`. Snapshot must finish under `<stateRoot>/backups/<transactionId>/` before writing; verification reparses config and confirms only approved model paths changed; lock/apply state commits last.
  - Re-read config and plan digest immediately before apply. On mismatch, abort and require a new preview/confirmation. On failure, propagate `restoredPaths`/`unreconciledPaths`; leave recovery metadata and lease behavior consistent with existing transactions.
  - Keep install/update paths incapable of constructing `ExplicitApplyConfirmation`; this is an API-level separation, not only a UI convention.
- **Acceptance**: Apply without a fresh exact-plan confirmation is impossible; install/profile CRUD never mutate model assignments; successful Apply has a bounded backup and exact state record; injected write/verify/lock failures restore prior bytes; unrelated config is byte-preserved except AST-local formatting.
- **Status**: [ ] pending

### Step 7: Integrate selection, user-facing warnings, and documentation
- **What**: Make real resources discoverable while retaining the fixed installer component contract.
- **Why**: Users need accurate previews and must understand executable plugin/profile authority.
- **Where**: `apps/cli/src/index.ts` (prefer extraction to `apps/cli/src/commands/install.ts` and `apps/cli/src/commands/profile.ts`), `packages/presentation/src/index.ts`, `README.md`, `targets/opencode/README.md`, `docs/security-model.md`, `docs/runtime-verification.md`.
- **How**:
  - Keep the component values exactly the existing five and declare each leaf individually in previews. Rename labels only: configuration (“managed agent modes/permissions”), agents, skills, commands (empty/not offered for this catalog), plugins (“Sky Agents executable extension”).
  - Hide or disable `commands` when catalog count is zero; noninteractive defaults select only nonempty components. Never broaden a selected component through UI convenience.
  - Render executable-code warning before plugin approval. Render profile Apply as its own diff/confirmation flow and state the backup path after success; installation must finish without prompting to apply a profile.
  - Document source provenance and regeneration/check commands, included/excluded IDs, complete skill ownership, dependency/build model, config ownership, profile storage versus Apply, rollback, isolated test policy, and accepted absence of TDD for this slice.
  - Document that prompts are data and that `diagnose` blocks without a secure gateway; no docs should suggest shell fallback.
- **Acceptance**: CLI preview names every selected leaf and no unselected destination; command component is not falsely advertised; docs match manifest counts and runtime boundaries; installer completion causes no model mutation.
- **Status**: [ ] pending

### Step 8: Add post-implementation isolated verification and dual security review
- **What**: Verify behavior after implementation, never red-first and never against real globals.
- **Why**: The human explicitly selected no TDD while still requiring strong regression and security evidence.
- **Where**: `scripts/verify-installer-catalog.mjs`, `scripts/verify-installer-cli.mjs`, `scripts/verify-installer-transactions.mjs`, `scripts/verify-installer-updates.mjs`, `scripts/verify-opencode2.mjs`, `scripts/verify-real-resources.mjs` (proposed), `scripts/verify-sky-agents.mjs` (proposed), root `package.json`, `.github/workflows/ci.yml` if present/created.
- **How**:
  - Extend post-tests only after Steps 1–7: inventory/source drift and forbidden-field scanning; exact agent/skill/file counts; per-leaf manifest ownership; component selection matrix; JSON/JSONC preservation; prompt TDD/diagnose policy checks; no absolute paths; Sky Agents profile CRUD non-mutation; explicit Apply authorization; stale-plan refusal; backup and rollback fault injection.
  - Every runner creates `/tmp/opencode/...` roots and sets `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME`. Copy only a fixture config into the isolated root and hash real global sentinels before/after; never pass `/home/clasing/.config/opencode` as a target.
  - Update `verify-opencode2.mjs` to invoke the installed binary only with isolated copied configuration and documented read-only/load-validation operations. Capture exact binary/version/arguments/environment roots. If plugin loading necessarily executes code or docs cannot prove safe isolation, report a structured blocked/skip rather than touching real state.
  - Run two independent read-only security reviews over the final diff: reviewer A focuses path/config/transaction/credential boundaries; reviewer B focuses prompt permissions, executable plugin/RPC/TUI behavior, and profile authorization. Resolve all high findings and record accepted lower risks.
  - CI remains Node 24/pnpm, contains no publication/network credential/global-install step, and runs post-implementation checks only.
- **Acceptance**: All isolated checks pass, real global sentinel hashes are unchanged, beta compatibility evidence is recorded or release is blocked with an exact API gap, and both security reviews have no unresolved high finding.
- **Status**: [ ] pending

## Verification

Run only after implementation from `/home/clasing/umibu/skynex-v2`; these are post-tests, not a TDD gate:

```bash
node --version                         # must satisfy >=24
pnpm --version                        # expected 10.15.1
node scripts/import-real-resources.mjs --inventory .skynex/tasks/real-resources/global-inventory.json --source-root <controlled-current-global-snapshot> --sky-agents-root <controlled-sky-agents-snapshot> --output-root targets/opencode/resources --check
pnpm check
pnpm build
pnpm verify:installer
node scripts/verify-real-resources.mjs
node scripts/verify-sky-agents.mjs
pnpm verify:opencode
git diff --check
git status --short
```

Verification evidence must include the full authorized inventory SHA-256, generated provenance digest, exact catalog counts and component matrix, forbidden-key/absolute-path scan, isolated HOME/XDG paths, before/after real-global sentinel hashes, profile Apply backup/recovery evidence, exact beta-19425 invocation or structured compatibility block, and both security review verdicts. No install, test, or smoke command may target the real global config.

## Unresolved Material Facts

1. Exact OpenCode 2 beta-19425 plugin export, CLI-plugin/TUI, RPC/client, permission, agent-config, and backup/config-location signatures were not fetched in this planning-only/no-network slice; Context7 previously failed authentication. Recommended default: make official-doc verification the first implementation gate and block unsupported Sky Agents surfaces rather than use internals.
2. The nine-file Sky Agents inventory lists file hashes and dependencies but not safe source bodies in the sanitized artifact. Recommended default: the controlled importer reads only the listed source files from the authorized read-only source, validates hashes, and emits sanitized vendored files; no manual reconstruction.
