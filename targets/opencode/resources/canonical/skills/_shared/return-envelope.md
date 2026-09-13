# Return Envelope — Contrato estándar de retorno

Todo sub-agente DEBE terminar su respuesta con este bloque estructurado. El orchestrator lo usa para sintetizar resultados y detectar fallos silenciosos.

## Campos obligatorios

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `status` | `success \| partial \| blocked` | Resultado general de la tarea |
| `executive_summary` | string (1-3 frases) | Qué se hizo y resultado clave |
| `artifacts` | lista | Archivos creados/modificados, o keys de Neurox guardados |
| `next_recommended` | string | Siguiente acción recomendada, o `"none"` |
| `risks` | lista | Riesgos encontrados, o `"None"` |
| `skill_resolution` | `injected \| fallback-registry \| none` | Cómo se cargaron los skills |

## Formato de retorno

Usar siempre al final de la respuesta:

```
---
**Status**: success | partial | blocked
**Summary**: [1-3 frases de qué se hizo]
**Artifacts**: [lista de archivos o keys de Neurox]
**Next**: [acción recomendada o "none"]
**Risks**: [lista o "None"]
**Skill Resolution**: injected | fallback-registry | none
```

## Reglas

- `partial`: el agente completó parte del trabajo pero encontró un bloqueador menor. Describe qué falta en `risks`.
- `blocked`: el agente no puede continuar sin intervención. El orchestrator debe pausar y reportar al usuario.
- `skill_resolution: injected`: el orchestrator inyectó compact rules en el prompt. Es el camino ideal.
- `skill_resolution: fallback-registry`: el agente no recibió rules inyectadas y tuvo que buscarlas en `.skynex/skill-registry.md` o Neurox.
- `skill_resolution: none`: no se encontraron skills. El agente trabajó sin project standards — registrar como riesgo.

## Anti-compaction

Si el orchestrator ve `skill_resolution: fallback-registry` o `none` en un retorno, DEBE:
1. Releer el skill registry inmediatamente
2. Inyectar compact rules en todas las delegaciones subsiguientes
3. Loguear: "⚠️ Skill cache miss — registry recargado"
