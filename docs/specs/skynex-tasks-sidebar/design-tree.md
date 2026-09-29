# Design Tree — Skynex Tasks panel for OpenCode TUI

## Task sidebar visibility — accepted clarification
- The task sidebar summary visibility is shared across all sessions within one project.
- It remains project-scoped and does not expose tasks from other projects.

## Stronger active-step contrast — accepted refinement
- I1: The user can see the highlighted row but requests greater intensity.
  Retain the theme-aware `theme.text.base` foreground and add native bold
  emphasis to **only** the current row (or CLI next when current is absent).
  Keep all other rows muted and unbolded. Do not hardcode white: a white literal
  could disappear in a light theme. Require a real OpenCode terminal check for
  a bold SGR attribute before claiming it works.
- I2: Keep the task title hidden, status markers, collapse, scroll, counters,
  exact session routing and stored status unchanged.

## Focused step styling — accepted refinement
- H1: Remove the **task title line** from the sidebar (for example, no
  `Mostrar todos los pasos` row). Keep the generic `Tarea` disclosure header,
  progress, complete step list and assigned-task identity in storage/RPC.
- H2: Highlight exactly the row identified by the published `current` step;
  otherwise highlight the published `next` step, as the CLI's next actionable
  step may still be pending. Use OpenCode's native strong foreground
  (`theme.text.base`, as used by the MCP heading) and mute all other rows.
  Preserve every step's actual status and marker; highlighting is not a status
  change. If no published current/next row matches, do not invent a highlight.
- H3: Keep collapsed counts, mouse behavior, step order, scroll, legacy/empty
  messages and exact session-location routing. No new request, file read,
  publication field, or configuration setting.

H1 supersedes the task-title portion of C3/L2 only. H2 supersedes the former
styling that brightened all blocked and in-progress rows indiscriminately.

## Complete session-step list — accepted refinement
- L1: Expanded view lists **every step of the assigned session task**, in CLI
  order, with `✓` done, `○` pending, `→` in progress and `!` blocked. This replaces
  C3's single current-or-next row. No project-wide task list or other sessions.
- L2: Keep the compact task title, disclosure header and unresolved/progress
  counters. Collapse hides the whole list, not the counters. Long lists remain
  reachable through scrolling rather than silently dropping rows; display-only
  shortening must not rewrite CLI titles or statuses.
- L3: Extend the published projection with `steps: [{ id, title, status }]`.
  Read these fields from `skynex task status --task <id> --json`; no instructions,
  evidence, dependencies or arbitrary bodies. Bound to the existing CLI maximum
  of 999 steps and 200 characters per step title. Validate dense arrays, unique
  identifiers, the four CLI step statuses, length equal to total and completed
  count equal to doneCount. Preserve existing validation of other fields.
- L4: New publications require the complete step list. Stored legacy snapshots
  without it remain readable with their counters and an explicit
  `Lista pendiente de actualizar` message, never an invented list or false empty
  assignment. Keep the existing session storage key; the next publication fills
  the list. An explicit empty list with total zero shows `Sin pasos`.
- L5: Preserve authoritative session-location RPC routing, read-only view,
  ownership checks, collapse state and polling cleanup. No filesystem reader,
  model call, new dependency or task mutation through clicking a row/header.

## Compact presentation — accepted refinement
- C1: Use a clickable, initially expanded `Tarea` header with a disclosure arrow,
  unresolved-step count (`total - doneCount`, including blocked steps), and
  completed/total progress. These counts refer only to the assigned session task.
- C2: Collapsing hides detail, not the header/progress. Expanding restores it;
  refreshes must not reopen a user-collapsed section. No task mutation on toggle.
- C3: Expanded detail shows a short task title and one short current-or-next step
  (current takes precedence). Truncate only display text with an ellipsis; never
  rewrite authoritative task titles. Keep native semantic colors.
- C4: Remove visible IDs, raw status, timestamps and redundant labels. Show a
  compact blocked-step count only when nonzero. Empty/loading/error states remain
  distinguishable. Removing the timestamp is a presentation decision: the data
  remains a last-published CLI projection, not a live filesystem view.
- C5: Preserve authoritative session-location RPC routing, session isolation,
  payload validation, refresh fencing and cleanup. No new dependencies, storage,
  global shortcuts, filesystem reads or provider calls.

This supersedes only the earlier expanded-detail presentation, not session-only
scope or the CLI/publication authority boundary. The user explicitly requested
shorter labels, collapsibility and a visible count of remaining work.

