# TDD en el checkout actual de Skynex

## Cómo se decide entre direct y tdd, y cómo se ejecuta la ruta tdd

### Takeaway

La ruta TDD existe y tiene pasos detallados, pero solo se activa por `slice.tdd=true`; LOW/localizado se clasifica localmente como trabajo directo incluso para red/green. El resultado es un sistema de TDD opt-in/dependiente del clasificador, no un mandato uniforme para cambios de comportamiento: no hay criterio determinista completo para cuándo poner `slice.tdd=true` salvo el fallback.

### Cited Findings

- Thalam separa LOW/MEDIUM/HIGH por tamaño/riesgo: LOW incluye “localized or obvious fix” y es implementación directa con checks locales; el texto dice que riesgo determina profundidad de revisión, no TDD — [thalam.md:269-277](../../targets/opencode/resources/canonical/agents/thalam.md#L269).
- Un LOW obvio con aceptación clara se clasifica localmente y usa un owner directo sin sesiones hijas por defecto, “including for focused red/green work”. Las demás tareas ejecutables llaman `skynex_classify` y toman su route como punto de partida — [thalam.md:283-290](../../targets/opencode/resources/canonical/agents/thalam.md#L283).
- La salida `direct` lleva a la menor implementación/verificación; `tdd` inicia red-contract — [thalam.md:292-300](../../targets/opencode/resources/canonical/agents/thalam.md#L292).
- El fallback local manda a `tdd` para “clear nontrivial executable behavior needing tests”, cuando autorizado; de otro modo `direct`. Fallo provider/auth/environment termina bloqueado; classifier deshabilitado/no disponible permite fallback determinista — [thalam.md:304-333](../../targets/opencode/resources/canonical/agents/thalam.md#L304).
- La clasificación del proveedor solo devuelve opciones compactas `task_type`, `risk`, `route`, `clarification`; Jev no inspecciona el repo. La llamada es opcional/configurable — [thalam.md:315-333](../../targets/opencode/resources/canonical/agents/thalam.md#L315); [skynex-runtime.ts:336-343](../../targets/opencode/resources/native/plugins/skynex-runtime.ts#L336).
- Una prohibición explícita de crear/ejecutar tests prevalece: fijar `slice.tdd=false`, limitarse a checks permitidos y reportar lo no verificado; no elimina gates de seguridad ni acciones externas/destructivas — [thalam.md:292-295](../../targets/opencode/resources/canonical/agents/thalam.md#L292).
- Para `slice.tdd=true`, el ciclo de Thalam delega a test-engineer, exige evidencia RED por razón esperada, pasa el contrato a test-reviewer (solo juicio estático), y después a coder para cambios de producción y prueba GREEN — [thalam.md:349-363](../../targets/opencode/resources/canonical/agents/thalam.md#L349).
- Test-engineer define casos conductuales, ejecuta el test enfocado y debe probar fallo por ausencia del comportamiento, no por setup/sintaxis; no implementa producción. Solo actúa con TDD autorizado — [test-engineer.md:81-115](../../targets/opencode/resources/canonical/agents/test-engineer.md#L81).
- Test-reviewer no autoriza por su cuenta una ruta de escritura: un route direct/no-tests no es por sí mismo MISSING ni permiso para escribir tests; evalúa contrato congelado, falsos positivos y cobertura aceptada — [test-reviewer.md:115-120](../../targets/opencode/resources/canonical/agents/test-reviewer.md#L115). Sus labels por archivo son diagnósticos; errores anclados a aceptación congelada bloquean, warnings solos no — [test-reviewer.md:202-210](../../targets/opencode/resources/canonical/agents/test-reviewer.md#L202).
- Coder dice actuar directamente y ejecutar verificación mínima — [coder.md:96-104](../../targets/opencode/resources/canonical/agents/coder.md#L96). Su “TDD IRON LAW” solo rige cuando `slice.tdd=true`; en direct respeta únicamente checks autorizados y comunica huecos. Consume contrato RED aceptado, no cambia su intención, implementa hasta GREEN y bloquea si no hay RED válido — [coder.md:157-178](../../targets/opencode/resources/canonical/agents/coder.md#L157).
- La skill `tdd-discipline` limita su aplicabilidad a `slice.tdd=true` o asignación explícita standalone; direct/LOW no requiere pipeline multiagente — [tdd-discipline/SKILL.md:6-17](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L6). Para TDD requiere `red_proof`, `green_proof`, calidad de asserts, mocks y traza a especificación — [tdd-discipline/SKILL.md:69-87](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L69).

### Inferences

- `direct` no necesariamente significa “sin tests”: permite la verificación mínima autorizada y puede incluir tests post-implementación; lo que excluye es el protocolo obligatorio RED previo salvo autorización TDD. Esto se ve explícito en diagnose y coder, y en la ausencia de un test script raíz (ver sección de comandos).
- La frase “including focused red/green work” en clasificación LOW permite TDD secuencial por un único owner, mientras skill/flujo describen TDD como pipeline solo con `slice.tdd=true`. La bifurcación defendible es: RED-first puede seguir siendo TDD en LOW, pero no se dispara automáticamente ni obliga a delegar especialistas.
- La recomendación mínima es definir una regla de asignación inequívoca para `slice.tdd`: sí para cambio de comportamiento ejecutable no trivial/regresión funcional, aun si LOW; no para docs/formatting/config no conductual/bug trivial, o prohibición expresa. Mantener cero child sessions para LOW y permitir que el owner directo haga el ciclo RED→GREEN evita imponer sobrecarga del pipeline.

### Gaps

- No se encontró en el checkout una definición de criterios del clasificador Jev que garantice qué tareas reciben route `tdd` frente a `direct`; el código del runtime instala/interpreta el clasificador y su salida, no documenta una política de clasificación con umbrales.
- No se ejecutaron tests, builds ni verificaciones en esta investigación; se inspeccionó el texto/configuración versionados, no el comportamiento del proveedor en vivo.

## Conflictos y cambios mínimos para adopción coherente

### Takeaway

Hay conflicto material entre descripción/mandato general de TDD y la ruta condicional actual, además de una excepción amplia “config” que puede excluir cambios conductuales expresados como configuración. La seguridad es un gate independiente de TDD: route direct, excepción de tests o prohibición de tests no cancela revisión de diffs sensibles.

### Cited Findings

- La descripción canónica de la skill promete uso si “user opts into TDD or the task requires writing or modifying tests”, pero su sección Applicability solo aplica si `slice.tdd=true` o standalone explícito, y exime LOW/direct — [tdd-discipline/SKILL.md:2-3](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L2); [tdd-discipline/SKILL.md:14-17](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L14).
- La misma skill incluye excepciones “trivial bugfixes” y “non-code tasks (docs, configs, README)” — [tdd-discipline/SKILL.md:109-110](../../targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md#L109). Coder, en cambio, acota la exención a documentación, formatting y configuración no conductual — [coder.md:178](../../targets/opencode/resources/canonical/agents/coder.md#L178). Por tanto, “configs” puede excluir indebidamente configuraciones que implementan comportamiento.
- Diagnose manda reproducir antes de proceder y genera 3–5 hipótesis, pero en Phase 5 solo exige test antes del fix cuando `slice.tdd=true`; direct/ausente permite test post-implementación — [diagnose/SKILL.md:73](../../targets/opencode/resources/canonical/skills/diagnose/SKILL.md#L73); [diagnose/SKILL.md:83-100](../../targets/opencode/resources/canonical/skills/diagnose/SKILL.md#L83); [diagnose/SKILL.md:103-107](../../targets/opencode/resources/canonical/skills/diagnose/SKILL.md#L103).
- Diagnose también tiene una ruta de diagnóstico autónomo restringida a gateway `diagnostic_read/glob/grep`, y bloquea con `blocked_human` si gateway/límites faltan — [diagnose/SKILL.md:6-15](../../targets/opencode/resources/canonical/skills/diagnose/SKILL.md#L6). No debe confundirse este gateway de investigación con autorización de editar o correr tests.
- Verifier ejecuta checks asignados por Thalam, una vez por candidato sin cambios; su objetivo incluye lint, build/type-check y tests asignados. No corrige ni decide checks por sí mismo — [verifier.md:75-98](../../targets/opencode/resources/canonical/agents/verifier.md#L75); [verifier.md:112-120](../../targets/opencode/resources/canonical/agents/verifier.md#L112).
- Thalam asigna `verifier` para evidencia mecánica; asigna `security` solo para diffs sensibles, con reglas de switches separadas — [thalam.md:371-382](../../targets/opencode/resources/canonical/agents/thalam.md#L371); [thalam.md:386-405](../../targets/opencode/resources/canonical/agents/thalam.md#L386).
- Criterios sensibles explícitos: prompts/agentes/tools/permisos/MCP/auth/secrets/policy/config/external/destructive; salvo switch `off`, se requieren dos jueces security independientes sobre la misma ronda congelada — [thalam.md:530](../../targets/opencode/resources/canonical/agents/thalam.md#L530). La skill security prescribe jueces en paralelo, re-juicio luego de cada fix y no aprobar sin ambos CLEAN en la misma ronda — [security/SKILL.md:6-11](../../targets/opencode/resources/canonical/skills/security/SKILL.md#L6); [security/SKILL.md:23-30](../../targets/opencode/resources/canonical/skills/security/SKILL.md#L23); [security/SKILL.md:52-66](../../targets/opencode/resources/canonical/skills/security/SKILL.md#L52).
- La excepción de TDD por “config” no puede interpretarse como exención de seguridad: Thalam declara expresamente que la revisión security sigue aplicando con prohibición de tests y según el riesgo, independientemente de la route — [thalam.md:292-295](../../targets/opencode/resources/canonical/agents/thalam.md#L292).
- Security agent es juez adversarial de vulnerabilidades, no autor del contrato funcional ni sustituto de RED/GREEN — [security.md:75-89](../../targets/opencode/resources/canonical/agents/security.md#L75).

### Inferences

- Cambios mínimos recomendados por fichero (propuesta, no cambios realizados):
  - `targets/opencode/resources/canonical/agents/thalam.md`: precisar que route `tdd` es mandato RED-first para cambios de comportamiento ejecutable y regresiones, incluidas tareas LOW (pipeline multiagente solo si la complejidad lo requiere); fijar excepciones delimitadas a docs/formatting/config no conductual/bug trivial y prohibición explícita del usuario. Mantener riesgo como eje independiente de revisión security.
  - `targets/opencode/resources/canonical/skills/tdd-discipline/SKILL.md`: alinear descripción y Applicability con regla anterior; sustituir exención genérica de “configs” por “configuración no conductual”, aclarar que LOW/direct no implica pipeline multiagente, pero tampoco suprime RED-first cuando el mandato se activa.
  - `targets/opencode/resources/canonical/agents/coder.md`: conservar la autoridad del route; cambiar “direct requires only authorized checks” solo si se decide que una regresión TDD mínima es universal para bugs/cambios conductuales. Alinear la exención de configuración a la de la skill.
  - `targets/opencode/resources/canonical/skills/diagnose/SKILL.md`: alinear la regla de test previo con definición común de `slice.tdd`; describir que bug reproducible con test seam viable es RED-first según política, con excepción explícita solo cuando se prohíbe/declara no aplicable. Preservar el gateway seguro.
  - `targets/opencode/resources/canonical/agents/test-engineer.md` y `test-reviewer.md`: agregar una línea aclaratoria: solo intervienen si Thalam asigna el pipeline; un direct LOW puede hacer el ciclo con owner único; review no eleva por cuenta propia una route ni convierte test opcional en obligatorio. El contenido existente ya respalda la mayor parte de esta separación.
  - `targets/opencode/resources/canonical/agents/verifier.md`: explicitar que verifica lo requerido y autorizado, incluyendo cobertura/evidencia del ciclo TDD si se le asigna; no reemplaza el red proof previo ni el juicio de seguridad.
  - `targets/opencode/resources/canonical/skills/security/SKILL.md` (y de ser necesario `security.md`): añadir nota explícita de independencia: revisión dual se decide por sensibilidad/switch, no por `slice.tdd`, y no satisface ni sustituye pruebas conductuales. Thalam ya contiene la regla normativa; minimizar duplicación si basta con esa referencia.
  - `scripts/lib/real-resource-transforms.mjs`: solo tocar si se cambia la sección de clasificación de Thalam; actualmente genera/sustituye JEV classification, no el criterio TDD. Evitar edición si no hay transformación equivalente necesaria.
- No tocar generated `packages/npm-cli/dist/resources/**`, ni salidas compiladas o manifiestos derivados manualmente: el recurso canónico bajo `targets/opencode/resources/canonical/**` es el insumo. Confirmar pipeline de distribución al implementar cualquier cambio.
- No tocar gate/review security ni quitar revisiones para “hacer TDD coherente”: TDD cubre corrección funcional; security cubre vulnerabilidades/boundaries y ambos se pueden requerir para el mismo cambio.

### Gaps

- No se inspeccionó un contrato público del clasificador que detalle route `direct/tdd` ni un test de clasificación que cubra esa matriz. La propuesta de criterio sería una decisión editorial de política, no una descripción de Jev probado.
- La revisión de seguridad dual depende de switches por tarea (`auto/on/off`); el texto dice que `off` suprime la revisión aun con diff sensible, por lo que esto es una política configurable y no un gate absolutamente incondicional.

## Comandos, verificaciones, evidencia del checkout y alcance

### Takeaway

El repo tiene `check`, `build` y varios verificadores/CI gates, pero no define un test script en el `package.json` raíz; ciertos subpaquetes sí usan `node --test`. Los comandos enumerados aquí son configuración encontrada, no comandos ejecutados durante esta investigación.

### Cited Findings

- Scripts raíz incluyen `pnpm check` (`tsc -b --pretty false`), `pnpm build` (`tsc -b`), `clean`, y verificadores installer/resources/sky-agents/tasks/review-gate/live-sidebar/opencode/package — [package.json:11-27](../../package.json#L11). No aparece script raíz `test`.
- CI en `.github/workflows/ci.yml` instala dependencias con lockfile congelado y ejecuta check, build, verify:installer, verify:real-resources, verify:sky-agents, build:distribution y verify:package — [ci.yml:1-19](../../.github/workflows/ci.yml#L1). No hay invocación general de `pnpm test` en este workflow.
- Subpaquetes declaran tests: `packages/tasks-node/package.json` usa `node --test dist/read-service.test.js dist/fs-safe.test.js`; `packages/tasks/package.json` usa `node --test dist/read-service.test.js` — [tasks-node/package.json:8](../../packages/tasks-node/package.json#L8); [tasks/package.json:7](../../packages/tasks/package.json#L7).
- Estado observado al comenzar: branch `main...origin/main`; checkout tiene `reports/` y `research_notes/` sin seguimiento. No se inspeccionaron ni modificaron esos contenidos preexistentes salvo crear este apunte bajo la ruta solicitada.
- Investigación estática de archivos del checkout; no se ejecutaron comandos de tests/build/verify ni se validó CI en vivo. No afirmar RED/GREEN ni estado de éxito de ningún check.

### Inferences

- Un flujo TDD de una tarea debe requerir al menos el comando de test focalizado existente para demostrar rojo/verde; `check`/`build` aportan compilación/type-check, pero por sí solos no demuestran comportamiento funcional.
- La adopción consistente no requiere inventar un nuevo comando raíz para el presente memo. Conviene mapear el test focalizado por paquete/área y hacer explícito cuando no exista (bloqueo o gap autorizado), sin reportarlo como ejecutado.
- Esta nota se guardó exclusivamente en `research_notes/TDD para Skynex y Gentle AI/skynex_tdd.md`; no se editaron archivos de producto.

### Gaps

- No se levantó inventario completo de tests existentes por workspace/package ni se inspeccionó cómo se invocan todos los tests de los paquetes.
- La presencia de comandos en scripts/CI no confirma que hayan pasado en este checkout o en CI actual; no se ejecutaron.
