---
name: Smart Zone Budget
description: Use when an agent needs to manage its context window to avoid degraded reasoning. Mandatory awareness for all sub-agents.
license: Complete terms in LICENSE.txt
---

# Smart Zone Budget Protocol

> **Principio destilado** (Matt Pocock + Chroma research 2025): la atención de los LLMs degrada cuadráticamente con el contexto. El cap real efectivo es ~100K tokens, no el nominal de 200K/1M.

## Hard cap: 100K tokens

Por encima de 100K → el modelo entra en **dumb zone**: decisiones tontas, recall fallido, cheating tests, instrucciones olvidadas.

| Threshold | Estado | Acción del agente |
|-----------|--------|-------------------|
| < 80K | `smart` | Operar normal |
| 80K – 100K | `warning` | Planear punto de corte limpio; reportar `zone:warning` en return envelope |
| > 100K | `dumb` | OBLIGATORIO elegir 1 de las 3 estrategias abajo |

## Tres estrategias al alcanzar el cap

### 1. `/clear` (preferido — Memento style)

**Cuándo**: la tarea actual está completa o se puede cerrar limpia.
**Qué hace**: reset total, vuelve al system prompt. Los artefactos (PLAN.md, PRD.md, Neurox) son la memoria persistente.
**Por qué es preferida**: estado predecible, idéntico cada vez, vuelve a smart zone garantizado.

### 2. Surgical compaction

**Cuándo**: la tarea está viva pero el context está lleno de exploración inútil.
**Qué hace**: `Esc Esc` + "summarize from here" — preserva decisiones recientes, descarta exploración temprana.
**Por qué es tercera vía**: middle ground entre `/clear` radical y `/compact` full.

### 3. Return envelope + `/clear` desde orchestrator

**Cuándo**: la tarea está bloqueada o requiere delegación nueva.
**Qué hace**: el sub-agente devuelve resultado al orchestrator (campo `zone:warning|dumb` + `tokens_used`); el orchestrator hace `/clear` y arranca fresco con el siguiente delegado.
**Por qué**: aprovecha la arquitectura de sub-agentes con context aislado.

## Anti-patrones prohibidos

- ❌ `/compact` full sin filtrar → deja sedimento que corrompe loops futuros
- ❌ Ignorar el cap y seguir → cheating tests, decisiones tontas, recall fallido
- ❌ Empezar tarea nueva sin `/clear` → mezcla contextos
- ❌ Heredar context completo a un sub-agente → propaga la dumb zone

## Integración con return envelope

Todo agente debe reportar al final de su sesión:

```yaml
zone: smart | warning | dumb
tokens_used: <número>
strategy_recommended: clear | surgical-compaction | continue
```

El orchestrator usa estos campos para decidir si arranca fresco al delegar la siguiente tarea.

## Referencias

- Matt Pocock workshop 2026 (smart zone vs dumb zone)
- Chroma research — context rot benchmarks empíricos
- Anthropic engineering blog — long context degradation
