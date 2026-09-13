---
name: security
description: Use when the orchestrator reaches the security validation phase, or the user requests a security review (English or Spanish).
---

# Security Review — Dual-Judge Protocol

> **SUBAGENT-STOP gate**: if you are running as a subagent invoked by another subagent, STOP. Return `status: blocked` with reason `nested-subagent-loop-detected`. This skill must be invoked by the orchestrator or top-level agent only.

The orchestrator NEVER reviews security itself. It launches two independent `security` judge
sub-agents in parallel, synthesizes their findings, and iterates until the code is clean.

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
- **Confirmed** → found by BOTH judges → high confidence → fix immediately
- **Suspect A / B** → found by ONE judge → triage: include in fix if CRITICAL or HIGH, escalate to user if MEDIUM/LOW
- **Contradiction** → judges DISAGREE on same item → flag for manual review

## Phase 3 — Fix confirmed issues

Delegate a fix to the `coder` agent with ONLY the confirmed findings list.
The fix agent must NOT refactor beyond what is needed to fix the issue.

## Phase 4 — Re-judge (mandatory after any fix)

Re-launch BOTH judges in parallel on the same target files.
Do NOT skip re-judgment — fixes can introduce new vulnerabilities.

## Iteration limit

- After 2 fix iterations, if issues remain: ASK the user "¿Querés continuar iterando? / Should I continue iterating?"
- If user says YES → continue fix+judge cycle
- If user says NO → **SECURITY: ESCALATED ⚠️** — report remaining issues, require manual review before merge

## Terminal states

- **SECURITY: APPROVED ✅** — both judges return CLEAN in the same round
- **SECURITY: ESCALATED ⚠️** — user chose to stop with remaining issues

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
### SECURITY: APPROVED ✅
Both judges pass clean.
```

## Blocking rules

1. NEVER declare SECURITY: APPROVED until BOTH judges return CLEAN in the same round
2. NEVER run git commit or git push after fixes until re-judgment completes
3. NEVER skip re-judgment after a fix — even small fixes must be re-judged
4. After 2 iterations, ALWAYS ask the user before continuing — do not iterate indefinitely without consent

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
