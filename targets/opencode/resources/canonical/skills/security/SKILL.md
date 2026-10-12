---
name: security
description: Use when the orchestrator reaches the security validation phase, or the user requests a security review (English or Spanish).
---

# Security Review — Dual-Judge Protocol

> **SUBAGENT-STOP gate**: if you are running as a subagent invoked by another subagent, STOP. Return `status: blocked` with reason `nested-subagent-loop-detected`. This skill must be invoked by the orchestrator or top-level agent only.

The orchestrator NEVER reviews security itself. It launches two independent `security` judge
sub-agents in parallel and synthesizes their findings. Remediation is limited to blocking
errors and follows the originating request's finite shared retry budget; warning-only
outcomes do not start a fix loop.

## Anti-rationalization table (judges must reject these excuses)

| Excuse                                          | Reality                                          |
|-------------------------------------------------|--------------------------------------------------|
| "It's just a demo, security can wait"           | Demos leak. Flag it.                             |
| "The framework handles it"                      | Verify the framework actually handles THIS case. |
| "It's behind auth, no risk"                     | Auth can be bypassed. Defense in depth.          |
| "I'll add validation later"                     | Now or `status: blocked`.                        |
| "Tests don't cover this so it's not critical"   | Lack of tests is a finding, not an excuse.       |

## Phase 1 — Launch both judges in parallel

Launch two Task calls simultaneously to the `security` agent with identical inputs:
- `target_files`: all files modified during the plan
- `project_root`: working directory
- Inject `## Project Standards (auto-resolved)` from skill registry if available

Neither judge knows about the other. They work independently (blind review).

## Phase 2 — Synthesize findings

After BOTH judges return, build the verdict table:

| Finding | Judge A | Judge B | Severity | Status |
|---------|---------|---------|----------|--------|
| JWT secret too short in auth.ts:12 | ✅ | ✅ | CRITICAL | **Confirmed** |
| Missing rate limit on /login | ✅ | ❌ | HIGH | Suspect A only |
| Stack trace exposed in error handler | ❌ | ✅ | HIGH | Suspect B only |

Classification:
- **Confirmed** → found by BOTH judges → high confidence; assess against Thalam's
  blocking-error criteria before remediation
- **Suspect A / B** → found by ONE judge → triage by evidence against the same
  criteria; severity alone does not justify a fix
- **Contradiction** → judges DISAGREE on same item → flag for manual review

Apply Thalam's security acceptance criteria to the synthesized verdict: only an
evidence-backed ERRORS verdict blocks and justifies a fix. Severity or confirmation
labels alone do not turn warning-only findings into remediation.

## Phase 3 — Fix blocking errors

For a blocking ERRORS verdict, delegate a minimal fix to the `coder` agent with ONLY
the blocking findings list. Do not fix warning-only findings as a reason to continue
iterating.
The fix agent must NOT refactor beyond what is needed to fix the issue.

## Phase 4 — Re-judge (mandatory after any fix)

Re-launch BOTH judges in parallel on the same target files.
Do NOT skip re-judgment — fixes can introduce new vulnerabilities.

## Iteration limit and request-scoped budget

Counts bind to the originating request, not to WorkflowID or AttemptID; new
identifiers never reset them. The category caps are distinct:

- The initial paired assessment is not a remediation round.
- Security remediation allows at most 2 ordinary rounds per request. One round is
  one bounded fix followed by both judges re-reviewing the same target files and
  changed candidate.
- One human exception is shared across ordinary RED contracts, autonomous diagnosis,
  and security remediation. When the security cap is reached and another bounded
  correction is needed, only the orchestrator may ask, at most once, if that shared
  exception remains unused. Check the originating request's shared budget before
  asking; do not ask again if another category already used it.

YES permits exactly one additional bounded fix and its paired re-review; it does not
reset any count or permit another question. A decline, an already-used exception, or
blocking errors that remain after that re-review means stop and return
**SECURITY: ESCALATED ⚠️ / blocked_human**. Only blocking ERRORS justify a fix. With
complete required coverage, CLEAN or WARNINGS is accepted; warning-only outcomes do
not trigger remediation, another review, a human question, or consume the exception.

## Terminal states

- **SECURITY: APPROVED ✅** — both judges complete required coverage in the same
  candidate round with CLEAN or WARNINGS and no ERRORS. Report warning outcomes as
  **SECURITY: APPROVED WITH WARNINGS ⚠️**, not as CLEAN.
- **SECURITY: ESCALATED ⚠️ / blocked_human** — blocking errors remain when ordinary
  remediation is exhausted, the shared exception is unavailable/declined, or errors
  remain after its one permitted correction and re-review.

## Output format

```markdown
## Security Review — {target}

### Round {N} — Verdict

| Finding | Judge A | Judge B | Severity | Status |
|---------|---------|---------|----------|--------|
| {description} | ✅/❌ | ✅/❌ | CRITICAL/HIGH/MEDIUM/LOW | Confirmed/Suspect A/Suspect B |

**Confirmed**: {N} issues
**Suspect**: {N} issues
**Contradictions**: {N}

### Fixes Applied (Round {N})
- `file:line` — {what was fixed}

### Round {N+1} — Re-judgment
- Judge A: PASS ✅ / FAIL ❌ ({N} issues)
- Judge B: PASS ✅ / FAIL ❌ ({N} issues)

---
### SECURITY: APPROVED ✅ / APPROVED WITH WARNINGS ⚠️
Both judges completed required coverage in the same candidate round with CLEAN or
WARNINGS and no ERRORS. Report any warnings; do not label them CLEAN.
```

## Blocking rules

1. NEVER declare SECURITY: APPROVED until BOTH judges complete required coverage with CLEAN or WARNINGS and no ERRORS in the same round
2. NEVER run git commit or git push after fixes until re-judgment completes
3. NEVER skip re-judgment after a fix — even small fixes must be re-judged
4. Never exceed the request-scoped category caps or ask more than once for the
   shared human exception. Warning-only outcomes never start a fix loop; remaining
   blocking errors after the permitted correction are terminal.

## Skill resolution feedback

Check `**Skill Resolution**` in each judge response:
- `injected` → compact rules were received correctly ✅
- `fallback-registry` or `none` → skill cache lost (compaction). Re-read registry and inject in all future delegations.

## Neurox Memory (obligatorio)

Esta skill DEBE usar Neurox para memoria persistente:
- **Al iniciar**: `neurox_recall(query="security vulnerabilities {module}")` — buscar hallazgos previos
- **Cross-namespace**: `neurox_recall(query="security patterns")` sin namespace — inteligencia de otros proyectos
- **Al encontrar vulnerabilidades**: `neurox_save(observation_type="gotcha", ...)` inmediatamente
- **Al resolver**: `neurox_save(observation_type="bugfix", ...)` con causa raíz y fix aplicado
- Si no tienes acceso a Neurox tools, documenta en tu output qué información guardar.
