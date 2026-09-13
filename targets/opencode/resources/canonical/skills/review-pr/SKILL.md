---
name: review-pr
description: Use when your human partner asks for a deep PR or diff review, a code review, or to evaluate changes before merge.
---

# Deep PR Review — 4R+1 Framework

Orchestrate a thorough, parallel, evidence-based review of a PR or diff using five independent dimension judges, then synthesize one prioritized verdict.

## Phase 0 — Readiness Gate (is the PR reviewable?)

Spend no judge until the PR has what's needed. Garbage in → garbage out.

Resolve the diff first: PR number/URL via `gh`, branch vs base, commit range, or staged/working `git diff`. Then resolve the intent source (PR description, ticket, SPEC/PLAN.md, or commit messages).

Checklist:
- [ ] Non-empty diff and the base resolves. (empty/unresolvable → **blocked**)
- [ ] Intent source exists. (none → **blocked**: R0 cannot verify intent)
- [ ] Behavior change ships tests, or an explicit reason there are none. (missing → flag, not block)
- [ ] Scope is focused, not several unrelated changes mixed. (mixed → flag)
- [ ] Size is sane. Read `workflow.review_budget` from `.skynex/project-config.yaml` if present (default: 400). Warn if lines changed exceed the budget; strong-warn if they exceed 2× the budget. (still review; reliability of the review degrades at scale)

Hard blocker → STOP. Report exactly what's missing to make the PR reviewable. Do not fan out.

## Phase 1 — Parallel fan-out (5 judges, isolated context)

Read `.skynex/skill-registry.md` and `.skynex/review-rules.md` if present; pass both to every judge as Project Standards + `custom_rules`. A violation of a project rule is always a finding.

Dispatch FIVE `pr-reviewer` sub-agents IN PARALLEL, one per dimension, each with `dimension`, `target_files`, `diff`, `intent_source`, and the standards. Isolated context = independent analysis (no cross-contamination).

| Dim | Lens |
|-----|------|
| R0 | Correctness / Intent — does it do what was asked? logic bugs |
| R1 | Risk — security, breaking changes, sensitive zones |
| R2 | Readability — maintainability + over-engineering (thermo-nuclear + ponytail ladder) |
| R3 | Reliability — real tests, edge cases, error handling, timeouts |
| R4 | Resilience — retries, degradation, observability, cascades |

If a judge returns `status: blocked`, proceed with the remaining judges. In Phase 2 synthesis, note the skipped dimension and its reason explicitly in the report header.

## Phase 2 — Synthesis

1. Merge findings; de-duplicate (same file:line from two judges → keep the strictest).
2. Group by severity: **Blocking → Should-fix → Nice-to-have**.
3. Contradictions between judges → present both and escalate to your human partner. No auto-tiebreak.
4. Build **Verified** from every judge's verified checks — tell the human what was already covered.
5. Collect `rule_suggestions` → propose bullets for `.skynex/review-rules.md`. The human approves; never auto-write rules.
6. Compute the merge signal:
   - 🔴 NO MERGE — any Blocking finding present
   - 🟡 MERGE CON OJO — 0 Blocking AND (Should-fix ≥ 3 OR R1 flagged a sensitive zone: auth, payments, PII, crypto, tenant isolation)
   - 🟢 MERGE — 0 Blocking, Should-fix < 3, no sensitive zones flagged
   - Include a one-line reason: e.g. "🟡 MERGE CON OJO — 4 should-fix items" or "🟢 MERGE — clean across all 5 dimensions"

## Output report

```
# PR Review — <scope>
Verdict: APPROVE | FIX REQUIRED | ESCALATE
Merge signal: 🟢 MERGE | 🟡 MERGE CON OJO (<reason>) | 🔴 NO MERGE
Readiness: ok | degraded (<gaps>)

## Blocking (must fix)
- [R?] file:line — problem → fix

## Should-fix
- [R?] file:line — problem → fix

## Nice-to-have
- [R?] ...

## Verified (already checked, spend your attention elsewhere)
- ...

## Contradictions (need a human call)
- ...

## Suggested rules for .skynex/review-rules.md (approve to add)
- ...

R2 simplification: net: -<N> lines possible
```

## Scale to risk

- 10-line config/docs → run R0 + R1 only, quick pass.
- Feature / logic change → all 5 judges.
- 1000+ line refactor → all 5 + call out decomposition under R2.

## Phase 3 — Post to GitHub (PR input only; runs ONCE, by the orchestrator, after synthesis)

Skip entirely if the input was a branch, commit range, or plain `git diff` (no PR). The judges are read-only and never post — the orchestrator does all of Phase 3 once, after Phase 2.

1. Human gate (mandatory, before posting anything): show the verdict — `PR #{pr}: Verdict={APPROVE|FIX REQUIRED|ESCALATE}. Blocking B · Should-fix S · Nice-to-have N. Post to GitHub? (yes / skip)`. If skip → output the report locally only and stop.

2. Detect: repo = `gh repo view --json nameWithOwner -q .nameWithOwner`; head = `gh pr view {pr} --json headRefOid -q .headRefOid`.

3. Post ONE summary comment: `gh pr comment {pr} --body "<full verdict report>"`. End with `*Reviewed by skynex /review-pr · 5 judges (R0–R4) · claude-sonnet-4-6*`. If this command fails, print the full report to stdout (and optionally save to `.skynex/review-{pr}.md`) then abort Phase 3 (do not proceed to inline comments or review submit).

4. Post inline comments — one call per finding that has a `file:line` (this is the ONLY repeating step). For safe JSON body handling, escape and pass via temp file to avoid shell interpolation issues: `printf '{"body":"%s","commit_id":"%s","path":"%s","line":%d,"side":"RIGHT"}' "$(printf '%s\n' "[R?·Dim] <problem> → <fix>" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g; $ s/\\n$//')" "{head}" "{file}" {n} > /tmp/comment.json && gh api --method POST /repos/{owner}/{repo}/pulls/{pr}/comments --input /tmp/comment.json`. Best-effort: if a call errors (422/404 — file not in diff, stale line), skip it and continue; never abort Phase 3 for one failed comment.

5. Submit EXACTLY ONE review (never one per judge — a single command, no loop): `gh pr review {pr}` with `--request-changes` if any Blocking, else `--comment` if only Should-fix/Nice-to-have, else `--approve` if clean. Body = the one-line verdict. If `--request-changes` fails (e.g. 422 self-authored PR), retry once with `--comment` and note the fallback in the summary.

## Rules

- Review-only: never modify application files. Suggested rules are proposals, not auto-writes.
- Never approve on "it works" alone — correctness AND structure both gate.
- Every finding cites file:line. Drop vague claims.
