# Gentle AI ODD: tareas, recuperación y unidades de trabajo

**Corte de investigación:** 2026-10-12. **Alcance:** ODD, granularidad, seguimiento/recuperación y commits; no evalúa el resto del producto.

## Estado upstream verificado

- La release estable más reciente que se observa en la página upstream es **v4.0.0**, publicada el **2026-10-01** (`ff77164`). La release declara ODD como única ruta de desarrollo, retirando SDD/OpenSpec como workflow; revisión nativa independiente (RDD) y desarrollo test-first siguen disponibles. No extrapolo el contrato de la v3 a v4 sin marcarlo como histórico. [Release v4.0.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v4.0.0), [listado de releases](https://github.com/Gentleman-Programming/gentle-ai/releases).
- El README actual describe ODD como explorar antes de modificar, mantener pequeñas las tareas entendidas y dar al trabajo sustancial autorizado un documento recuperable; las tareas pequeñas no requieren pipeline de planificación. La sección de referencia de README expone el protocolo operativo, incluidos artefacto único, recuperación y límites de tamaño. [README, sección ODD](https://github.com/Gentleman-Programming/gentle-ai#organic-driven-development); [docs/readme-reference.md](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/readme-reference.md).
- El contrato canónico de secciones compartidas está en [`internal/assets/skills/_shared/odd-orchestrator-sections.md`](https://github.com/Gentleman-Programming/gentle-ai/blob/main/internal/assets/skills/_shared/odd-orchestrator-sections.md) (blob actual `8a6c2f0d0037bd0ba1680362e85edec97e021835`); skills de commits en [`skills/work-unit-commits/SKILL.md`](https://github.com/Gentleman-Programming/gentle-ai/blob/main/skills/work-unit-commits/SKILL.md) (blob `7f4a68a049cc5beeb4f29ed7d688fdebf8648db1`). La release v4 explicita la retirada de SDD y que la delegación se rige por presupuesto de evidencia, no por contar archivos; para la forma detallada del ciclo y feature doc se cita además la referencia de README actual, no la documentación v3.7.0 empaquetada en CDN.

## Hechos del modelo ODD

1. **Clasificar antes de persistir.** Lo pequeño/entendido sigue directo y sin artefacto duradero; investigación, explicación, revisión y propuesta sin autorización para cambiar permanecen de solo lectura. ODD crea seguimiento para implementación sustancial autorizada, no porque la investigación haya descubierto una posibilidad. SDD/OpenSpec dejan de ser la alternativa por tamaño: en v4 ODD es la única ruta de implementación.
2. **Una ficha de feature, no un sistema paralelo de planes.** El README reference prescribe un documento bajo `odd/tasks/` con objetivo, problema/razón, alcance, restricciones, checklist accionable con IDs estables y criterios de aceptación, evidencia de verificación, progreso y próximo paso. La copia completa se refleja en un tema de Engram `odd/<feature>/tasks`, con localizador relativo al repositorio. No es un journal exhaustivo.
3. **Seguimiento y recuperación explícitos, pero reconciliados.** Actualizar la ficha y leer ambas copias de vuelta porque no son escrituras atómicas. Si Engram no está disponible, registrar el mirror pendiente, no afirmar éxito ni bloquear trabajo seguro no dependiente. En reanudación el padre lee el documento y la memoria completos, contrasta con el código/evidencia y conserva versiones en conflicto; checks solo con evidencia observada, tareas completas válidas se preservan y tareas invalidadas se reabren con motivo. El UI Todo es una proyección, no autoridad adicional.
4. **Tamaño de tarea ≠ umbral de workflow.** Aproximadamente 400 líneas authored (adiciones + eliminaciones; archivos generados excluidos) es una heurística de planificación por unidad: no es límite, criterio de aceptación, trigger de RDD ni obligación de dividir artificialmente. Por separado, el presupuesto de entrega de ~400 líneas evalúa acumulado desde el último límite revisado y puede condicionar estrategia/slices; no confundir los dos usos.
5. **Unidad cerrada con evidencia/commit.** Toda tarea sustancial ODD cierra con al menos un commit de work-unit en feature branch (crear rama primero si se está en default), incorporando tests y documentación pertinentes, mensaje Conventional Commit y SHA registrado en el documento. Cada commit debe representar comportamiento/arreglo/migración/doc entregable, no un tipo de archivo; rollback debe ser razonablemente independiente. Push, PR y merge siguen siendo decisión humana/política ordinaria. [Release v3.1.0, sección “Every ODD task closes…”](https://github.com/Gentleman-Programming/gentle-ai/releases) y skill citada arriba. La release v4 confirma vigencia general de ODD pero no reescribe en sus notas esta regla; README reference/skill actuales también la recogen.
6. **RDD separado del tracking.** El candidato nativo es el commit de work-unit o el slice de PR, nunca una casilla de tarea ni la rama acumulada. Si RDD está habilitado se evalúa cada commit: passive/low avanza sin ceremonia; high o evaluación fallida/no disponible dispara revisión del commit; medium difiere al slice. El clasificador solo aporta evidencia de riesgo, no autoridad/modelo. RDD es independiente y no debe confundirse con recuperación de la ficha ODD.

## Contraste con Skynex v2 actual

**Hechos locales (árbol base indicado en el brief):**

- `targets/opencode/resources/canonical/skills/skynex-tasks/SKILL.md` define Tasks como notebook local y registro único de progreso/recuperación para trabajo registrado; excluye plan Markdown/progress/checkpoint paralelo. Tiene estados por step, scope/done-when/evidencia, bloqueo, handoff y checkpoint acotado con IDs de workflow/attempt/node/base-candidate, manifiesto y referencias. Se prohíbe derivar autorización de esos datos; Thalam conserva decisiones y gates.
- El mismo skill indica registrar antes de implementación/delegación para trabajo con más de un entregable real e independientemente verificable; trabajo pequeño de un solo paso no se registra. Maneja matching/reuso con cautela y exige leer instrucciones de step antes de ejecutarlo. Para interrupción de LOW permite Tasks si conviene recuperación durable.
- `packages/tasks/src/schema.ts` y `packages/tasks/src/service.ts` implementan una libreta estructurada: status/revision, steps con `scope`, `doneWhen`, `expectedEvidence`, `dependsOn`, `parent`, `instructionPath`, bloqueos, checkpoints y switch de security review. `TaskService` hace transiciones con control optimista de revisión y persiste checkpoint junto con ciertos cambios. No es un scheduler ni ejecuta tareas.
- `targets/opencode/resources/canonical/agents/thalam.md` delimita explícitamente “NO SKYNEX WORKFLOW”; dice que Tasks es notebook pasivo, no scheduler/workflow/autoridad, ordena registro antes de editar/delegar cuando hay varios pasos y preserva las decisiones/gates de Thalam. `docs/adr/0005-defer-task-graph.md` confirma que se difirió grafo/orquestación, conservando un seam de aplicación.

## Evaluación y recomendación (interpretación)

**Encaje:** importar el principio, no el artefacto. Tasks de Skynex ya cubre tracking durable y checkpoint, y deliberadamente guarda evidencia opaca dentro de una libreta con controles y política de recuperación más acotados. ODD aporta una útil regla de proporcionalidad: no convertir todo trabajo en plan; iniciar registro al determinar que hay progreso sustancial que de verdad necesita recuperación, y no para investigación o propuesta read-only. Esto encaja con la regla actual de Skynex para multi-entregable, pero no debe sustituir la clasificación existente ni crear un segundo registro de feature/Engram.

**Ideas portables de bajo conflicto:**

- Anotar en la ficha existente una definición breve del objetivo y razón, alcance/restricciones, criterios verificables y siguiente paso, si faltan; no añadir un nuevo `odd/tasks` ni espejo Engram. Los campos actuales de step ya cubren scope/done-when/evidencia y checkpoint contiene lineage, por lo que sería principalmente una guía de uso/plantilla, no otro modelo de datos.
- En recuperación, reconciliar siempre estado guardado con checkout/evidencia presente, conservar tareas válidas y reabrir solo las invalidadas con razón. Skynex ya instruye comparar identidad/manifiesto y no reutilizar evidencia PASS de contenido cambiado; ODD refuerza la continuidad práctica, sin reemplazar la validación candidate-bound de Skynex.
- Si en el futuro se adopta commit por unidad, registrar SHA/evidencia como referencia opaca en el step/checkpoint y mantener tests/docs con el comportamiento. La regla upstream de un commit por tarea sustancial puede ser útil cuando el repositorio pide historial incremental revisable, pero no debe ser global ni asumirse autorizada en toda tarea Skynex.

**Duplicación/conflictos a evitar:**

- No replicar la ficha completa en Markdown/Engram: contradice “Tasks sole progress and recovery record” y crea divergencia; el checkpoint Skynex ya es el soporte de reanudación.
- No convertir 400 líneas upstream en límite/gate Skynex: el brief contiene slice-specific y congelación de candidato; el threshold de upstream es consejo/slicing para delivery/RDD, no disparador universal de registro o aprobación.
- No importar automáticamente branch/commit. Skynex separa candidate OID, manifest binding y autorización; el commit upstream forma parte de implementación ODD en esa política, mientras el skill Thalam pone gates de Git y acciones externas bajo política humana. Solo adoptarlo si hay decisión explícita del proyecto y compatibilidad con flujo de candidato.
- No copiar RDD, aprobación/declinación o transiciones nativas: Skynex no debe confundir el notebook pasivo con authority engine. La integración debe quedar en prompts/instrucciones, no en autoridad del schema.

**Recomendación:** conservar Tasks/Thalam como única fuente de progreso/recuperación y no absorber el sistema ODD entero. Adoptar únicamente el encuadre proporcional (pequeño/read-only sin registro; recovery como reconciliación basada en evidencia) y, si el equipo lo decide por política Git, la idea de unidad entregable con SHA/evidencia. La segunda opción merece decisión separada: upstream la hace obligatoria para su implementación ODD sustancial; en Skynex eso alteraría la política de commits, no solo mejoraría descripción de tareas. No recomendar nuevos archivos, campos, workflow o espejo Engram por esta investigación.

## Referencias locales consultadas

- `targets/opencode/resources/canonical/skills/skynex-tasks/SKILL.md` — “Before implementation”, “During and at handoff”, “Recovery checkpoint”, “CLI unavailable or incompatible”.
- `targets/opencode/resources/canonical/agents/thalam.md` — “RUNTIME BOUNDARY — NO SKYNEX WORKFLOW”, “SKYNEX TASKS”, “OPERATING PRINCIPLES”.
- `packages/tasks/src/schema.ts` — parse/serialize de notebook, steps y checkpoint.
- `packages/tasks/src/service.ts` — `TaskService`, control de revision y transiciones.
- `docs/adr/0005-defer-task-graph.md` — decisión de diferir grafo y mantener seam.

## Verificación y límites

Investigación read-only; no se ejecutaron tests ni builds. Upstream consultado en página de releases y contenido de `main` vía GitHub; release identificada v4.0.0 (2026-10-01). Las reglas granulares de commit están corroboradas por la skill actual y las notas v3.1.0, y la referencia actual de README; las notas de v4 verifican vigencia de ODD, no cada regla de commit por sí solas. No se infiere que el release exacto de binario esté instalado por Skynex.
