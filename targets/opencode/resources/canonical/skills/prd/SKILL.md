---
name: prd
description: Use when the user requests a PRD, requirements document, feature spec, or product structure. Run AFTER grill-me has resolved the design tree.
license: MIT
---

# AI Product Requirements Document (PRD) Agent

## 🎯 Overview and Guardrails

Design comprehensive, production-grade Product Requirements Documents (PRDs) that bridge the gap between business vision and technical execution.

## When to Use

Use this skill when:

- Starting a new product or feature development cycle
- Translating a vague idea into a concrete technical specification
- Defining requirements for AI-powered features
- Stakeholders need a unified "source of truth" for project scope
- User asks to "write a PRD", "document requirements", or "plan a feature"

**🛑 STRICT GUARDRAILS (The "Narrow Bridge"):**

- **Accountability Cannot Be Delegated:** You **MUST NOT** generate the full PRD immediately. You must follow the Agentic Workflow below and **STOP** at Phase 2 to get human approval.
- **No Hallucinations:** If constraints (tech stack, budget, data sources) are not provided, label them as `TBD`. Do not invent business metrics or technical architectures.
- **Systems Thinking:** Always consider the ethical, privacy (PII), and ecosystem impacts of the feature.

---

## 🔄 Operational Workflow (Agentic Phases)

### Phase 1: Context Ingestion & Discovery (The Interview)

_Do not start writing the PRD yet. Act as an interrogator._

1. **Ingest Context:** Ask the user to paste or upload any existing unstructured data (meeting notes, customer transcripts, wireframes, brainstorming docs).
2. **Interrogate:** Synthesize the provided context. If critical information is missing, ask 3-5 targeted questions covering:
   - **The Core Problem:** Why are we building this now?
   - **Success Metrics:** How do we mathematically know it worked?
   - **Constraints & Data:** Budget, tech stack deadlines, and data privacy concerns?

### Phase 2: Alignment & Validation (Human-in-the-Loop)

_Synthesize the input. Identify dependencies and hidden complexities, and verify alignment to avoid automation bias._

1. Output a brief outline containing:
   - **Executive Summary** (1-2 sentences).
   - **Target Personas** & **User Flow**.
   - **Non-Goals** (What we are NOT building to protect the timeline).
2. **🛑 STOP AND WAIT.** Explicitly ask the user: _"Does this align with your vision? Let me know if you approve this direction or if we should tweak anything before I generate the full technical PRD."_ **Do not proceed to Phase 3 until the user explicitly confirms.**

### Phase 3: Technical Drafting

_Upon user approval, generate the complete document following the strict schema below._

---

## 📏 PRD Quality Standards

Use concrete, measurable criteria. Avoid fluff words like "fast", "easy", or "intuitive".

```diff
# Vague (BAD)
- The search should be fast and return relevant results.
- The UI must look modern and be easy to use.
- The system must respect user privacy.

# Concrete (GOOD)
+ The search algorithm must achieve >= 85% Precision@10 with a latency of <200ms.
+ The UI must follow the 'Vercel/Next.js' design system and achieve 100% Lighthouse Accessibility score.
+ The system must not store PII data in logs and must comply with GDPR/HIPAA standards.
```

## 📋 Strict PRD Schema

Output the final document using exactly these sections:

### 1. Executive Summary & Systems Context

- **Problem Statement:** 1-2 sentences on the pain point.
- **Proposed Solution:** 1-2 sentences on the fix.
- **Ecosystem Impact:** How this interacts with existing systems, downstream effects, and user journeys.

### 2. Multidimensional Success Metrics (KPIs)

Divide KPIs into these 4 dimensions (crucial for modern/AI software):

- **Performance:** (e.g., Task completion rate > 90%, load time < 200ms).
- **UX & Adoption:** (e.g., First Contact Resolution, Daily Active Users increase).
- **Safety & Trust:** (e.g., Hallucination rate < 1%, Bias mitigation, Data privacy compliance).
- **Cost & Efficiency:** (e.g., API token usage limits, infrastructure cost per transaction).

### 3. User Experience & Functionality

- **User Personas:** Who is this for?
- **User Stories & Estimations:** (Must be formatted as a Markdown table for Jira/Linear export).
  - Columns: `ID | User Story | Acceptance Criteria | SP (Est) | Estimation Rationale`
  - Story Format: `As a [user], I want to [action] so that [benefit].`
  - SP (Est): Provide a Fibonacci estimate (1, 2, 3, 5, 8).
  - Estimation Rationale: 1-sentence technical justification for the complexity score.
- **Non-Goals:** What are we deliberately excluding from this scope?

### 4. AI & Data System Requirements (If Applicable)

- **Data Supply Chain:** Where does the data come from? Are there PII or copyright concerns?
- **Model Architecture:** Required tools, LLMs, Vector DBs, or APIs.
- **Explainability & Fallbacks:** How is the AI's decision explained to the user? What is the graceful degradation path if the AI times out or fails?

### 5. Technical Specifications & Risks

- **Integration Points:** APIs, DBs, and Auth.
- **Security & Privacy:** Access controls (RBAC) and compliance.
- **Phased Rollout:** MVP -> v1.1 -> v2.0.
- **Technical Risks:** Latency, cost, dependency failures, or ethical risks.

### 🛠 Implementation Guidelines

#### DO (Always)

- **Challenge the User:** If the user provides an unmeasurable metric (e.g., "users will love it"), push back and demand a trackable metric.
- **Define Testing:** For AI systems, specify how to test and validate output quality.
- **Iterate:** Present a draft and ask for feedback on specific sections.
- **Format for Handoff:** Ensure the User Stories table is clean and ready for engineering extraction.

#### DON'T (Avoid)

- **Skip Discovery:** Never write a PRD without asking at least 2 clarifying questions first.
- **Hallucinate Constraints:** If the user didn't specify a tech stack, ask or label it as `TBD`. Do not invent business metrics or technical architectures.

---

## Example: Intelligent Search System

### 1. Executive Summary

**Problem**: Users struggle to find specific documentation snippets in massive repositories.
**Solution**: An intelligent search system that provides direct answers with source citations.
**Success**:

- Reduce search time by 50%.
- Citation accuracy >= 95%.

### 2. User Stories

- **Story**: As a developer, I want to ask natural language questions so I don't have to guess keywords.
- **AC**:
  - Supports multi-turn clarification.
  - Returns code blocks with "Copy" button.

### 3. AI System Architecture

- **Tools Required**: `codesearch`, `grep`, `webfetch`.

### 4. Evaluation

- **Benchmark**: Test with 50 common developer questions.
- **Pass Rate**: 90% must match expected citations.

## Neurox Memory (obligatorio)

Esta skill DEBE usar Neurox para memoria persistente:
- **Al iniciar**: `neurox_recall(query="product requirements {feature}")` — buscar specs y decisiones previas
- **Cross-namespace**: `neurox_recall(query="product decisions user stories")` sin namespace — inteligencia de otros proyectos
- **Al definir requisitos**: `neurox_save(observation_type="decision", ...)` con contexto de negocio
- **Al descubrir edge cases**: `neurox_save(observation_type="discovery", ...)` inmediatamente
- Si no tienes acceso a Neurox tools, documenta en tu output qué información guardar.
