# Entregas, aceptación y decisiones abiertas

> Parte de [Skynex Tasks](README.md). Propuesta, no implementación.
> Este documento **no** autoriza ejecutar ninguno de los comandos que enumera.

## Secuencia de entregas

| Entrega | Alcance | Resultado |
| --- | --- | --- |
| **A — Cierre de diseño** | Resolver las decisiones abiertas y congelar esquema y alcance | Contrato estable, sin código |
| **B — Núcleo local** | Servicio de tareas, persistencia, CLI, evidencia importada y checkpoints | Gestión local funcional sin OpenCode |
| **C — Adopción por Thalam** | Uso del servicio y separación de memoria | Coordinación real con pasos legibles |
| **D — Adaptador OpenCode** | Vínculos de sesión y proyección/UI | Contexto visible en el editor |

La frontera B/C/D se confirma en la entrega A. No se añade scheduler, ejecutor genérico
ni sincronización remota a ninguna entrega.

## Primera entrega útil (criterio de valor)

Una persona debe poder, sin leer JSON:

1. crear una tarea con **2 pasos**;
2. ver la lista y leer el siguiente paso en lenguaje claro;
3. registrar la evidencia del primero;
4. marcarlo terminado;
5. recuperar la tarea en otra sesión conservando estado y bloqueos, y **sin** confundir
   «terminado» con «aprobado».

Si esto no funciona, la entrega B no está lista, por mucho que el esquema sea bonito.

## Matriz de aceptación

Se conserva la matriz del borrador privado
(`.skynex/tasks/skynex-tasks-spec/instructions/step-007.md`, AC-01…AC-14) y se añaden
los escenarios de esta especificación:

| Cláusula | Escenario observable | Resultado exigido |
| --- | --- | --- |
| AC-15 | Trabajo pequeño sin petición de registro | No se crea tarea ni pasos; sin ceremonia añadida |
| AC-16 | Estado de una tarea mediana | Tabla compacta de pasos: título, dependencia y estado; sin volcar evidencia |
| AC-17 | Leer el siguiente paso | Se devuelve solo esa instrucción, no el plan completo |
| AC-18 | Declarar un paso terminado sin evidencia esperada | Queda declarado, **no** aprobado; el criterio no se da por cumplido |
| AC-19 | Tarea con evidencia obsoleta tras cambiar el candidato | La evidencia se marca histórica; no cuenta como verde actual |
| AC-20 | Retomar tras interrupción | Se contrasta checkpoint con repositorio real; no se ejecuta trabajo ni se borra nada |
| AC-21 | Un paso `blocked` | Exige causa concreta; el flujo no avanza en silencio |
| AC-22 | Instrucción que contiene comandos | Leerla o retomarla no ejecuta nada |

Los umbrales de bytes, esquema y exclusión se fijan antes de verificar las cláusulas
que dependan de ellos. Las cláusulas de fases aplazadas no bloquean entregas
anteriores.

## Política de comprobaciones

- Preferencia vigente del proyecto: **sin TDD/red-first**; verificación posterior a la
  implementación. Diseñar pruebas de comportamiento y fallos parciales dentro del
  alcance autorizado; no aceptar solo búsqueda de cadenas.
- Capturar evidencia **una vez por candidato** y cobertura pertinente; no repetir la
  misma comprobación para obtener otra aprobación.
- No declarar verde con evidencia ausente, deriva de candidato o trabajo delegado vivo.
- Separar errores bloqueantes de recomendaciones no bloqueantes.
- Las comprobaciones de runtime usan raíces temporales `HOME`/`XDG` aisladas, nunca el
  perfil global real.
- Cambios de prompts, plugins, permisos, herramientas o configuración exigen las
  revisiones de seguridad del **mismo candidato**; una aprobación documental no las
  sustituye.
- No existe hoy `verify:tasks`; el contrato de comprobación de Tasks está por definir.

## Decisiones abiertas

| ID | Tema | Qué falta concretar |
| --- | --- | --- |
| D-01 | Privacidad | Comportamiento sin Git o con estado ya *tracked*; política de exportación |
| D-02 | Contexto activo | Raíz por checkout frente a raíz estable de proyecto; retención al borrar un worktree |
| D-03 | Orden de entrega | Frontera exacta de la primera entrega y ubicación del adaptador nativo |
| D-04 | Evidencia | Contrato posterior de captura autorizada de ejecuciones |
| D-05 | Legado | Detección de artefactos antiguos, coexistencia e importación explícita |
| D-06 | Esquema | Campos definitivos, límites de bytes y mecanismo local de exclusión/recuperación |
| D-07 | Nombres | ¿Se mantiene `step-*` en las rutas o se adopta otro prefijo? Afecta a IDs ya citados |
| D-08 | Ubicación del paquete | `packages/tasks/` dentro del monorepo, con dominio sin dependencias de terminal/FS/OpenCode |

Una recomendación no es una decisión aceptada por el hecho de estar escrita. Se
pregunta solo por lo que cambie materialmente comportamiento, alcance o seguridad.

## Referencias

- `docs/future-task-graph.md` — reserva arquitectónica y aplazamientos explícitos.
- `docs/adr/0005-defer-task-graph.md` — decisión aceptada de aplazar el grafo.
- `docs/architecture.md` — frontera actual y *seam* de aplicación.
- `targets/opencode/resources/canonical/agents/thalam.md` — contrato vigente del coordinador.
- `.skynex/tasks/skynex-tasks-spec/` — borrador de trabajo privado (no versionado).
