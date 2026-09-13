---
name: grill-me
description: Use when the user requests a non-trivial feature, change, or design decision before writing a PRD or plan. Do NOT use for trivial bug fixes, typos, or tasks crystal-clear from context.
license: Complete terms in LICENSE.txt
---

# Grill Me — Adversarial alignment before planning

> **Principio destilado** (Matt Pocock + Frederick P. Brooks): the goal is NOT to produce a plan fast. The goal is to reach a **shared design concept** with your human partner. The conversation IS the asset.

## Protocol

Interview your human partner relentlessly to reach shared understanding. Walk down each branch of the design tree, resolving dependencies one by one. For each question, provide your **recommended answer** and let the user agree, refine, or correct. Ask **ONE question at a time**. Skip questions where Neurox or context already provides clear answers. Stop when the design tree is fully resolved or the user explicitly says "just do it".

## Output

Write `design-tree.md` (or update if exists) at the repo root or `docs/specs/<feature>/design-tree.md`:

```markdown
# Design Tree — <feature>

## Resolved decisions
- D1: <decision> — <rationale>
- D2: <decision> — <rationale>

## Open assumptions (validate before PRD)
- A1: <assumption> — <impact if wrong>

## Out of scope (explicit)
- <thing not addressed>

## Ready for PRD
✅ yes / ⚠️ pending: <list>
```

## Rules

1. **One question at a time**. Never dump a list.
2. **Always provide a recommended answer**. The user can agree, modify, or override — but you take the cognitive load of suggesting first.
3. **Skip the obvious**. If Neurox already has the answer, surface it instead of asking.
4. **No premature PRD**. Do not generate a PRD inside this skill — that's the next step (PRD skill).
5. **No premature code**. Do not write code in this skill, even pseudocode.
6. **Stop when ready**. The user can say "just do it" or "ya, escribe el PRD" and you exit cleanly.

## When NOT to use this skill

- Trivial bugfixes (typo, null check, rename)
- Tasks where the user has already given crystal-clear specs
- Mechanical changes (formatting, comments)
- When the user explicitly says "skip grilling"

## Smart-zone awareness

Grilling sessions can run 30-100 questions. If your context approaches 80K tokens, hand off to a fresh `grill-me` invocation passing the current `design-tree.md` as input.

## Cultural rules

Address the user as **your human partner**, not "the user". Avoid:
- "You're absolutely right!" (sycophancy)
- "Great question!" (filler)
- Apologies for the workflow itself

## Referencias

- Matt Pocock workshop 2026 (grilling > planning)
- Frederick P. Brooks — *The Design of Design* (shared design concept)
- obra/Superpowers — Description Trap rule, "your human partner" terminology
