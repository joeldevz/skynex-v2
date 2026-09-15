# Skynex CLI

Install and manage Skynex resources for OpenCode 2. Requires Node.js 24 or newer.

```sh
npm install --global @skynex-ai/cli
npx @skynex-ai/cli --help
```

Commands include `install`, `update`, `uninstall`, `backup`, and `doctor`. Use `--dry-run` to preview changes. Mutating operations ask for confirmation unless `--yes` is supplied. Executable plugins are installed only with explicit `--allow-executable-plugins`; review them before enabling them.

Project installs write `.opencode` and the selected state directory. Global installs use the OpenCode configuration directory under `XDG_CONFIG_HOME` and Skynex state under `XDG_STATE_HOME` (or platform defaults).

Licensed under Apache-2.0.
