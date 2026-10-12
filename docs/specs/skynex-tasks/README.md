# Skynex Tasks — especificación original

> Estos documentos conservan el diseño original; no son un inventario de estado ni
> todo lo propuesto está implementado. Las funciones disponibles y las brechas
> actuales se distinguen a continuación.

Este conjunto de documentos es la versión **versionada y revisable** del diseño de
Skynex Tasks. El borrador de trabajo previo permanece en el ámbito privado
(`.skynex/tasks/skynex-tasks-spec/`, 2026-09-14) y no se sustituye ni se migra
automáticamente.

## Estado actual de implementación

El árbol actual ya implementa un vertical local de Skynex Tasks:

- Libreta local de tareas y pasos, con la CLI `skynex task`: `init`, `list`,
  `status`, `next show/add/start/block/done`, `checkpoint set/show` y `reviews set`.
- Pasos hijos de un nivel mediante `next add --parent`; al completar un padre se
  completan sus hijos y el último hijo completado completa el padre.
- Persistencia y actualización de checkpoints, más publicación del estado en la
  barra lateral de OpenCode mediante la integración de Tasks.
- Paquete de dominio y `verify:tasks` para el comportamiento implementado.

Siguen siendo propuestas, entre otras, la importación de evidencia (`evidence add`),
las notas, el historial de checkpoints, la vinculación de sesiones y los comandos
`resume`, `recover` y `close`. La especificación no implica que esas capacidades
hayan salido.

## Contexto histórico del diseño

Al redactarse esta propuesta, el trabajo se coordinaba con archivos `status.json`
heterogéneos dentro de `.skynex/tasks/` y no había una interfaz oficial. Esa
descripción es contexto histórico, no el estado actual: ahora existe la libreta local
y la CLI indicadas arriba. Los problemas de uniformidad y de ambigüedad entre pasos y
checkpoints explican los objetivos del diseño original, no afirman que toda la
solución propuesta esté entregada.

## Idea central

Separar dos conceptos que hoy se mezclan:

| Concepto | Qué es | Para quién |
| --- | --- | --- |
| **Step** (checkpoint legible) | Unidad de trabajo visible: alcance, «terminado cuando», dependencia y evidencia esperada | Persona que revisa el plan y sigue el progreso |
| **Checkpoint** (recuperación) | Fotografía acotada de un intento: identidad, base, candidato, estado, siguiente acción | Coordinador que retoma tras una interrupción |

> Regla corta: **el Step se lee para decidir; el Checkpoint se guarda para reanudar.**

Y una regla de proporcionalidad: el trabajo pequeño **no** adquiere ceremonia por el
hecho de existir este módulo.

## Responsabilidades

| Componente | Es propietario de | No debe asumir |
| --- | --- | --- |
| Skynex Tasks | Registro durable de tareas, pasos, instrucciones, evidencias y checkpoints | Decidir permisos, lanzar trabajo o aprobar por sí solo |
| Thalam | Alcance, delegación, evaluación de resultados y recuperación | Inventar formatos internos de persistencia |
| Neurox | Conocimiento reutilizable, consultivo | Estado operativo, pendientes o autorización |
| OpenCode | Sesiones, herramientas y presentación | Propiedad canónica de las tareas |
| Instalador | Distribución y protección de recursos | Semántica de pasos, reintentos o planificación |

## Alcance propuesto para la primera entrega

- Registro local de tareas con pasos legibles y estados.
- Evidencia con procedencia, ligada a paso e intento, y vínculo explícito al
  contenido evaluado.
- Checkpoints de recuperación y reanudación sin ejecutar trabajo.
- CLI oficial; adaptación a OpenCode **después** del núcleo local.

## No objetivos (explícitos)

DAG o scheduler, ejecución automática de trabajo, leases distribuidos, worktrees
automáticos, sincronización remota, ejecución de comandos desde instrucciones,
`evidence run` genérico, y dependencia obligatoria de Neurox. Un orden de pasos
**no** es un planificador de dependencias. Compatible con
`../future-task-graph.md` y `../../adr/0005-defer-task-graph.md`.

## Documentos

| Documento | Contenido |
| --- | --- |
| [checkpoints.md](checkpoints.md) | Steps legibles: campos, proporcionalidad, estados, anti-patrones |
| [domain.md](domain.md) | Entidades, estructura en disco, invariantes, concurrencia y privacidad |
| [cli.md](cli.md) | Contrato CLI propuesto y salida para agentes |
| [thalam.md](thalam.md) | Cómo crea, delega, evidencia y recupera Thalam |
| [implementation.md](implementation.md) | Entregas, aceptación, verificación y decisiones abiertas |
