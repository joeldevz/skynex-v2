# Contrato CLI propuesto

> Parte de [Skynex Tasks](README.md). **Ninguno de estos subcomandos existe todavía.**
> La sintaxis se congela con el esquema, no antes.

El punto de entrada es `apps/cli/src/index.ts`; delega en casos de uso, sin reglas de
filesystem ni de negocio dentro de prompts o presentación.

## Operaciones

| Operación | Ejemplo propuesto | Efecto |
| --- | --- | --- |
| Inicializar | `skynex task init "Instalar Skynex globalmente"` | Genera ID, estructura e índice y los devuelve |
| Listar | `skynex task list` | Resumen de tareas del ámbito seleccionado |
| Estado | `skynex task status [--task <id>]` | Objetivo, **tabla compacta de pasos**, siguiente paso y bloqueos |
| Añadir paso | `skynex task next add "Preparar instalación" --instruction-file ./PLAN.md [--task <id>]` | Copia la instrucción validada a un destino generado |
| Leer paso | `skynex task next show step-001 [--task <id>]` | Devuelve **solo** esa instrucción |
| Declarar terminado | `skynex task next done step-001 [--task <id>]` | Registra finalización declarada; no fabrica aprobación |
| Marcar bloqueo | `skynex task next block step-002 --reason "..." [--task <id>]` | Registra causa concreta de bloqueo |
| Añadir evidencia | `skynex task evidence add --step step-001 --type test --file ./resultado.json [--task <id>]` | Importa con origen explícito |
| Añadir nota | `skynex task note add "Decisión breve" [--task <id>]` | Guarda contexto; no es verificación |
| Guardar checkpoint | `skynex task checkpoint save --status blocked_human --reason "..." [--task <id>]` | Guarda el estado del intento identificado |
| Consultar checkpoint | `skynex task checkpoint show [--task <id>]` | Resumen del último checkpoint válido |
| Historial | `skynex task checkpoint history [--task <id>]` | Listado acotado |
| Vincular sesión | `skynex task link-session --session <session-id> [--task <id>]` | Registra vínculo; no importa la conversación |
| Retomar | `skynex task resume [--task <id>]` | Recupera contexto y muestra el siguiente paso |
| Comprobar recuperación | `skynex task recover [--task <id>]` | Detecta inconsistencias; no borra ni ejecuta |
| Cerrar | `skynex task close [--task <id>]` | Cierre lógico sin borrar evidencias |

## Semántica obligatoria

- Sin `--task`, se usa solo un **vínculo de contexto inequívoco**. La CLI sin contexto
  devuelve `NO_ACTIVE_TASK` o `AMBIGUOUS_TASK`; no elige al azar.
- Las mutaciones de trabajadores delegados usan **IDs explícitos y revisión esperada**.
- `init` no modifica OpenCode, no consulta modelos y no requiere Neurox.
- Un archivo importado **no** aporta permisos ni destinos de escritura.
- `resume` no ejecuta comandos del Markdown; `recover` no reintenta por su cuenta.
- `close` no cancela procesos silenciosamente; exige reconciliar trabajo vivo.
- Cancelación o validación fallida antes de publicar no deja cambios parciales.
- Errores de tarea **no** alteran recursos ni locks del instalador.

## Salida para agentes

`--json` devuelve una estructura pequeña: ID de tarea, ID de paso, revisión, estado,
ruta relativa generada y error tipado.

`status` **no** vuelca todas las instrucciones, notas, evidencias ni memorias: el
modelo lee el índice y después solo el documento requerido. El diagnóstico va a
`stderr`, separado de la salida estructurada. Nunca se imprimen secretos ni un entorno
completo.

Códigos semánticos, aún por congelar: `NO_ACTIVE_TASK`, `AMBIGUOUS_TASK`,
`REVISION_CONFLICT`, `INVALID_PATH`, `UNSUPPORTED_SCHEMA`, `LEGACY_FORMAT`.

Un error no se convierte en una tarea distinta ni se reintenta una mutación ambigua.

## Fuera del alcance inicial

`evidence run`, ejecución desde `--command`, dependencias ejecutables `--after`,
subcomandos de push/deploy, migraciones silenciosas y cualquier permiso comodín para
ejecutar acciones futuras.
