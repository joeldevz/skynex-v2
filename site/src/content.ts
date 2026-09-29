// Contenido de producto extraído de skynex-v2 (README, packages/npm-cli, `skynex --help`).

export const PACKAGE = '@skynex-ai/cli';

export type InstallTab = { id: string; label: string; command: string };

export const installTabs: InstallTab[] = [
  { id: 'npm', label: 'npm', command: `npm install --global ${PACKAGE}` },
  { id: 'pnpm', label: 'pnpm', command: `pnpm add --global ${PACKAGE}` },
  { id: 'bun', label: 'bun', command: `bun add --global ${PACKAGE}` },
  { id: 'npx', label: 'npx (sin instalar)', command: `npx ${PACKAGE} --help` },
];

export type Command = { cmd: string; desc: string };

export const commands: Command[] = [
  { cmd: 'skynex install --project <dir>', desc: 'Instala agentes, skills y comandos en <dir>/.opencode.' },
  { cmd: 'skynex install --global', desc: 'Instala en ~/.config/opencode. Los plugins solo se instalan así.' },
  { cmd: 'skynex update', desc: 'Actualiza. Se detiene si has modificado algún recurso a mano.' },
  { cmd: 'skynex uninstall', desc: 'Retira todo lo que gestiona Skynex.' },
  { cmd: 'skynex doctor [--json]', desc: 'Comprueba el estado de la instalación.' },
  { cmd: 'skynex backup list', desc: 'Lista las copias de seguridad, una por transacción.' },
  { cmd: 'skynex backup restore <id>', desc: 'Devuelve la instalación a esa transacción.' },
  { cmd: 'skynex task init "<título>"', desc: 'Crea una tarea en .skynex/tasks.' },
  { cmd: 'skynex task next add "<paso>" …', desc: 'Añade un paso con --scope, --done-when y --evidence.' },
  { cmd: 'skynex task next done <paso>', desc: 'Marca un paso como hecho.' },
  { cmd: 'skynex task status [--json]', desc: 'Muestra la tarea y sus pasos.' },
];

export const flags: Command[] = [
  { cmd: '--dry-run', desc: 'Enseña los cambios sin escribir nada.' },
  { cmd: '--yes', desc: 'Aplica sin pedir confirmación (solo cambios seguros).' },
  { cmd: '--allow-executable-plugins', desc: 'Necesario junto a --yes para instalar plugins.' },
  { cmd: '--components <lista>', desc: 'configuration, agents, skills, commands, plugins.' },
  { cmd: '--state-dir <ruta>', desc: 'Guarda el estado de Skynex en otra carpeta.' },
];
