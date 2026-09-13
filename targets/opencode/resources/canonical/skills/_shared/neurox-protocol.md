---
name: Neurox Protocol
description: Memoria persistente entre sesiones.
license: Complete terms in LICENSE.txt
---

> **REGLA FUNDAMENTAL**: Neurox es OBLIGATORIO en todas las skills y agentes.
> Cada skill DEBE consultar Neurox al inicio y guardar descubrimientos relevantes.
> No existe skill que opere sin memoria — Neurox ES la memoria del sistema.

## Cuándo usar Neurox

- **Al inicio de cada tarea**: `neurox_session_start` + `neurox_context` ANTES de cualquier otra acción
- **Búsqueda cross-namespace**: `neurox_recall` SIN namespace para encontrar contexto de OTROS proyectos
- **Búsqueda project-specific**: `neurox_recall` CON namespace para el proyecto actual
- **Durante la tarea**: `neurox_recall` con queries cortos tipo keyword antes de responder preguntas técnicas o modificar código conocido
- **Al encontrar algo durable**: `neurox_save` inmediatamente (no al final — se puede perder)
- **Al terminar**: `neurox_session_end` con resumen Goal/Discoveries/Accomplished/Next

## Protocolo de inicio (obligatorio para TODA skill y agente)

```
1. neurox_session_start(title, directory, namespace="{project}")
2. neurox_context(namespace="{project}")   ← leer ANTES de explorar el repo
3. Búsqueda cross-namespace (global — sin namespace):
   neurox_recall(query="{keywords del task}")
   neurox_recall(query="product decisions {domain}")
   → Esto encuentra contexto de OTROS proyectos que puede ser relevante
4. Búsqueda project-specific:
   neurox_recall(query="{keywords}", namespace="{project}")
5. Si hay preguntas de identidad/preferencias del usuario:
   neurox_recall(query="nombre preferencia usuario", observation_type="preference")
   → Si no hay resultado: 2-3 búsquedas más con variantes antes de rendirse
```

## Cuándo guardar (triggers obligatorios)

| Evento                                      | observation_type        | kind         |
| ------------------------------------------- | ----------------------- | ------------ |
| Decisión de arquitectura o diseño           | `decision`              | `semantic`   |
| Bug fix completado (con causa raíz)         | `bugfix`                | `procedural` |
| Patrón o convención descubierta             | `pattern` / `discovery` | `semantic`   |
| Usuario corrige el enfoque o da preferencia | `preference`            | `procedural` |
| Config de entorno o tool aprendida          | `config`                | `semantic`   |
| Trampa o gotcha encontrada                  | `gotcha`                | `procedural` |

## Formato de contenido al guardar

```
What: [qué se descubrió o decidió]
Why: [por qué importa]
Where: [archivos o módulos relevantes]
Learned: [qué aprender de esto para el futuro]
```

## Integración obligatoria en Skills

**TODA skill** debe incluir uso de Neurox. Cuando ejecutes cualquier skill:

1. **Al iniciar**: `neurox_recall(query="{tema de la skill}")` — buscar contexto previo
2. **Cross-namespace**: `neurox_recall(query="{tema}")` sin namespace — inteligencia de otros proyectos
3. **Al descubrir algo**: `neurox_save(...)` inmediatamente — no esperar al final
4. **Al terminar**: si hubo descubrimientos, guardarlos antes de entregar resultado

Si una skill NO tiene acceso a Neurox tools, debe documentar en su output qué
información valdría la pena guardar para que el orquestador lo haga.

## Reglas críticas

- NUNCA guardar cambios triviales (typos, formato)
- NUNCA guardar info ya en git history
- Usar `topic_key` para temas que evolucionan — mismo `topic_key` = upsert, no duplicado
- Namespace = nombre del directorio del proyecto (ej: `api-core`, `neurox`, `skills`)
- Para memoria cross-project o preferencias personales: omitir namespace o usar `"default"`
- No inferir identidad del usuario desde git history — usar `neurox_recall` con query explícito
- Búsqueda cross-namespace (sin filtro) es OBLIGATORIA antes de tareas de producto — puede haber contexto valioso en otros proyectos

## Namespace convention

```
proyecto específico:  namespace="{project-dir-name}"
preferencias globales: namespace="default" o sin namespace
cross-project search: neurox_recall sin namespace (busca en TODO)
```
