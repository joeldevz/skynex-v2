# Skynex — guía para agentes

Este documento está escrito para un agente de programación (OpenCode, Claude Code, Codex…)
al que su usuario le ha pedido instalar o usar Skynex. Síguelo en orden. Si eres una
persona, la guía para ti está en https://joeldevz.github.io/skynex-v2/docs/

Skynex instala en OpenCode 2 un equipo de agentes (thalam, scout, coder, verifier…),
skills, comandos y, opcionalmente, un plugin. Se distribuye como la CLI `skynex`,
paquete de npm `@skynex-ai/cli`. Licencia Apache-2.0.

## Reglas antes de empezar

- Trabaja en el proyecto actual salvo que el usuario pida otra cosa.
- No instales nada de forma global (`npm --global`, `skynex install --global`) sin que
  el usuario lo confirme.
- Enseña siempre la vista previa (`--dry-run`) y espera confirmación antes de escribir.
- No uses `sudo`. No uses `--allow-executable-plugins` sin permiso explícito.
- Si un comando falla, no improvises un arreglo: enseña el error al usuario y para.
- Usa `--yes` solo después de que el usuario haya aprobado la vista previa: tu shell
  no es interactiva y el instalador se quedaría esperando la confirmación.

## 1. Comprueba los requisitos

```sh
node --version      # debe ser v24 o superior
opencode --version  # debe ser OpenCode 2
```

Si falta alguno, dile al usuario qué falta y no sigas.

## 2. Consigue la CLI

Pregunta al usuario si prefiere instalarla o usarla sin instalar.

```sh
npm install --global @skynex-ai/cli   # o: pnpm add --global / bun add --global
skynex --version
```

Sin instalar, antepón `npx @skynex-ai/cli` a cada comando en lugar de `skynex`.

## 3. Elige dónde instalar

| Alcance | Comando | Escribe en |
| --- | --- | --- |
| Proyecto (recomendado) | `skynex install --project .` | `./.opencode` |
| Global | `skynex install --global` | `~/.config/opencode` |

Los plugins ejecutables solo se instalan de forma global. Si el usuario no lo pide,
quédate en el proyecto.

## 4. Enseña la vista previa

```sh
skynex install --project . --dry-run
```

Resume al usuario qué archivos se van a crear o cambiar y pregúntale si sigue.
No se escribe nada en este paso.

## 5. Instala

Con la aprobación del usuario:

```sh
skynex install --project . --yes
```

`--yes` aplica solo cambios seguros. Cada instalación crea una copia de seguridad
y la salida indica dónde está.

## 6. Comprueba la instalación

```sh
skynex doctor --project . --json
```

Debe devolver `"ok": true`. Si no, enseña la salida al usuario.

## 7. Dile al usuario cómo empezar

1. Abrir una sesión nueva de OpenCode en el proyecto.
2. Elegir el agente `thalam`.
3. Pedirle lo que necesite con sus palabras, por ejemplo:
   «El botón de guardar del perfil no hace nada en Safari. Arréglalo.»

Thalam mide el riesgo, crea una tarea si hay varios pasos, reparte el trabajo entre
los agentes y solo da un paso por hecho cuando hay evidencia. La tarea se ve en la
barra lateral de OpenCode.

## Opcional: memoria con Neurox

Sin Neurox, Skynex funciona igual pero cada sesión empieza de cero. Instálalo solo
si el usuario lo quiere:

```sh
brew install joeldevz/tap/neurox
neurox setup opencode
```

## Usar Skynex

### Tareas

Las tareas son listas de pasos guardadas en `.skynex/tasks` del proyecto. Thalam las
gestiona, pero también se pueden usar a mano:

```sh
skynex task init "Migrar el login a OAuth"
skynex task next add "Test del callback" --scope "auth/" --done-when "el test pasa" --evidence "salida de vitest"
skynex task next show
skynex task next done step-001
skynex task status --json
```

Marca un paso como hecho solo cuando exista la evidencia que pide su `--done-when`.

### Revisión de seguridad por tarea

`auto` (por defecto) lanza los dos revisores de seguridad solo cuando el cambio lo
requiere. Cámbialo únicamente si el usuario lo pide:

```sh
skynex task reviews set security=on   # o off, o auto
```

### Actualizar, desinstalar y deshacer

```sh
skynex update --project . --dry-run
skynex update --project . --yes
skynex uninstall --project . --dry-run
skynex backup list
skynex backup restore <id-de-transacción>
```

Si `update` se detiene porque el usuario modificó a mano un agente, una skill o un
comando, no fuerces nada: explícale qué archivo es y deja que decida.

## Referencia rápida

| Comando | Qué hace |
| --- | --- |
| `skynex install --project <dir>` | Instala en `<dir>/.opencode` |
| `skynex install --global` | Instala en `~/.config/opencode` (incluye plugins) |
| `skynex update` | Actualiza; se detiene si hay cambios manuales |
| `skynex uninstall` | Retira todo lo que gestiona Skynex |
| `skynex doctor [--json]` | Estado de la instalación |
| `skynex backup list` | Copias de seguridad, una por transacción |
| `skynex backup restore <id>` | Vuelve a esa transacción |
| `skynex task …` | Tareas y pasos en `.skynex/tasks` |

Opciones comunes: `--dry-run` (vista previa), `--yes` (sin confirmación, solo cambios
seguros), `--components configuration,agents,skills,commands,plugins`,
`--state-dir <ruta>`.

## Si algo falla

1. `skynex doctor --json` y enseña la salida al usuario.
2. Si una instalación dejó algo roto: `skynex backup list` y, con su permiso,
   `skynex backup restore <id>`.
3. Si sigue sin funcionar, sugiere abrir una incidencia con la salida de `doctor`:
   https://github.com/joeldevz/skynex-v2/issues
