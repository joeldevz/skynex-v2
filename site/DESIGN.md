# Skynex — plan de diseño (v3)

Skill aplicada: `frontend-design`. Referencia visual elegida en Mobbin: **Duna**
(«The new standard in compliance»): paisaje pintado que se funde en blanco, titular
limpio centrado, botones píldora oscuros y paneles de cristal oscuro sobre el paisaje.

## Sujeto y tarea de la página

- Skynex instala en OpenCode un equipo de agentes que trabaja por pasos; cada paso
  tiene un «hecho cuando» y una evidencia.
- Home = beneficios y llevar a instalar. Documentación en `/docs/`, historial en `/cambios/`.

## Tokens

| Nombre   | Hex       | Uso                                         |
| -------- | --------- | ------------------------------------------- |
| Hueso    | `#fbfaf8` | fondo; el paisaje se funde en este color    |
| Tinta    | `#1c1917` | texto, botones, bloques de terminal         |
| Piedra   | `#625b55` | texto secundario                            |
| Línea    | `#e0dad3` | separadores                                 |
| Melocotón| `#f5c48a` | casillas marcadas, subrayado del veredicto  |
| Rosa lago| `#f2b7a8` | viñetas y subrayado de enlaces en docs      |

- Texto y titulares: **Hanken Grotesk** 400–600, titulares en peso normal con
  interletrado negativo (nada de negritas gritonas).
- Utilidad: **IBM Plex Mono** para comandos, nombres de agentes y metadatos.

## Movimiento

- **Intro del hero:** la cámara empieza pegada a la pradera y se aleja hasta ver
  el paisaje entero (~4 s); después aparecen «Skynex», la descripción y los botones.
  Si el usuario hace scroll, pulsa una tecla o toca la pantalla, la intro termina.
- **Así trabaja:** tres tareas de ejemplo que se ejecutan paso a paso en bucle
  (pendiente → trabajando → hecho con evidencia → veredicto). Solo avanza cuando la
  tarjeta está en pantalla; las pestañas permiten saltar a una tarea.
- **Por dentro:** ilustraciones pequeñas en bucle (señales saliendo del tálamo y un
  recuerdo que baja de buffer a core).
- Con `prefers-reduced-motion` todo aparece ya terminado y sin bucles.

## Por dentro (contenido)

- Thalam viene del **tálamo**, que reparte las señales al área que toca.
- Neurox es la memoria local (SQLite) con capas buffer → working → core.
- Skynex es un **guiño a Skynet**: aquí los agentes piden permiso y enseñan pruebas.

## Paisaje

`public/paisaje.svg`, generado por `scripts/paisaje.mjs` (determinista): cielo,
nubes con desplazamiento fractal, montañas, lago con reflejo y pradera con flores.
Se reutiliza en el hero, en el cierre de la home (espejado) y como franja superior
de `/docs/` y `/cambios/`.

## Qué se descartó y por qué

- v1 (Giga): negro + acento naranja + resplandor → el look «IA» por defecto.
- v2 (libreta de ingeniería): distinta, pero descartada por el estilo.
- Sin franjas de cifras, sin rejillas de iconos, sin texto en degradado,
  sin animaciones al hacer scroll.
