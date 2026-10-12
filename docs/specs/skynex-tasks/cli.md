# Skynex Tasks CLI — implementación y propuesta

> Parte de [Skynex Tasks](README.md). La tabla separa los subcomandos presentes en
> `apps/cli/src/task-command.ts` de los que siguen siendo propuesta. La sintaxis
> propuesta no debe confundirse con una interfaz disponible.

El punto de entrada `apps/cli/src/index.ts` enruta `skynex task` al comando actual.

## Operaciones implementadas

| Operación | Sintaxis disponible | Efecto |
| --- | --- | --- |
| Inicializar | `skynex task init <title> [--security on|off|auto] [--tasks-root <dir>] [--json]` | Crea la tarea local |
| Listar | `skynex task list [--tasks-root <dir>] [--json]` | Lista tareas del cuaderno local |
| Estado | `skynex task status [--task <id>] [--tasks-root <dir>] [--json]` | Muestra objetivo, pasos, siguiente paso y bloqueos |
| Añadir paso | `skynex task next add <title> --scope <t> --done-when <t> --evidence <t> [--instruction-file <p> o --instruction <t>] [--depends-on <stepId>]... [--parent <stepId>] [--task <id>]` | Añade un paso; `--parent` admite un nivel de hijos |
| Leer paso | `skynex task next show [<stepId>] [--task <id>]` | Lee la instrucción del paso |
| Iniciar | `skynex task next start <stepId> [--task <id>]` | Marca el paso `in_progress` |
| Bloquear | `skynex task next block <stepId> --reason <text> [--task <id>]` | Registra la razón del bloqueo |
| Declarar terminado | `skynex task next done <stepId> [--task <id>]` | Declara el paso `done`; no significa aprobación |
| Fijar checkpoint | `skynex task checkpoint set --checkpoint <JSON> [--task <id>]` | Guarda o actualiza el checkpoint de recuperación |
| Consultar checkpoint | `skynex task checkpoint show [--task <id>]` | Muestra el checkpoint actual |
| Configurar revisión | `skynex task reviews set security=<mode> [--task <id>]` | Actualiza el selector; `<mode>` es `on`, `off` o `auto` |

Los comandos aceptan `--tasks-root`, `--json` y ayuda donde corresponda; las
mutaciones también admiten `--expected-revision`. Véase la ayuda de la CLI para las
opciones completas.

## Operaciones aún propuestas (no implementadas)

| Operación | Sintaxis propuesta | Efecto previsto |
| --- | --- | --- |
| Añadir evidencia | `skynex task evidence add --step step-001 --type test --file ./resultado.json [--task <id>]` | Importa evidencia con origen explícito |
| Añadir nota | `skynex task note add "Decisión breve" [--task <id>]` | Guarda contexto; no es verificación |
| Guardar checkpoint | `skynex task checkpoint save --status blocked_human --reason "..." [--task <id>]` | Sintaxis antigua propuesta; la operación actual es `checkpoint set --checkpoint <JSON>` |
| Historial | `skynex task checkpoint history [--task <id>]` | Muestra historial acotado |
| Vincular sesión | `skynex task link-session --session <session-id> [--task <id>]` | Registra un vínculo; no importa la conversación |
| Retomar | `skynex task resume [--task <id>]` | Recupera contexto y muestra el siguiente paso |
| Comprobar recuperación | `skynex task recover [--task <id>]` | Detecta inconsistencias sin borrar ni ejecutar |
| Cerrar | `skynex task close [--task <id>]` | Cierre lógico sin borrar evidencias |

## Semántica implementada

- `next add` requiere `--scope`, `--done-when` y `--evidence`; puede recibir una
  instrucción en texto o desde archivo.
- La relación `--parent` tiene un nivel: solo un paso superior puede ser padre. Al
  declarar terminado el padre se completan sus hijos; al completar el último hijo se
  completa también el padre.
- `next done` registra una declaración, no una aprobación.
- Los checkpoints también pueden adjuntarse a `next start`, `next block` o `next done`
  para actualizar estado y recuperación en la misma mutación.

## Semántica propuesta pendiente

Las reglas originales sobre vínculo de contexto inequívoco, importación de archivos,
retomar, recuperación, cierre y publicación atómica describen el contrato deseado
para funciones futuras; no convierten los comandos propuestos de arriba en capacidades
disponibles.

## Salida para agentes

`--json` está disponible y devuelve resultados estructurados para los comandos
implementados; los campos dependen de la operación.

`status` muestra estado de pasos, no sus instrucciones. La CLI usa errores tipados,
incluidos `NO_ACTIVE_TASK`, `AMBIGUOUS_TASK`, `REVISION_CONFLICT`, `INVALID_PATH`,
`UNSUPPORTED_SCHEMA` y `LEGACY_FORMAT`.

## Fuera del alcance inicial

`evidence run`, ejecución desde `--command`, dependencias ejecutables `--after`,
subcomandos de push/deploy, migraciones silenciosas y cualquier permiso comodín para
ejecutar acciones futuras.
