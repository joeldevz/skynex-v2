# Design Tree — Skynex v2

## Resolved decisions

- D1: Rewrite Skynex from scratch in a new repository rather than migrate the existing workflow engine.
- D2: Use a single monorepo for product code, installer, target assets, and documentation.
- D3: Use TypeScript 7, Node.js LTS, pnpm workspaces, and ESM.
- D4: Keep packages private under the provisional `@skynex-internal/*` scope; naming cannot block development.
- D5: OpenCode 2 is the only initial installation target.
- D6: Maintain one canonical definition for semantically portable resources and compile it into native target artifacts.
- D7: Use a hybrid model: target-exclusive plugins and TUI extensions remain native assets.
- D8: Skynex supplies configuration to the target engine; it does not initially replace the engine runtime.
- D9: Updates are user-controlled per resource and expose changes to skills and agent prompts before replacement.
- D10: Update comparison uses previous upstream, current local, and next upstream content.
- D11: Installation state uses a manifest, lockfile, and bounded backups; SQLite is not required.
- D12: Backups cover only paths mutated by the current plan and must not scan unrelated target trees.
- D13: The Task Graph is a future Skynex-owned capability, explicitly excluded from the first implementation.
- D14: Use Clack for the initial interactive CLI behind an application-facing UI port.
- D15: License the repository under Apache-2.0.
- D16: The bootstrap is intentionally built without TDD at the human partner's request; verification is still required.

## Open assumptions

- A1: OpenCode 2 provides stable documented extension surfaces for every artifact selected for the MVP.
- A2: A human-readable terminal diff is sufficient for first-release update decisions.
- A3: A local single-user transaction model is sufficient before the Task Graph exists.
- A4: The final product and npm package names will be chosen before publication.

## Out of scope

- Task Graph, scheduler, multi-agent execution, and `skynex workflow`.
- Claude, Pi, Codex, and cross-target parity.
- npm publication.
- Universal representations for target-exclusive behavior.
- Migrating historical workflow receipts or databases.

## Ready for PRD

✅ Approved by the human partner on 2026-09-10.