## Corrected acceptance — session sidebar (supersedes D1–D6 below)
- S1: Render in OpenCode `sidebar.content` for the slot's current `sessionID`, not a selectable project board or palette-opened panel.
- S2: Show only the task assigned to that exact session: id/title, status, progress, current/next step and blocked steps. No task assignment means `Sin tarea asignada`. Do not inherit another session's task.
- S3: Thalam automatically publishes the task summary after creating/resuming its CLI task and after changing a step. The CLI notebook remains authoritative; the sidebar is a last-published projection with an update timestamp, not live filesystem state.
- S4: Store the bounded projection in OpenCode plugin storage keyed by verified project/location and execution-context session ID. Publishing tools cannot accept a caller-selected session ID or root path. Sidebar RPC reads only the requested session after checking its location, with no task mutations.
- S5: No filesystem task reads, directory scans, native addon, new native dependencies, shell execution, instruction/evidence bodies, raw errors or provider calls in the sidebar plugin. Missing/corrupt state must not fall back to a project task.
- S6: Refresh the current session projection on mount/session change and at a bounded interval; clear stale data immediately, reject superseded async responses and clean up timers/subscriptions. UI is read-only.
- S7: Verify two-session isolation, persistence, empty/error/updated states, payload bounds, prototype/path-like inputs and actual OpenCode sidebar rendering. Preserve global classifier:false and validate-tests on installation, with a backup. No CLI-wide reader safety claim.

The user explicitly chose automatic assignment by Thalam. Earlier project-board and native-reader prototypes are historical, excluded from this delivery; their failed contracts cannot serve as proof of this corrected implementation.

## Historical project-board decisions (superseded)
- D1: Integrate as a global Skynex-managed OpenCode TUI plugin; task data is scoped to the active project/location.
- D2: Open from the command palette (`/skynex-tasks`), closed by default. Selecting a task changes to a detail view in the same panel; read-only, no task mutation actions.
- D3: List only valid CLI-managed tasks. Show a bounded count of legacy/unknown directories, never parse their schemas.
- D4: Refresh on open/focus and manually; while open, poll every 3–5 seconds. No changes to task state from viewing.
- D5: Reuse the shared Tasks application/domain parsing and filesystem safety; no shelling out to `skynex`, no duplicated JSON parser. UI shows title/id/status, completed/total, next step and blocked step IDs; never instruction/evidence bodies.
- D6: Tests use temporary project roots. Final integration validation uses an isolated copy of OpenCode configuration/resources and a visual manual check; no provider is needed for mechanical UI/resource checks.

## Verified integration contract
- V1: OpenCode V2 CLI-plugin documentation supports command-palette commands and a `session.panel` contribution opened via `context.ui.panel.open`; the host owns sizing/focus and the panel becomes a side panel when terminal width permits (otherwise it is full-screen). Source: <https://opencode.ai/v2/docs/build/plugins/cli>, sections “Commands and keymaps” and “Session panels” (checked 2026-09-28).
- V2: The panel callback receives reactive `name`, `sessionID`, `width`, `presentation`, and `focused` state. Plugin setup has cleanup support. The documented extension surface is sufficient for a palette-opened panel; it is not an always-visible sidebar.
- V3: Local project implementation already has a strict `FileTaskStore` that parses managed `task.json` and labels legacy/unknown entries without parsing their data. A read-only domain facade will expose summary and status projections only; it does not expose mutation methods or instruction/evidence bodies.

## Implementation constraints
- C1: This repo's existing Sky Agents UI uses local native plugin resources and registers a palette command from an `app` slot. Extend resource manifest/provenance and installer wiring following that pattern, but use documented panel API.
- C2: A session panel only renders in an active session; the palette command should explain this when no session exists, rather than silently claiming to support the home screen.
- C3: Poll only while the panel is focused/open and stop the timer on cleanup/unmount; refresh immediately on panel open and manually. Keep each read bounded and display read errors without crashing TUI.
- C4: The server plugin RPC is appropriate for filesystem reads because plugin host/client runs in OpenCode server context; it must resolve the active project location, instantiate `FileTaskStore` at that project's `.skynex/tasks`, and expose list/detail only. No mutation RPCs.

## Out of scope (explicit)
- Editing/creating/completing tasks in UI.
- Legacy schema migration or interpreting legacy artifact directories.
- Desktop IDE/web app and global config mutation in implementation tests.
- Real provider/model inference for UI rendering verification.

## Current integration basis
OpenCode V2 CLI plugin documentation exposes `sidebar.content` with `sessionID`; plugin context exposes durable `storage.get/set/remove`, session lookup and tool transforms. Verify the actual installed host behavior before claiming completion. Native-reader work is not a prerequisite for the session-storage projection.
