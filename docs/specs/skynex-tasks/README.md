# Skynex Tasks — especificación propuesta

> **Estado: propuesta de diseño. Nada de lo descrito aquí está implementado.**
> La CLI actual no expone `skynex task` (`apps/cli/src/index.ts`), no existe
> `packages/tasks/` y no existe `verify:tasks`. Estos documentos son datos de
> planificación: no conceden permisos de ejecución ni sustituyen una autorización.

Este conjunto de documentos es la versión **versionada y revisable** del diseño de
Skynex Tasks. El borrador de trabajo previo permanece en el ámbito privado
(`.skynex/tasks/skynex-tasks-spec/`, 2026-09-14) y no se sustituye ni se migra
automáticamente.

## Problema

Hoy el trabajo se coordina con `status.json` heterogéneos dentro de `.skynex/tasks/`.
Funcionan, pero:

- una tarea mediana no tiene una forma uniforme de mostrar **en qué consiste cada
  unidad de trabajo** ni **qué significa que está terminada**;
- el término "checkpoint" se usa tanto para *un hito legible* como para *una
  fotografía técnica de recuperación*, y esa ambigüedad confunde la revisión humana;
- no existe una interfaz oficial: cada agente tiende a inventar rutas y JSON internos.

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

## Alcance de la primera entrega

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
