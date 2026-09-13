# Strict PRD Schema

Output the final document using exactly these sections.

## 1. Executive Summary & Systems Context

- **Problem Statement:** 1-2 sentences on the pain point.
- **Proposed Solution:** 1-2 sentences on the fix.
- **Ecosystem Impact:** How this interacts with existing systems, downstream effects, and user journeys.

## 2. Multidimensional Success Metrics (KPIs)

Divide KPIs into these 4 dimensions (crucial for modern/AI software):

- **Performance:** (e.g., Task completion rate > 90%, load time < 200ms).
- **UX & Adoption:** (e.g., First Contact Resolution, Daily Active Users increase).
- **Safety & Trust:** (e.g., Hallucination rate < 1%, Bias mitigation, Data privacy compliance).
- **Cost & Efficiency:** (e.g., API token usage limits, infrastructure cost per transaction).

## 3. User Experience & Functionality

- **User Personas:** Who is this for?
- **User Stories & Estimations:** (Must be formatted as a Markdown table for issue-tracker export).
  - Columns: `ID | User Story | Acceptance Criteria | SP (Est) | Estimation Rationale`
  - Story Format: `As a [user], I want to [action] so that [benefit].`
  - SP (Est): Provide a Fibonacci estimate (1, 2, 3, 5, 8).
  - Estimation Rationale: 1-sentence technical justification for the complexity score.
- **Non-Goals:** What are we deliberately excluding from this scope?

## 4. AI & Data System Requirements (If Applicable)

- **Data Supply Chain:** Where does the data come from? Are there PII or copyright concerns?
- **Model Architecture:** Required tools, LLMs, Vector DBs, or APIs.
- **Explainability & Fallbacks:** How is the AI's decision explained to the user? What is the graceful degradation path if the AI times out or fails?

## 5. Technical Specifications & Risks

- **Integration Points:** APIs, DBs, and Auth.
- **Security & Privacy:** Access controls (RBAC) and compliance.
- **Phased Rollout:** MVP -> v1.1 -> v2.0.
- **Technical Risks:** Latency, cost, dependency failures, or ethical risks.

---

# Example: Intelligent Search System

## 1. Executive Summary

**Problem**: Users struggle to find specific documentation snippets in massive repositories.
**Solution**: An intelligent search system that provides direct answers with source citations.
**Success**:

- Reduce search time by 50%.
- Citation accuracy >= 95%.

## 2. User Stories

- **Story**: As a developer, I want to ask natural language questions so I don't have to guess keywords.
- **AC**:
  - Supports multi-turn clarification.
  - Returns code blocks with "Copy" button.

## 3. AI System Architecture

- **Tools Required**: `codesearch`, `grep`, `webfetch`.

## 4. Evaluation

- **Benchmark**: Test with 50 common developer questions.
- **Pass Rate**: 90% must match expected citations.
