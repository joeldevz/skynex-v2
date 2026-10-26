# Evidencia Gentle AI para decidir metodología TDD de Skynex

## ¿Gentle AI es evidencia de que su desarrollo siga TDD?

### Takeaway
Los artefactos existentes permiten afirmar que Gentle AI **ofrece y mantiene disponible desarrollo test-first**, pero no demuestran que todo el producto se haya construido con TDD ni que el flujo documentado se haya ejecutado en una implementación concreta. Por ello es una referencia de prácticas/instrucciones TDD, no evidencia suficiente para adoptarlo como metodología obligatoria universal en Skynex.

### Cited Findings
- La nota local de ODD dice que el release v4.0.0 declara ODD como ruta de desarrollo y que “desarrollo test-first” sigue disponible; no presenta una traza roja→verde de un cambio del proyecto upstream. [research_notes/Gentle AI para Skynex/odd-workflow.md, líneas 5–9](../Gentle%20AI%20para%20Skynex/odd-workflow.md#L5-L9); [release v4.0.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v4.0.0).
- El informe previo resume su skill TDD como origen de “TDD Cycle Evidence”, patrones de aserción prohibidos e higiene/cota de mocks; el informe está basado en lectura estática y declara que no ejecutó el binario ni auditó todo el código upstream. [reports/Gentle AI para Skynex.md, líneas 13–15, 54](../../reports/Gentle%20AI%20para%20Skynex.md#L13-L15); [research_notes/Gentle AI para Skynex/platform-safety.md, líneas 41–43](../Gentle%20AI%20para%20Skynex/platform-safety.md#L41-L43).
- La skill TDD local atribuye explícitamente principios a “obra/Superpowers Iron Law + Gentleman/gentle-ai Cycle Evidence + nuestro return envelope”, y define red primero cuando la ruta autorizada lo requiere, fallo por razón esperada, green mínimo y refactor posterior. [targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md, líneas 14–22, 24–43](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L14-L43).

### Inferences
- La evidencia respalda “Gentle AI contiene una disciplina TDD documentada que Skynex tomó como una de varias fuentes”; no respalda “Gentle AI fue desarrollado íntegramente mediante TDD”.
- No atribuir a Gentle AI en exclusiva toda la skill Skynex: su propio encabezado indica fuentes múltiples y adaptación local.

### Gaps
- No hay en los artefactos locales consultados una muestra de commits/cambios upstream con test fallando antes de la implementación y pasando después, ni auditoría de adherencia práctica al flujo.
- No se localizó una evidencia/task asociado específico a la investigación TDD/Gentle AI; el directorio `research_notes/TDD para Skynex y Gentle AI/` estaba vacío antes de crear esta nota. El informe previo y las tres notas Gentle AI sí existen.

## ¿Qué prácticas de prueba aparecen y qué es solo generación/validación?

### Takeaway
En Skynex existe un contrato TDD explícito, condicional a autorización/ruta, junto con verificaciones posteriores y validaciones de artefactos. Esas verificaciones, builds o generación determinista pueden dar regresión/consistencia valiosa, pero por sí solas no prueban práctica red-first; además, varios planes locales excluyeron TDD expresamente.

### Cited Findings
- La skill de Skynex aplica el ciclo solo si `slice.tdd=true` o TDD standalone fue asignado explícitamente; establece contrato de test aprobado, red con razón esperada, implementación mínima, refactor tras green, y evidencia obligatoria `red_proof`, `green_proof`, calidad de aserción, mocks y trazabilidad a requisitos. [targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md, líneas 14–20, 24–43, 69–93](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L14-L20).
- La misma skill separa excepciones: TDD opcional para arreglos triviales y no aplicable a docs/config/README. [targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md, líneas 107–111](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L107-L111).
- La decisión de bootstrap declara que la implementación inicial se hizo sin TDD por petición humana, aunque requería verificación. [docs/design-tree.md, líneas 19–27](../../docs/design-tree.md#L19-L27); [docs/implementation-plan.md, líneas 1–5](../../docs/implementation-plan.md#L1-L5).
- El plan de recursos reales prescribe `slice.tdd=false`, pruebas/chequeos post-implementación, generación determinista, allowlists, hashes y golden excerpts para validar transforms. El propio plan dice que esas pruebas no son gate red-first. [docs/real-resources-execution-plan.md, líneas 7–12, 46–48, 87–110, 188–208](../../docs/real-resources-execution-plan.md#L7-L12).
- La nota `review-design` aborda revisión congelada, verificadores y separación de aprobación/entrega; aclara que el verificador mecánico de Skynex no equivale al “validator” de Gentle AI. Esto es review/validación, no evidencia de TDD ejecutado. [research_notes/Gentle AI para Skynex/review-design.md, líneas 15, 21–27](../Gentle%20AI%20para%20Skynex/review-design.md#L15-L27).

### Inferences
- Clasificar cada evidencia por función: **TDD** requiere prueba conductual primero y fallo observado antes del cambio; **post-test/verificación** ejecuta checks después; **validación de generación** compara artefactos/salidas; **review** evalúa diffs o riesgos. No son intercambiables.
- Skynex ya tiene una metodología TDD utilizable de forma selectiva. Los artefactos muestran una decisión deliberada de scope/opt-in, no ausencia de reglas TDD.

### Gaps
- Los planes documentan intención/criterios, no por sí solos ejecución o resultados reales; esta investigación no ejecutó pruebas ni comprobó historiales de test.
- No se determinó qué modalidad TDD conviene para cada tipo de slice de Skynex; la evidencia aquí solo delimita precedentes y contratos existentes.

## ¿Qué lecciones de Gentle AI son transferibles sin generalizar una app distinta?

### Takeaway
La lección transferible es la calidad de la evidencia del ciclo (fallo esperado antes de implantar, resultado verde y trazabilidad), no imponer TDD a toda tarea ni usar prácticas de review/ODD como sustituto. Decidir obligatoriedad y alcance en Skynex debe basarse en su contrato vigente y autorización por slice.

### Cited Findings
- El informe anterior recomienda absorber invariantes/patrones, no la plataforma Gentle AI; distingue tareas read-only/pequeñas de implementación autorizada y advierte que sus políticas upstream no cambian los gates locales. [reports/Gentle AI para Skynex.md, líneas 5–9, 23–26](../../reports/Gentle%20AI%20para%20Skynex.md#L5-L9).
- La nota de revisión dice que congelar candidato y descartar evidencia al cambiarlo es compatible conceptualmente, pero Gentle AI implementa garantías con CLI/estado/snapshots y esas garantías no nacen de copiar prompts. [research_notes/Gentle AI para Skynex/review-design.md, líneas 7, 15, 31–40](../Gentle%20AI%20para%20Skynex/review-design.md#L7-L40).
- ODD es un marco de clasificación, registro y recuperación; la nota local no lo equipara con TDD y caracteriza TDD test-first como capacidad disponible separada. [research_notes/Gentle AI para Skynex/odd-workflow.md, líneas 7–18](../Gentle%20AI%20para%20Skynex/odd-workflow.md#L7-L18).
- La norma local vigente limita TDD a rutas autorizadas, mientras las decisiones históricas registran explícitamente slices sin red-first. [targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md, líneas 14–20](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L14-L20); [docs/design-tree.md, línea 20](../../docs/design-tree.md#L20).

### Inferences
- Lecciones seguras para decisión: pedir evidencia temporal verificable del RED antes del cambio; juzgar calidad conductual y relación con requisitos, no el simple conteo de tests; mantener excepciones explícitas y no reconstruir evidencia inexistente.
- No inferir que por ser Gentle AI un producto de agentes su ciclo sea idóneo para todo Skynex, ni que la presencia de una skill demuestre adhesión universal en upstream.

### Gaps
- No hay comparación empírica local entre red-first y post-test en Skynex (defectos detectados, coste, regresiones o calidad), por tanto esta evidencia no establece qué política global maximiza resultados.
- No hay evidencia local inspeccionada de la implementación de Gentle AI ni ejecución reproducida de su flujo TDD; los hechos upstream dependen de las fuentes documentales citadas en las notas congeladas.
