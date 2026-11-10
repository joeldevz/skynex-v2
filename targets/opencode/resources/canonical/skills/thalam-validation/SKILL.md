---
name: thalam-validation
description: Thalam's acceptance procedure, including frozen candidate rounds bound to content manifests, the dual independent security review for security-sensitive diffs, and the error and warning acceptance rules for verifier, security, PR, skill and test reviews. Use when freezing a candidate, scheduling the final validators or security judges, or accepting or rejecting any reviewer verdict; not during direct LOW work that stays green.
---

# Thalam validation

Load this skill before freezing a candidate, before scheduling the final validators
or security judges, and before accepting or rejecting any reviewer verdict. Follow it
as written; do not paraphrase its rules from memory. Direct LOW work that stays green
does not need it.

## FROZEN ACCEPTANCE MATRIX

Bind each candidate round to actual content: tracked and adopted untracked file
digests, basis, acceptance matrix, and applicable policy. Do not stage unrelated
work to manufacture a tree OID; when no actual Git object exists, use CandidateOID
null with a reason and an explicit content manifest, never call its digest an OID.
Any content, basis, acceptance, or policy drift ends the round. Retain old results
as historical evidence only, record the diff and new manifest, and rerun required
 final validators on the new candidate. Two error-free security verdicts must belong to
that same new round; never combine rounds. Slice RED evidence may carry forward
only after confirming unchanged test intent/content and applicable pre-implementation
basis; it is not final-candidate green evidence.

Before RED, freeze the smallest requirement-to-test matrix for the request. Reviewers cannot expand the frozen acceptance matrix; every blocker cites one frozen clause and a concrete false-positive path. Keep tests minimal and parameterized.

## DUAL SECURITY REVIEW

Security-sensitive criteria include prompt, agent, tools, permissions, MCP, authentication, secrets, policy, config, external, and destructive changes. Unless disabled by the task's `reviews.security` switch (TASK REVIEW SWITCHES in the Thalam prompt), security-sensitive diffs always launch two independent security judges (blind and independent) on the same frozen candidate round. Both judges must complete required coverage with zero errors: CLEAN or WARNINGS is acceptable for each judge in that same round. An ERRORS verdict blocks; INCONCLUSIVE or missing required evidence cannot be accepted as warnings. Security remediation follows the 2-round ordinary cap and specific security exception in the `thalam-recovery` skill's RETRY BUDGET. Each ordinary round is one bounded fix followed by both judges re-reviewing the same target files and changed candidate. Only blocking ERRORS justify fixes; a complete-coverage WARNINGS outcome does not start another round. Each validator runs at most once per frozen candidate/round; a changed candidate requires new applicable validation.

## REVIEW ACCEPTANCE — ERRORS AND WARNINGS

Require reviewers to classify each finding as error or warning, with counts matching
the findings and a separate execution status. Error means an evidence-backed defect,
vulnerability, or violation of an applicable mandatory acceptance/policy boundary.
It cites a location/check, the violated requirement, a concrete failure path or
observed check outcome, and impact. A live reproduction is not necessary when static
evidence establishes the defect. Warning means advisory improvement, optional
hardening, style or speculative risk without a demonstrated mandatory violation.

With complete required coverage and valid candidate-bound evidence:
- Security and PR: CLEAN or WARNINGS => continue; ERRORS => block.
- Verifier: PASS or PASS_WITH_WARNINGS => continue; FAIL => block.
- Skill-validator: COMPLIANT, DEVIATIONS with zero errors, or justified
  NOT_APPLICABLE => continue; VIOLATIONS with errors => block.
- Test-reviewer: review_gate pass or pass_with_warnings => continue; fail => block.

Warnings alone do not consume retry budgets, trigger a human gate, force fixes or
another review, or prevent final completion. Report them once in the final summary
as non-blocking follow-ups; do not silently expand implementation scope to fix them.
State the result as completed with warnings when appropriate, not falsely CLEAN.

Missing required checks/coverage, candidate drift, invalid identity, live child
processes, and missing authorization remain blocked/inconclusive conditions. They
are neither warnings nor proof of a code defect. Contradictory counts/verdicts require
bounded clarification; no reviewer may obtain acceptance by relabeling a real error.
The parent assesses evidence against the frozen scope; it must not promote a warning
because of severity wording or demote a demonstrated error merely to finish. Judge
disagreement alone is not a veto: unresolved evidence of a real high-risk error is.
