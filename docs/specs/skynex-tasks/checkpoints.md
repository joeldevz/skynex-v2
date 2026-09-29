# Steps: checkpoints legibles y proporcionales

> Parte de [Skynex Tasks](README.md). Propuesta, no implementación.

## Definición

Un **Step** representa **una decisión o entrega verificable**, no cada archivo editado
ni cada llamada a un agente. Es la unidad que una persona revisa y sigue.

Un paso debe caber en la cabeza de quien lo lee. Si para entenderlo hay que leer un
muro de texto generado, está mal dimensionado.

## Campos mínimos

| Campo | Obligatorio | Propósito |
| --- | --- | --- |
| `id` | Sí | Identidad estable (`step-001`). No se reutiliza para otro trabajo |
| `title` | Sí | Una línea, lenguaje llano |
| `scope` | Sí | Qué entra y, sobre todo, qué **no** entra |
| `doneWhen` | Sí | Criterio observable de terminado |
| `expectedEvidence` | Sí | Qué comprobación o revisión se espera |
| `dependsOn` | No | Otros pasos, solo cuando hay dependencia real |
| `status` | Sí | `pending` \| `in_progress` \| `done` \| `blocked` |
| `instructionPath` | Sí | Documento propio del paso |

El detalle técnico (IDs de intento, nodos, base, candidato, manifiestos) **no** se
muestra en la vista principal: se guarda en el registro del paso y en los
checkpoints (ver [domain.md](domain.md)).

## Proporcionalidad

| Trabajo | Cómo se presenta |
| --- | --- |
| **Pequeño** — cambio localizado, criterio claro | Sin tarea persistida por defecto. Si el usuario quiere registrarlo: **un** paso |
| **Mediano** — varios archivos o lógica moderada | **2–4 pasos**, solo donde haya dependencia o frontera real |
| **Grande / alto riesgo** — contratos públicos, seguridad, migraciones | Pasos con alcance y riesgos explícitos; plan persistido para poder retomarlo |

Los números son una guía, **no una cuota**. Dividir por dividir es un anti-patrón.

## Ejemplo de paso

```md
# step-002 — Exponer el resultado en la CLI

Alcance: salida del comando. No cambia la lógica interna ni las opciones existentes.
Terminado cuando: el formato `--json` coincide con el acordado y la salida
  actual conserva su forma.
Evidencia esperada: comprobación focalizada del formato y resultado de tipos/build
  aplicable al paquete tocado.
Depende de: step-001 (formato acordado).
No incluye: refactorizar otras opciones del comando.
```

## Vista de progreso

La misma lista se **actualiza**; no se reescribe la historia.

```text
Objetivo: añadir salida JSON al comando de diagnóstico

✓ step-001 Definir formato y compatibilidad
    Evidencia: contrato revisado; alcance congelado

▶ step-002 Implementar la salida
    Terminado cuando: formato válido y salida existente intacta
    Evidencia pendiente: comprobación focalizada + tipos

○ step-003 Verificar el conjunto
    Depende de: step-002
```

## Transiciones y honestidad del estado

- `pending` → `in_progress` → `done` solo con la **evidencia esperada** presente.
- `blocked` exige **causa concreta**: falta de acceso, contradicción, espera humana,
  o fallo con recuperación definida.
- Declarar un paso terminado registra una **declaración**, no una aprobación. Thalam
  decide si la evidencia cubre el criterio.
- Si aparece trabajo nuevo, el alcance cambia **explícitamente**; no se marca
  retroactivamente como aprobado lo que no se comprobó.
- Los IDs de pasos retirados no se reutilizan.

## Anti-patrones

| Anti-patrón | Por qué |
| --- | --- |
| Un paso por archivo o por agente | Convierte el plan en ruido; nadie lo revisa |
| Pasos encadenados sin dependencia real | Rigidez falsa; bloquea el trabajo paralelo real |
| Repetir el plan completo en cada instrucción | Duplica y desincroniza |
| Volcar logs y salidas completas en la vista | Oculta lo importante; el detalle va a evidencia |
| Usar `done` como sinónimo de aprobado | Confunde ejecución con aceptación |
| Pedir aprobación humana por cada paso rutinario | Convierte el flujo en ceremonia |

## Límites

Un orden de pasos es una convención legible, **no** un DAG ejecutable ni un
scheduler. Nadie ejecuta automáticamente el siguiente paso al cerrar el anterior.
