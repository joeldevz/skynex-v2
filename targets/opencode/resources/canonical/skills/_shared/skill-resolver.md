# Skill Resolver — Protocolo de inyección de skills

Todo agente que **delega trabajo a sub-agentes** DEBE seguir este protocolo para resolver e inyectar skills relevantes. Aplica al orchestrator y a cualquier agente que lance sub-agentes.

## Por qué existe

Los sub-agentes nacen sin contexto sobre qué skills existen. Sin inyección de skills, el coder no seguirá los patrones del proyecto, el security-judge no conocerá las reglas de seguridad del stack, y el test-reviewer no sabrá qué convenciones de tests aplican.

## Cuándo aplicar

Antes de CADA lanzamiento de sub-agente que involucre leer, escribir, o revisar código. Omitir solo para delegaciones puramente mecánicas (ej: "corré este comando").

## El protocolo (4 pasos)

### Paso 1: Obtener el Skill Registry (una vez por sesión)

El registry contiene una sección **Compact Rules** con reglas pre-digeridas por skill (5-15 líneas cada una). Esto es lo que se inyecta — no paths de SKILL.md.

Orden de resolución:
1. ¿Ya está cacheado de antes en esta sesión? → usar cache
2. `neurox_recall(query: "skill-registry", namespace: "{project}")` → si encontrado, leer contenido completo
3. Fallback: leer `.skynex/skill-registry.md` desde la raíz del proyecto si existe
4. ¿No hay registry? → continuar sin skills y advertir: "⚠️ No skill registry found — sub-agentes trabajarán sin project standards. Corré `/skills:scan` para generarlo."

### Paso 2: Matching de skills relevantes

Matchear por DOS dimensiones:

**A. Contexto de código** — ¿qué archivos tocará el sub-agente?
- `.tsx`, `.jsx` → skills de React
- `.ts` → skills de TypeScript
- `*.spec.ts`, `*.test.ts` → skills de testing
- `src/contexts/*/` → skills de NestJS/DDD
- `.go` → skills de Go

**B. Contexto de tarea** — ¿qué acción realizará?
| Acción del sub-agente | Matchear skills con triggers que mencionen... |
|-----------------------|----------------------------------------------|
| Escribir/revisar código | el framework/lenguaje específico |
| Crear PR | "PR", "pull request" |
| Escribir tests | "test", "vitest", "jest", "go test" |
| Revisar seguridad | "security", "auth", "JWT" |
| Validar patterns | "DDD", "CQRS", "conventions" |

### Paso 3: Inyectar en el prompt del sub-agente

Desde la sección **Compact Rules** del registry, copiar los bloques matching directamente en el prompt del sub-agente:

```
## Project Standards (auto-resolved)

{pegar bloques de compact rules de cada skill relevante}
```

Esto va ANTES de las instrucciones específicas de la tarea.

**Regla clave**: inyectar el TEXTO de compact rules, no paths. El sub-agente NO debe leer SKILL.md directamente — las reglas llegan pre-digeridas en su prompt.

### Paso 4: Incluir convenciones del proyecto

Si el registry tiene una sección **Project Conventions**, y el sub-agente trabajará sobre código del proyecto, agregar:

```
## Project Conventions
Leer estos archivos para patterns específicos del proyecto:
- {path1} — {descripción}
- {path2} — {descripción}
```

## Token budget

Las compact rules agregan ~50-150 tokens por skill al prompt del sub-agente. Para 3-4 skills, son ~400-600 tokens — despreciable comparado con el código que el sub-agente va a leer.

Si matchean más de **5 skill blocks**, quedarse con los 5 más relevantes (priorizar contexto de código sobre contexto de tarea).

## Feedback loop anti-compaction

Los sub-agentes deben reportar `skill_resolution` en su return envelope:
- `injected` — recibió `## Project Standards (auto-resolved)` del orchestrator ✅
- `fallback-registry` — no recibió standards, los buscó en el registry por cuenta propia
- `none` — no hay skills cargados

**Regla de auto-corrección del orchestrator**: si un sub-agente reporta `fallback-registry` o `none`:
1. Releer el skill registry inmediatamente (posiblemente perdido por compaction)
2. Inyectar compact rules en TODAS las delegaciones subsiguientes
3. Loguear: "⚠️ Skill cache miss detectado — registry recargado para futuras delegaciones"
