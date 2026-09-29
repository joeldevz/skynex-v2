# Design Tree — Plugin-enforced security review switch

## Resolved decisions
- E1: The `skynex-tasks` plugin enforces `reviews.security=off` with the OpenCode 2 `tool.hook("execute.before")`: a `subagent` call whose `input.agent` is `security` is blocked with "Revisión de seguridad desactivada por la tarea". The prompt stays as guidance/reporting.
- E2: Task id comes from the session snapshot published via `skynex_task_update`; the current value is read fresh with `skynex task status --task <id> --json` (option A).
- E3: Bounded exception to "plugin does not touch the system": only `review-gate.ts` may use `node:child_process`; `execFile` without shell, fixed argv, id validated `[a-z0-9][a-z0-9-]{0,79}`, 2 s timeout, 64 KiB output cap, only `reviews.security` used. Installer verifier allows it only in that module.
- E4: Runs only for security subagent calls. Any failure (no task, CLI missing, timeout, bad output) allows the call (same as `auto`).
- E5: Residual risk: `skynex` resolved from the user's PATH (same-user local model, as previously accepted).
- E6: Security-sensitive change; task review switch `auto` → dual security review applies.

## Out of scope
- Enforcing `on` (preventing completion without security).
- Other security-like agents beyond `security`.

## Live sidebar (issue #5)
- L1: `review-gate.ts` stays the only `node:child_process` module; it also exposes `readTask`, mapping `skynex task status --task <id> --json` into the sidebar projection shape (validated by `snapshot.ts` in the server). Output cap raised to 1 MiB for large tasks; 2 s timeout kept. The gate still reads `reviews.security` fresh on every security call.
- L2: The server caches the projection per session in `ctx.storage` (same key) and refreshes it from the CLI once, deduped in flight, only on: `skynex_task_update` publish, `tool.hook("execute.after")` for `bash`/`shell` tools whose string `input.command` contains `skynex task`, and the first `getSessionTask` of a stored task in this server process. No timers; zero processes while idle. On CLI failure the published snapshot is kept.
- L3: `skynex_task_update` accepts binding-only `{task:{id}}` besides the full payload (backward compatible). With only the id known and no successful refresh, the sidebar shows the id as title.
- L4: TUI/controller unchanged: its 4 s `getSessionTask` poll reads only `ctx.storage`; it never triggers CLI reads after the first refresh.
