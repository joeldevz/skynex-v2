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
