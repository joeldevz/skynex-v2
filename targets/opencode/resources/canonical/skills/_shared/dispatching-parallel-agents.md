---
name: Dispatching Parallel Agents
description: Use when the orchestrator needs to launch multiple sub-agents simultaneously to accelerate work without context contamination.
license: Complete terms in LICENSE.txt
---

# Dispatching Parallel Agents — Protocol

> **Principio destilado** (obra/Superpowers + Matt Pocock): subagents NEVER inherit session context. The orchestrator constructs exactly the prompt each subagent needs. Parallel dispatch is the multiplier — sequential dispatch wastes wall-clock time when there are no data dependencies.

## When to parallelize

✅ **Parallelize when**:
- Tasks modify DIFFERENT modules or files
- Tasks have NO data dependencies between them
- Tasks can be verified independently
- Token budget per subagent is bounded (smart-zone aware)

❌ **Sequential when**:
- Task B reads output produced by task A
- Tasks modify the same file (race conditions)
- One task's verification gates the next
- The orchestrator needs to inspect intermediate state

## How to construct sub-agent prompts

Each subagent gets a **clean, complete, isolated prompt**. The orchestrator NEVER pipes its full conversation history.

### Required fields per delegation

```yaml
task: <single bounded objective>
inputs:
  files: [<paths>]
  context: <relevant decisions from Neurox>
  spec_compliance: <rules from skill registry>
constraints:
  smart_zone: 100K hard cap
  retries: max 2
expected_output:
  status: success | blocked | needs-review
  artifacts: <files to be modified>
  envelope_fields: [<required fields>]
```

### Forbidden in sub-agent prompts

- Full transcript of orchestrator session
- Information from other parallel subagents (they're isolated by design)
- Vague instructions ("do whatever's needed")
- More than 1 bounded task per dispatch

## Parallel pattern: fan-out → synthesize

```
Orchestrator
    │
    ├─ Subagent A (clean prompt)  ┐
    ├─ Subagent B (clean prompt)  │  parallel
    └─ Subagent C (clean prompt)  ┘
            │
            ▼
    Orchestrator synthesizes results
    (extract: status, summary, artifacts, risks)
    (discard: tool calls, intermediate reasoning)
```

## Anti-patterns

- ❌ **Context bleeding**: passing the full orchestrator transcript to a subagent (defeats context isolation)
- ❌ **Hidden dependencies**: parallelizing tasks where B silently depends on A's output
- ❌ **Unbounded scope**: "implement the whole feature" sent as one parallel task
- ❌ **No timeout**: parallel agents without budget cap can run forever in dumb zone

## Empirical insight (obra/Superpowers, validated 5×5 trials)

**Inline-self-review ≥ subagent-review-loop** in many cases:
- Saves ~25 min/iteration vs spawning a reviewer subagent
- The implementer can self-check against an inline checklist with similar quality
- Prefer subagent reviewer ONLY when the implementer has burned >70K tokens (dumb zone)

## Synthesis rules

When parallel subagents return:
1. Extract **only**: `status`, `executive_summary`, `artifacts`, `risks`, `verification`
2. Discard intermediate tool calls and reasoning chains
3. If any subagent returned `status: blocked` → halt downstream parallelization
4. If two subagents disagree on a verdict → escalate to the user for a tiebreak. The orchestrator does NOT have an `advisor_consult` tool; do not assume one exists at the dispatch level. (Subagents that own `advisor_consult` may use it within their own scope.)
5. Save synthesis to Neurox with topic_key for future recall

## Smart-zone budget per subagent

Each parallel subagent has its own 100K cap. The orchestrator's job is to:
- Detect if a subagent returned `zone: warning` or `dumb` → re-dispatch fresh next time
- Aggregate `tokens_used` across subagents for cost tracking
- NOT pipe their context back to itself (would inflate orchestrator's own context)

## Referencias

- obra/Superpowers — RELEASE-NOTES on subagent context isolation
- Matt Pocock — smart zone awareness + DAG canban patterns
- Anthropic — Advisor Strategy (parallel dispatch with synthesis)
