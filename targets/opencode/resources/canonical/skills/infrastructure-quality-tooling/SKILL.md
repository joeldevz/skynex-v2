---
name: infrastructure-quality-tooling
description: Preserves specialized infrastructure quality-tool and acceptance-runner conventions. Use when assigned CRAP, DRY or mutation analysis, Uncle Bob Gherkin acceptance-pipeline work, or Clojure/Java test-runner infrastructure; not for generic infrastructure or config edits.
---

# Infrastructure quality tooling

## Scope and authority

Apply only the sections relevant to the assigned operation. Current project
conventions and the authoritative brief select scope; loading this skill never
authorizes downloads, installation, tests, builds, remote access, or delegation.
Explicit prohibitions take precedence. Return a concrete blocked requirement or
coverage gap rather than silently running prohibited tooling.

## Tool preparation

- Before authorized CRAP, mutation or DRY analysis, resolve the needed tool's current
  upstream version from its listed `github.com/unclebob/...` repository. Prefer a
  fresh upstream install/build when authorized and feasible; do not silently trust
  stale caches or vendored/preinstalled binaries. Record versions and any limitation.
- Go: `go install` for `mutate4go`, `crap4go`, `dry4go` under that GitHub owner.
- Clojure: Clojure CLI/deps.edn for `clj-mutate`, `crap4clj`, `dry4clj`.
- Java: Maven only to install/build `mutate4java`, `crap4java`, `dry4java`, not to run tests.
- Check upstream docs and local help before constructing exact commands; do not
  infer flags. External downloads require the parent's explicit authorized scope.

## Language and module constraints

- In applicable Clojure runner work, prefer Babashka where practical and Speclj for
  unit/behavior tests. Changed Speclj specs require an authorized
  `github.com/unclebob/speclj-structure-check` run before relevant tests.
- In applicable Java runner work, use dedicated test runners instead of Maven tests.
- Keep tests close to behavior. Separate testable modules from GUI, device,
  external-service, error-emitting or hanging boundaries; only testable modules
  enter unit, acceptance, coverage, mutation, CRAP, DRY or property tooling.
- Property tests stay separate from normal verification unless explicitly assigned.

## Gherkin acceptance pipeline

- Use `github.com/unclebob/Acceptance-Pipeline-Specification`; obtain its
  `gherkin-parser` and `gherkin-mutator`. Prefer its Babashka tools, falling back to
  Go only when Babashka does not work in this project.
- The project owns the entrypoint generator, runtime, step handlers, runner adapter
  and convenience scripts. Acceptance mutation changes example values through
  `gherkin-mutator`; never hand-edit mutation or Gherkin-mutation manifests.
- Run acceptance generation then acceptance tests sequentially. Never overlap
  whole-suite language tests with acceptance generation.
- Use project-local caches/config when possible. Bound run time/output; long jobs
  emit progress and must be reconciled as completed or terminated before handoff.

## Example selection

For a Gherkin-mutator integration, load the pipeline and preparation sections and
report exact authorized versions/commands. For an MCP JSON registration, none of
these tool installations or test-runner preferences apply.
