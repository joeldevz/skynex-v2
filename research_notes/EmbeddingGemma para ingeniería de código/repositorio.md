# EmbeddingGemma en el código real de Skynex v2

## 1. ¿Qué usos concretos tendría al programar aquí?

### Takeaway
El uso plausible es recuperar candidatos —funciones, contratos y verificadores— cuando el requisito usa palabras distintas del código. No reemplaza leer implementaciones ni demostrar equivalencia; estos ejemplos son oportunidades propuestas, no embeddings existentes.

### Cited Findings

| Caso | Código real y contrato | Uso potencial de recuperación semántica |
|---|---|---|
| Escrituras atómicas repetidas | Installer escribe temporal exclusivo, sincroniza archivo, renombra, registra mutación y sincroniza directorio: [transaction.ts:10–16](../../packages/installer/src/transaction.ts#L10). Tasks tiene modo configurable, errores `TaskError`, limpieza y sincronización de directorio: [fs-safe.ts:244–265](../../packages/tasks-node/src/fs-safe.ts#L244). Sky Agents comprueba permisos de directorios y sincroniza archivo, pero su helper no sincroniza directorio: [storage.ts:6–20,48–54](../../packages/sky-agents/src/storage.ts#L48). | Buscar «publicar cambios sin archivo parcial» podría reunir los tres patrones. La similitud sirve para revisión, no autoriza unificarlos: duración, permisos, limpieza y tipos de error difieren. |
| Recurso/configuración cambiada tras preview | Installer coteja digest de lock y destinos antes de modificar: [transaction.ts:73–86](../../packages/installer/src/transaction.ts#L73). Sky Agents consume confirmación ligada a digest, exige raíces globales y comprueba configuración dos veces: [profile-apply.ts:178–202](../../packages/sky-agents/src/profile-apply.ts#L178). | «No sobrescribir una edición del usuario entre preview y apply» podría recuperar ambos diseños y sus verificadores: [verify-installer-transactions.mjs:113–130](../../scripts/verify-installer-transactions.mjs#L113), [verify-sky-agents.mjs:21,27–28](../../scripts/verify-sky-agents.mjs#L27). No son autorizaciones intercambiables. |
| Concurrencia de tareas | `TaskStore.save` exige `expectedRevision`: [ports.ts:13–18](../../packages/tasks/src/ports.ts#L13); adapter obtiene lease exclusivo y exige revisión actual y siguiente: [store.ts:245–279](../../packages/tasks-node/src/store.ts#L245). | «Evitar que dos agentes pierdan pasos añadidos» conduce a contrato + adapter + [verificador de dos escritores:363–382](../../scripts/verify-tasks.mjs#L363). El caso existente simula escrituras con revisión obsoleta secuencialmente; no demuestra toda concurrencia de procesos. |
| Publicación de plugins antes de registrarlos | Orden de operaciones depende de configuración y presencia de eliminaciones: [transaction.ts:55–63](../../packages/installer/src/transaction.ts#L55). El verificador observa cada mutación y comprueba instalar archivos antes de registro, retirar registro antes de archivos: [verify-installer-transactions.mjs:30–61](../../scripts/verify-installer-transactions.mjs#L30). | «El watcher no debe cargar un plugin incompleto» podría recuperar orden de publicación y prueba relacionada aunque no mencione `applyOrder`. |

### Inferences
Ejemplo realista de **nuevo requisito → patrón → verificador**: «limitar bytes leídos aunque el archivo crezca después de `stat`» → `readFileSafe`, que lee como máximo `maximum + 1` y verifica inode ([fs-safe.ts:152–224](../../packages/tasks-node/src/fs-safe.ts#L152)) → prueba con handle inyectado que mide consumo, no solamente el error final ([fs-safe.test.ts:8–56](../../packages/tasks-node/src/fs-safe.test.ts#L8)).

El candidato relacionado `readInstructionBody` mantiene exclusión de secretos/hardlinks, pero usa `handle.readFile()` tras comprobar tamaño ([task-command.ts:426–479](../../apps/cli/src/task-command.ts#L426)). Aplicar aquel requisito aquí requeriría conservar esas restricciones, no copiar a ciegas el helper. Verificadores relacionados: escape por ancestro, secretos y hardlinks ([verify-tasks.mjs:904–942,992–1063](../../scripts/verify-tasks.mjs#L992)). Es una comparación estática, no un bug reproducido.

### Gaps
No se midió calidad de EmbeddingGemma con estos fragmentos ni latencia/recall; no se ejecutaron pruebas.

## 2. ¿Qué herramientas y límites ya existen?

### Takeaway
La búsqueda semántica sería complementaria a búsqueda textual, tipos y verificadores; el impacto necesita referencias reales y comportamiento exacto.

### Cited Findings
| Actual | Potencial, no implementado |
|---|---|
| Node `>=24`, pnpm `10.15.1`, TypeScript `7.1.0-dev.20260910.1`; `check` y `build` son `tsc -b`. Verificadores de installer, recursos, Sky Agents, Tasks, review gate, sidebar, OpenCode y paquete: [package.json:7–31](../../package.json#L7). | Un ranking semántico podría preceder lecturas y selección de verificadores; no sustituye compilación ni sus contratos. |
| NodeNext, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, declaraciones y proyectos composite: [tsconfig.base.json:2–14](../../tsconfig.base.json#L2). | Cualquier futuro adapter debe respetar esos tipos; no se verificó compatibilidad del runtime de un modelo con esta API/toolchain. |
| Verificadores usan `node:assert/strict`, imports de `dist` y CLI compilada: [verify-tasks.mjs:1–22](../../scripts/verify-tasks.mjs#L1). Tasks-node tiene `node --test` para dos pruebas compiladas: [package.json:8](../../packages/tasks-node/package.json#L8). | Recuperar prueba pertinente no demuestra que pase; fuente y `dist` podrían diferir. |

Se usó `rg` para símbolos y texto; no se encontró implementación de embeddings en los paquetes examinados. No hay evidencia aquí de índice semántico ni grafo de referencias existente.

### Inferences
Impacto de cambiar un helper: seguir imports, exports, callers y recursos empaquetados, además de ver comportamiento. `resolveContained` rechaza cualquier backslash y devuelve `TaskError`; `validateManagedPath` rechaza segmentos `..` separados por slash/backslash y devuelve `Error` ([fs-safe.ts:71–87](../../packages/tasks-node/src/fs-safe.ts#L71), [path-policy.ts:10–16](../../packages/installer/src/path-policy.ts#L10)). «Validación de rutas» no significa contrato idéntico. Un grafo de referencias o resolución TypeScript sería evidencia adicional propuesta, no resultado del embedding.

### Gaps
No se hizo inventario exhaustivo de todos los tests ni auditoría de compatibilidad con librerías de inferencia.

## 3. ¿Dónde encajaría un proveedor opcional, sólo de sugerencias?

### Takeaway
Un puerto de lectura separado y un adapter nativo opcional son una posibilidad arquitectónica; no una implementación autorizada ni un plan ejecutable.

### Cited Findings
Los puertos actuales incluyen `TargetAdapter` y `ManagedFileReader`, no búsqueda semántica ([application/src/index.ts:12–24](../../packages/application/src/index.ts#L12)). Tasks expone `TaskReader` y una fachada sin mutaciones ([ports.ts:8–18](../../packages/tasks/src/ports.ts#L8), [service.ts:289–304](../../packages/tasks/src/service.ts#L289)); sus exports están en [index.ts:1–7](../../packages/tasks/src/index.ts#L1).

El runtime nativo registra herramientas con esquema de entrada/salida, permiso y ejecución mediante `context.tool.transform`; actualmente añade `classify`, no búsqueda ([skynex-runtime.ts:3–20,335–345](../../targets/opencode/resources/native/plugins/skynex-runtime.ts#L335)). Tasks registra herramienta y RPC, valida ubicación/proyecto/sesión y refresca por eventos ([skynex-tasks/index.ts:60–91,107–132](../../targets/opencode/resources/native/plugins/skynex-tasks/index.ts#L60)). Esto confirma un punto técnico de extensión, no permisos concedidos. La dirección de dependencias es CLI/UI → aplicación → dominio ([architecture.md:3–11](../../docs/architecture.md#L3)).

### Inferences
Un proveedor hipotético devolvería candidatos con archivo, símbolo/rango, hash y razón; sin escribir código, aplicar perfiles, autorizar cambios ni convertir Tasks en scheduler. Recuperación también debe ser separada de memoria advisory.

Su corpus propuesto incluiría buffers sin guardar y working tree, hashes incrementales por contenido y manifests de snapshot/modelo/chunking, no sólo HEAD. Excluiría secretos, ignorados, generados, minificados y vendor; Git ignore no basta: permite `.env.example` ([.gitignore:1–16](../../.gitignore#L1)). Las exclusiones precederían lectura/indexación. Nada de esto está implementado ni aprobado.

### Gaps
BaseCandidateOID `9890f055975f9ef7703d570b724692e6ccde888e`; árbol observado con HEAD `fc2e6bde0cbb12a84cd9531267c2ba6b94d9680f`. WorkflowID `eg2-code-research-20261012`, AttemptID `a1`, NodeID `repo`. CandidateOID=null: nota no rastreada; evidencia basada en archivos actuales leídos, no validación runtime.
