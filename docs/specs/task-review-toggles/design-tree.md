# Design Tree — Task review toggles (security / skills)

## Resolved decisions
- D1: Only the security review (dual judges) and the skill-validator are toggleable. Human gates for external/destructive actions (push, PR, global install, deletes, reset) stay always on. — Prototyping must not risk irreversible actions.
- D2 (superseded by D11): Separate switches `security` and `skills`, each `on | off | auto`. No named "prototype mode". — Explicit and independent.
- D3: Default `auto`: the orchestrator runs the review only when risk requires it (permissions, secrets, config, install, etc.). An explicit `off` from the human always wins, even if auto would require it. — Low friction; human stays in control.
- D4: The task is the source of truth. A chat instruction ("no security for this") updates the task value, which then applies. Without a task: chat instruction, else `auto`. — One durable place for the setting.
- D5: When a review is skipped: one line in the final summary and a warning in the PR body if a PR is opened (e.g. "⚠️ no security review — disabled by task"). If `auto` would have required it, also state the detected risk. — Never blocks, but stays visible.
- D6: CLI: `skynex task reviews set security=on|off|auto skills=on|off|auto [--task <id>]`; `skynex task init ... --security <v> --skills <v>`. Stored structured in `task.json`, shown in `skynex task status` (and `--json`). Only the three values are valid. — Structured and validatable, not free text.
- D7: The sidebar shows a small marker only when something is `off` (e.g. `🔓 no security`). — Visible while working, no noise otherwise.
- D8: Update the managed `skynex-tasks` skill (`targets/opencode/resources/canonical/skills/skynex-tasks/SKILL.md`) to document `reviews set`, `init --security/--skills`, precedence (task wins; chat instruction updates the task) and the skip-reporting rule. `skills` = the `skill-validator` agent. — Agents learn the feature through the skill.
- D9 (superseded by D11): The `skills` switch is renamed `conventions` (still = the `skill-validator` agent). Schema key `reviews.conventions`; CLI accepts only `conventions=<v>` / `--conventions <v>` and rejects `skills=` / `--skills` with INVALID_ARGUMENT. Existing `task.json` files with `reviews.skills` are still read as `conventions` and rewritten as `conventions` (dropping `skills`) on the next write. — Clearer name; no breakage for stored tasks.
- D10 (superseded by D11): Sidebar markers, each shown only when its switch is `off`, each with its own lock, on one line: `🔓 sin seguridad · 🔓 sin convenciones`. — Each skipped review is equally visible.
- D11: Single review switch `security` (`on | off | auto`, covers ALL security reviewers). The `conventions` switch is removed entirely; `skill-validator` returns to its prior automatic scheduling with no switch. Schema is `reviews: {security}` only; CLI accepts only `security=<v>` / `--security <v>` and rejects `conventions=`, `skills=`, `--conventions`, `--skills` with INVALID_ARGUMENT (exit 2). Legacy `task.json` keys `reviews.skills` / `reviews.conventions` are ignored on read and dropped on the next write. Sidebar marker only when security is `off`: exactly `🔓 Omitido: seguridad`. Supersedes D2, D9, D10. — Human decision: one switch only.

## Open assumptions (validate before PRD)
- A1: Thalam prompt (canonical `agents/thalam.md` and policy text "security-sensitive diffs always launch two judges") must be amended to honor the task setting. — If not, the prompt keeps forcing reviews.
- A2: Existing tasks without the field read as `auto` (backward compatible schema). — Otherwise old tasks fail to load.
- A3: The `skynex_task_update` sidebar snapshot needs a new optional field for review state. — Otherwise the sidebar can't show D7.

## Out of scope (explicit)
- Project-wide default in `.skynex/config` (deferred).
- Toggling verifier, pr-reviewer or TDD flow.
- Disabling human gates.

## Ready for PRD
✅ yes (validate A1–A3 during planning)
