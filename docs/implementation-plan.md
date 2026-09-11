# Implementation Plan

The human partner explicitly requested implementation without TDD for initial evaluation.
Each step still ends with focused automated and manual verification; tests may be added after
behavior exists, but no step requires red-first evidence.

## Phase 0 — Bootstrap (this delivery)

### Step 0.1 — Establish repository

**How:** Create the private GitHub repository and local pnpm workspace; select Node 24,
TypeScript 7, ESM, Apache-2.0, and private provisional package names.

**Done when:** dependency installation, type checking, build, and CLI help succeed.

### Step 0.2 — Freeze product boundaries

**How:** Record the design tree, PRD, DDD model, architecture, ADRs, and future graph seam
under `/docs`.

**Done when:** documents agree that OpenCode 2 is the only MVP target and graph is excluded.

## Phase 1 — Walking skeleton

### Step 1.1 — Define canonical resource schema

**How:** Add versioned schemas and domain values for agents, skills, commands, hooks, MCP,
configuration, and native resources. Model semantic intent rather than OpenCode field names.

**Done when:** valid fixtures load and invalid IDs, versions, and resource combinations produce
typed errors.

### Step 1.2 — Add application ports

**How:** Define ports for catalog loading, target detection, transformation, filesystem state,
snapshot storage, lock storage, diff rendering, and user decisions.

**Done when:** an in-memory composition can plan an installation without filesystem access.

### Step 1.3 — Implement OpenCode transformer skeleton

**How:** Resolve current OpenCode 2 documentation, pin a compatibility range, and compile one
representative canonical resource into a deterministic artifact.

**Done when:** repeated compilation produces byte-identical output and reports unsupported intent.

## Phase 2 — Safe installation

### Step 2.1 — Detect OpenCode 2

**How:** Implement target-specific discovery of version, config roots, and extension locations.
Discovery is read-only and distinguishes absent, compatible, and incompatible installations.

**Done when:** `skynex doctor` reports evidence and actionable errors without mutation.

### Step 2.2 — Build deterministic plans

**How:** Compare desired artifacts against local bytes and lock state. Emit create, replace,
preserve, adopt, conflict, and no-op operations with expected digests.

**Done when:** `skynex install --dry-run` lists every operation and changes zero bytes.

### Step 2.3 — Add interactive preview

**How:** Present components, destinations, conflicts, and diffs via an abstract UI port backed by
Clack. Require one final confirmation after all per-resource decisions.

**Done when:** cancellation at every prompt exits without mutation and noninteractive mode can
consume a complete explicit policy.

### Step 2.4 — Add bounded snapshots

**How:** Validate every mutation path, reject symlinks, then snapshot only existing accepted
destinations. Isolate retention/cleanup from transaction success.

**Done when:** an unrelated unreadable or oversized directory and a broken historical snapshot
cannot block installation.

### Step 2.5 — Apply and verify

**How:** Revalidate preconditions, write temporary files with restrictive permissions, atomically
replace destinations, verify digests and target validity, then commit lock state.

**Done when:** injected failures roll back prior mutations and identify any unreconciled path.

## Phase 3 — Resource-aware updates

### Step 3.1 — Implement three-way classification

**How:** Compare previous source, current local, and next source content. Preserve enough previous
source material or a bounded content-addressed reference to render meaningful diffs.

**Done when:** local-only, upstream-only, identical, and divergent states classify deterministically.

### Step 3.2 — Review skills and agent prompts

**How:** Show changelog metadata and unified text diff for every upstream-changed skill or agent
prompt. Offer accept, keep local, resolve, and skip.

**Done when:** no changed prompt is replaced without its decision being visible in the final plan.

### Step 3.3 — Preserve truthful lock state

**How:** Record upstream source digest separately from installed/local digest and pending upstream
state when the user keeps or skips a local version.

**Done when:** a later update still detects the unresolved difference instead of treating it as current.

## Phase 4 — Lifecycle completion

### Step 4.1 — Uninstall only owned resources

**How:** Use lock ownership and current digests. Prompt when managed bytes were locally modified;
never infer ownership from filenames alone.

**Done when:** unmanaged and modified resources survive unless explicitly authorized.

### Step 4.2 — Backup retention and recovery

**How:** Add separately invoked list, restore, and prune operations. Pruning is explicit and cannot
run as a hidden installation prerequisite.

**Done when:** users can restore one transaction and inspect exact affected resources.

### Step 4.3 — Package and acceptance verification

**How:** Build a distributable CLI, test clean install/update/conflict/rollback/uninstall in isolated
homes, and publish no package until product naming is resolved.

**Done when:** the acceptance matrix passes on supported platforms and OpenCode versions.

## Phase 5 — Portability validation

Choose a second engine only after the OpenCode lifecycle is complete. Implement one portable hook,
skill, and agent prompt plus one native-only resource to validate that the boundaries work.

## Phase 6 — Future Task Graph

Start only after a separate approved design and PRD. Reuse application ports; do not revive the old
`skynex workflow` design by default.
