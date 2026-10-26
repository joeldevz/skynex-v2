# Encaje actual de Skynex v2 para una mejora propia segura

## ¿Qué bucles de mejora permite realmente la arquitectura actual?

### Takeaway
Skynex v2 ofrece componentes útiles para proponer, modificar y verificar cambios con control humano; no hay base para describirlo como un sistema que se auto-mejora o se auto-despliega. El patrón viable hoy es un agente que prepara un cambio local acotado, aporta evidencia reproducible y deja la aceptación y las acciones externas al orquestador/persona.

### Cited Findings
- La arquitectura separa CLI/UI, casos de uso, dominio puro y adaptadores de filesystem/OpenCode; compilador e instalador hacen explícita la ruta de recursos [architecture.md](../../docs/architecture.md#L3-L25).
- Los updates de recursos gestionados comparan base previa, bytes locales y upstream; prompts y skills presentan etiqueta y diff visible, y los conflictos requieren revisión [architecture.md](../../docs/architecture.md#L42-L58); [ADR 0003](../../docs/adr/0003-resource-aware-updates.md#L7-L16).
- El modelo de instalación usa conjunto aceptado, snapshots limitados y restauración; no es una autorización para que un agente instale cambios globales sin confirmación [architecture.md](../../docs/architecture.md#L60-L68); [security-model.md](../../docs/security-model.md#L20-L45).
- Thalam define clasificación por riesgo, límites de alcance, evidencia ligada a identidad/base, inspección del resultado y separación entre resultado de worker y aprobación [thalam.md](../../targets/opencode/resources/canonical/agents/thalam.md#L182-L230).
- La política de Thalam pide consentimiento para acciones no permitidas automáticamente y edición/shell requieren preguntar en el perfil fuente [thalam.md](../../targets/opencode/resources/canonical/agents/thalam.md#L1-L16).

### Inferences
- Bucle defendible: formular una hipótesis medible → generar un diff pequeño sobre una base identificada → ejecutar verificaciones relevantes en entorno aislado → revisar diff/evidencia → aceptación humana → integración/instalación explícita. La arquitectura respalda las fases de diff, validación y protección, no su automatización integral.
- Oportunidades concretas: mejorar prompts/agentes con cambios revisables; endurecer verificadores y contratos; comparar resultados antes/después con el mismo fixture y criterios fijados antes del cambio. Mantener métricas, umbral de aceptación y rollback como diseño explícito antes de automatizar ciclos.

### Gaps
- No se encontró una función implementada que genere propuestas por sí sola, optimice prompts mediante evaluación, mida calidad en producción, elija el ganador o lo promueva/despliegue automáticamente.
- La arquitectura describe un plan de repositorio y componentes, pero no constituye evidencia de garantías de seguridad fuera de los límites documentados; el modelo excluye resistencia a procesos locales adversarios y no garantiza atomicidad multiarchivo ni inmunidad a pérdida de energía [security-model.md](../../docs/security-model.md#L3-L18) [security-model.md](../../docs/security-model.md#L26-L46).

## ¿Qué aportan Tasks, los workflows y las verificaciones, y qué falta?

### Takeaway
Las verificaciones ejecutables y los contratos de identidad ofrecen el soporte más tangible para experimentos controlados. La documentación de `Skynex Tasks` contiene una importante discrepancia de estado: el README dice que el módulo no está implementado, mientras que el árbol actual incluye `packages/tasks/`, scripts y CLI; por tanto, el README no debe usarse como descripción vigente sin contrastar código.

### Cited Findings
- El manifiesto raíz ofrece `build`, `check` y verificadores específicos de instalador, recursos, agentes, Tasks, review gate, sidebar, OpenCode y paquete [package.json](../../package.json#L11-L27).
- El verificador de Tasks usa APIs compiladas y raíces temporales aisladas para sus casos [verify-tasks.mjs](../../scripts/verify-tasks.mjs#L1-L24) [verify-tasks.mjs](../../scripts/verify-tasks.mjs#L41-L50); el servicio valida esquema, revisiones y persistencia [service.ts](../../packages/tasks/src/service.ts#L115-L185) [schema.ts](../../packages/tasks/src/schema.ts#L90-L118).
- La guía de Thalam exige para trabajo elegible WorkflowID, AttemptID, NodeID, BaseCandidateOID, alcance, archivos modificados, artefactos y resultados de verificación; advierte que no son registros de workflow generados por Skynex [thalam.md](../../targets/opencode/resources/canonical/agents/thalam.md#L202-L234).
- El diseño de Tasks versionado afirma explícitamente que es propuesta, contradiciendo el código y scripts actuales [README.md](../../docs/specs/skynex-tasks/README.md#L1-L11). Sus no-objetivos incluyen ejecución automática, scheduler y worktrees automáticos [README.md](../../docs/specs/skynex-tasks/README.md#L56-L62).
- La verificación del instalador documenta fixtures aislados y límites: sus pruebas no simulan pérdida de energía ni demuestran resistencia TOCTOU [security-model.md](../../docs/security-model.md#L48-L56).

### Inferences
- Hay base para registrar pasos y evidencias con el módulo implementado y verificar cambios mediante comandos existentes, pero la automatización debe consultar las capacidades del CLI/código actual, no seguir ciegamente la especificación obsoleta.
- Falta una capacidad de evaluación longitudinal: no se halló harness que mida calidad de cambios de prompts/agentes con corpus versionado, baseline, repetición/variabilidad y criterio de aceptación común. Incorporarlo sería prerrequisito para hablar de mejora objetiva, no solo de cambio.
- Conviene ligar cada resultado de experimento a commit/tree, versión de modelo/configuración, entrada/fixture, comando, salida y veredicto; la identidad de slice existente es una base, no un sistema completo de reproducibilidad estadística.

### Gaps
- No se estableció desde esta inspección qué verificadores concretos son obligatorios en cada tipo de cambio, ni cuáles son estables como benchmark de comportamiento de agentes.
- El README de Tasks y partes de sus especificaciones conservan contenido de propuesta que contradice el estado del código. Resolver y versionar esa documentación es necesario antes de usarla como contrato operativo.

## ¿Qué límites de control y seguridad deben permanecer explícitos?

### Takeaway
La mejora propia debe tratar el repositorio y sus prompts como entradas revisables, no como autoridad para ampliar permisos. Las acciones externas, destructivas o globales, la aprobación del resultado y la promoción de un candidato son gates distintos y no se deben inferir de que un agente haya terminado.

### Cited Findings
- Thalam indica que tareas/artefactos no conceden autorización; el coordinador conserva gates y un worker completado no equivale a aprobación [thalam.md](../../targets/opencode/resources/canonical/agents/thalam.md#L152-L180) [thalam.md](../../targets/opencode/resources/canonical/agents/thalam.md#L214-L230).
- El modelo de seguridad limita el objetivo actual a un operador local de confianza e instalación en su propio OpenCode 2; advierte expresamente sobre TOCTOU y procesos locales adversarios [security-model.md](../../docs/security-model.md#L3-L18).
- El instalador exige confirmación interactiva para plugins/hooks ejecutables; el modo no interactivo requiere `--yes` y `--allow-executable-plugins` [security-model.md](../../docs/security-model.md#L20-L24).
- El diseño de Tasks asigna al registro persistencia, no permisos, lanzamiento o aprobación; excluye scheduler y ejecución automática [README.md](../../docs/specs/skynex-tasks/README.md#L38-L45) [README.md](../../docs/specs/skynex-tasks/README.md#L56-L62).

### Inferences
- No asumir que un agente puede cambiar sus permisos, instalar globalmente su propio prompt, ejecutar en bucle cambios sucesivos o aprobar su propia evidencia. Cada operación necesita el gate correspondiente y una persona distinta o autoridad externa al candidato para aceptación.
- Una primera experiencia de auto-mejora segura debería limitarse a una rama/copia de trabajo, archivos permitidos enumerados, límites de iteraciones/coste, verificación aislada y revisión humana del diff; detenerse ante fallo, cambio de alcance o evidencia ambigua.
- El éxito debe definirse por mejora medida y no regresión en criterios preacordados; reportar fallos y ausencia de evidencia con la misma visibilidad que las mejoras.

### Gaps
- Esta inspección no prueba qué controles de permisos impone toda configuración/runtime de OpenCode ni cómo se comportan modelos distintos. No se hicieron inferencias sobre capacidades de autoedición de los modelos.
- No hay evidencia aquí de un mecanismo actual de promoción automática, rollback de cambios de código del propio Skynex ni evaluación de regresiones semánticas de prompts.
