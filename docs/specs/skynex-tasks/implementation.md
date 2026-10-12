# Entregas, aceptación y decisiones abiertas

> Parte de [Skynex Tasks](README.md). Registra el plan y los criterios originales;
> la implementación actual es parcial y se resume aquí. Los criterios de diseño no
> prueban por sí solos que una capacidad se haya entregado.

## Secuencia de entregas

| Entrega original | Alcance propuesto | Estado actual |
| --- | --- | --- |
| **A — Cierre de diseño** | Resolver las decisiones abiertas y congelar esquema y alcance | Sigue como referencia de diseño; consulta las decisiones abiertas abajo |
| **B — Núcleo local** | Servicio, persistencia, CLI, evidencia importada y checkpoints | Implementado parcialmente: libreta/CLI local, checkpoints `set/show` y `verify:tasks`; importar evidencia e historial siguen propuestos |
| **C — Adopción por Thalam** | Uso del servicio y separación de memoria | La skill de Tasks y su coordinación local están presentes; las capacidades ausentes de la CLI siguen siendo brechas |
| **D — Adaptador OpenCode** | Vínculos de sesión y proyección/UI | La integración publica estado de Tasks en la barra lateral; vinculación de sesión e historial siguen propuestos |

La frontera B/C/D se confirma en la entrega A. No se añade scheduler, ejecutor genérico
ni sincronización remota a ninguna entrega.

## Primera entrega útil (criterio original propuesto)

Estos pasos son criterios de aceptación del diseño, no una afirmación de que la
primera entrega completa esté disponible:

Una persona debe poder, sin leer JSON:

1. crear una tarea con **2 pasos**;
2. ver la lista y leer el siguiente paso en lenguaje claro;
3. registrar la evidencia del primero;
4. marcarlo terminado;
5. recuperar la tarea en otra sesión conservando estado y bloqueos, y **sin** confundir
   «terminado» con «aprobado».

Si esto no funciona, la entrega B no está lista, por mucho que el esquema sea bonito.

## Matriz de aceptación original (no toda implementada)

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

- Preferencia del plan original: **sin TDD/red-first**; verificación posterior a la
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
- `verify:tasks` existe y verifica comportamiento de la implementación actual; no
  equivale a implementar o aceptar todas las cláusulas propuestas de este documento.

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
| D-08 | Ubicación del paquete | Resuelto en la implementación: existe `packages/tasks/` dentro del monorepo |

Una recomendación no es una decisión aceptada por el hecho de estar escrita. Se
pregunta solo por lo que cambie materialmente comportamiento, alcance o seguridad.

## Referencias

- `docs/future-task-graph.md` — reserva arquitectónica y aplazamientos explícitos.
- `docs/adr/0005-defer-task-graph.md` — decisión aceptada de aplazar el grafo.
- `docs/architecture.md` — frontera actual y *seam* de aplicación.
- `targets/opencode/resources/canonical/agents/thalam.md` — contrato vigente del coordinador.
- `.skynex/tasks/skynex-tasks-spec/` — borrador de trabajo privado (no versionado).
