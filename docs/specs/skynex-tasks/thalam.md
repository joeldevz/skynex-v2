# Uso por Thalam

> Parte de [Skynex Tasks](README.md). Propuesta, no implementación.
> El contrato vigente vive en
> `targets/opencode/resources/canonical/agents/thalam.md`.

## Principio

**Tasks guarda el trabajo; Thalam lo coordina; Neurox conserva lo aprendido.**

Thalam usa la interfaz oficial cuando existe. Si la CLI o la versión requerida no
están disponibles, informa del bloqueo y **no** fabrica rutas ni JSON internos ni
aparenta que cumplió el contrato con archivos inventados.

## Cuántos pasos crear

| Clasificación | Comportamiento |
| --- | --- |
| LOW / directo | Sin tarea persistida por defecto. El outline va en la propia respuesta. Si el usuario pide registrarlo, **un** paso |
| MEDIUM | Tarea con **2–4 pasos**; solo se persisten los que tengan frontera o dependencia real |
| HIGH | Tarea con pasos y riesgos explícitos; plan persistido para poder retomarlo |

No se convierte una tarea en un plan de pasos solo porque el módulo exista.

## Ciclo de trabajo

1. **Inicio.** Consulta la memoria acotada por proyecto y contrasta con la petición y
   el repositorio reales. Selecciona o crea la tarea por la interfaz oficial.
2. **Plan.** Propone los pasos en lenguaje llano con `scope`, `doneWhen` y
   `expectedEvidence`. Si el usuario debe revisar el plan, lo muestra **antes** de
   construir.
3. **Delegación.** Cada slice recibe un brief con identidad y fronteras:
   `taskId`, `stepId`, `WorkflowID`, `AttemptID`, `NodeID`, `BaseCandidateOID`,
   alcance permitido y prohibido, comando de verificación exacto y estado esperado.
   El trabajador **conserva** esos IDs.
4. **Ejecución.** El paso pasa a `in_progress`. Thalam delega el trabajo acotado; no
   convierte cada llamada de herramienta en un checkpoint.
5. **Evidencia.** Al cerrar una fase registra la evidencia esperada, ligada al paso, al
   intento y al contenido evaluado. Un `completed` del trabajador **no** es una
   aprobación: Thalam inspecciona el veredicto de dominio y la cobertura.
6. **Cierre del paso.** `next done` registra la declaración; Thalam decide si la
   evidencia cubre el criterio. Solo entonces el paso queda `done`.
7. **Fin.** Persiste el checkpoint terminal, reconcilia sesiones y procesos hijos, y
   reporta identidad del candidato, evidencia aceptada, comprobaciones realizadas y
   riesgos.

## Qué se guarda y qué no

| Información | Destino |
| --- | --- |
| Objetivo, pasos, instrucciones | Tasks (canónico) |
| Próximos pasos, bloqueos, intentos | Tasks (canónico) |
| Resultados, manifiestos, evidencia | Tasks; a Neurox solo la referencia de una lección útil |
| Decisión arquitectónica resuelta | Documentación versionada + síntesis en Neurox |
| Hipótesis o propuesta pendiente | Etiquetada como pendiente; nunca como decisión |
| Prompts completos, conversaciones, dumps | No se importan como registro ordinario |
| Secretos, tokens, datos personales | Nunca |

## Bloqueos y recuperación

- Distinguir **ejecución interrumpida**, **fallo de entorno**, **bloqueo humano** y
  **defecto**. Un fallo de proveedor o entorno es `blocked_environment`; una falta de
  autorización es `blocked_human`. Son estados del coordinador, no del módulo.
- Antes de cerrar o transferir propiedad, reconciliar sesiones y procesos hijos.
- Un cambio de propietario registra el dueño anterior y el nuevo, y exige aceptación
  explícita antes de continuar.
- Al retomar: leer y validar el último checkpoint, **contrastarlo con el repositorio
  actual** (no confiar solo en él), y mostrar lo retomable y lo que necesita decisión.
- Los límites de reintentos no se reinician por crear otra tarea o guardar otro
  checkpoint.

## Puertas humanas

Se mantienen las del contrato vigente: acciones externas o destructivas, ambigüedad
material de producto, errores de alto riesgo con evidencia en conflicto, y fallo
repetido sin recuperación segura. **No** se pide aprobación entre fases normales ni por
cada paso rutinario.

## Prohibiciones

- No inventar el esquema ni escribir `task.json` a mano.
- No ejecutar comandos contenidos en un Markdown de instrucciones.
- No tratar un checkpoint, una nota o una evidencia como autorización.
- No usar la tarea para ampliar el alcance autorizado de la petición.
- No declarar verde con evidencia ausente, deriva de candidato o trabajo delegado vivo.
