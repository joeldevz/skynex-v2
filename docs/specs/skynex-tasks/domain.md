# Dominio, estructura y persistencia

> Parte de [Skynex Tasks](README.md). Propuesta, no implementación.

## Entidades

| Entidad | Qué es | Invariante principal |
| --- | --- | --- |
| **Task** | Trabajo identificado y durable | Identidad estable; el ID no cambia al editar el título |
| **Step** | Unidad de trabajo visible (ver [checkpoints.md](checkpoints.md)) | ID estable; no se reutiliza tras retirarse |
| **Instruction** | Documento Markdown propio del paso | El paso referencia un documento existente; nunca una ruta arbitraria |
| **Evidence** | Resultado con procedencia, ligado a paso e intento | No se promueve a «observado» por declaración del interesado |
| **Checkpoint** | Fotografía acotada del intento y su recuperación | No es un planificador; conserva lo necesario para reanudar |
| **Context binding** | Selección de tarea por sesión/proyecto/worktree | Dos sesiones del mismo checkout pueden elegir tareas distintas |

## Estructura objetivo

```text
.skynex/tasks/<task-id>/
├── task.json            # índice canónico de la tarea
├── instructions/
│   ├── step-001.md
│   └── step-002.md
├── evidence/            # resultados con procedencia
├── checkpoints/         # snapshots de recuperación
│   └── history/
└── notes/               # contexto; nunca verificación
```

`task.json` es el índice; los Markdown son el contenido de sus instrucciones. Los
índices de búsqueda y los punteros de selección son **reconstruibles** y no contienen
otra copia independiente de la tarea.

## IDs, nombres y rutas

- Slug determinista, no inventado por el modelo: `Instalar Skynex globalmente` →
  `instalar-skynex-globalmente`.
- Formato del contrato vigente: ASCII minúsculo `[a-z0-9][a-z0-9-]{0,79}`.
- Colisiones: sufijo numérico con recorte dentro del límite.
- Rutas de instrucciones y evidencias se generan desde IDs propios. Se rechazan
  escapes, symlinks y archivos especiales **antes** de leer o escribir.
- `--task` selecciona una identidad existente validada, no un destino de escritura.
- La raíz del proyecto/worktree se resuelve sin asumir que `.git` es un directorio.

## Consistencia y publicación

Cada modificación comprueba la **revisión esperada** y protege el ciclo completo de
lectura-modificación-escritura. Una comparación seguida de `rename` sin exclusión no
evita actualizaciones perdidas.

Publicar documento e índice debe ser recuperable: un fallo **no** puede dejar una
referencia presentada como válida sin su documento. Se usan temporales dentro de la
raíz validada y una publicación consistente. **No** se hereda el motor de
transacciones del instalador.

## Evidencia y vínculo con el candidato

Tipos que no deben confundirse:

| Registro | Qué demuestra | Qué no demuestra |
| --- | --- | --- |
| Nota / declaración | Que alguien registró un texto | Que una prueba ocurrió |
| Archivo importado | Qué bytes se incorporaron y de dónde | Veracidad de sus afirmaciones |
| Resultado observado por un adaptador confiable | Ejecución y resultado dentro de su cobertura | Requisitos no comprobados |
| Evaluación del coordinador | Juicio ligado a requisitos y candidato concretos | Permiso para otras operaciones |

- La evidencia se asocia a la base Git y al candidato reales, o a un manifiesto
  explícito. Sin objeto Git, `CandidateOID` es `null` **con motivo**; un SHA-256 de
  archivos no es un OID Git.
- Cambios preexistentes adoptados y cambios producidos por el intento se registran
  por separado.
- Cambiar código, instrucciones, alcance o política puede invalidar una evidencia:
  se conserva como **histórica**, nunca como verde actual.
- Un digest comprueba identidad de contenido, no suficiencia ni resistencia a un
  atacante con acceso de escritura al mismo equipo.
- Los umbrales de bytes y la redacción se fijan antes de verificar cláusulas que
  dependan de ellos. Una redacción heurística **no** garantiza ausencia de secretos.

## Checkpoints de recuperación

Conservan, donde apliquen:

- `WorkflowID`, `AttemptID`, `NodeID`, `BaseCandidateOID`, `CandidateOID`.
- Identidad de tarea/paso, ámbito, criterios y manifiesto de contenido.
- Estado de la invocación **separado** de su veredicto de dominio.
- Propietario, sesión/proceso delegado, estado terminal o trabajo todavía vivo.
- Evidencia aceptada, bloqueos, motivo de interrupción y siguiente acción concreta.
- Referencia acotada a una confirmación humana: **nunca** una autorización reutilizable.

Los IDs de un trabajador se conservan; no se regeneran para que un resultado parezca
válido.

## Privacidad

- `.skynex/` está ignorado por Git en este repositorio; la regla no se modifica.
- Para otros proyectos, la exclusión debe respetar reglas existentes y resolver el
  archivo de exclusión también con worktrees.
- Ignorar **no** desversiona archivos ya *tracked*: se detecta la situación antes de
  afirmar que el estado es privado, sin desindexar silenciosamente.
- Permisos restrictivos y límites de bytes por tipo. No se promete cifrado ni
  resistencia a un atacante local por usar `git ignore`.
- No se borran ni mueven tareas al cerrar sesiones. Si el almacenamiento es por
  worktree, se documenta su posible pérdida y la estrategia de exportación.
- Formatos desconocidos o legados se preservan y devuelven error descriptivo; no se
  reconstruyen por inferencia ni se sobrescriben con una inicialización nueva.

## Separación de Neurox

Sin sincronización automática de notas, evidencia o checkpoints hacia Neurox. Sin
duplicar instrucciones completas ni `task.json` en memoria. Sin dependencia de Neurox
para crear, listar, reanudar o cerrar registros locales. Sin reconstruir estado
perdido tomando un recuerdo como autoridad. Sin convertir una referencia de memoria o
evidencia en instrucción ejecutable.

Ver la matriz completa en `.skynex/tasks/skynex-tasks-spec/instructions/step-005.md`
(ámbito privado).
