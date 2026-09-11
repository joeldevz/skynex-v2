# Skynex v2

Skynex v2 is a ground-up TypeScript rewrite focused first on safely installing
canonical Skynex resources into AI coding engines.

The first target is OpenCode 2. The architecture deliberately separates:

- canonical, portable resource intent;
- target-specific transformation and native assets;
- transactional installation and user-controlled updates;
- future Skynex-owned capabilities such as a task graph.

## Status

Installer candidate implementation is present, including transactional install,
update, uninstall, backup/restore, doctor, OpenCode 2 resource transformation,
and an optional isolated runtime probe. The checked-in resources are starter/demo
agents, skills, and commands; they are not the production-complete canonical set.
The Skynex task graph remains deferred. This repository is not a published
release.

## Development

Requires Node.js 24+ and pnpm 10.

```sh
pnpm install
pnpm check
pnpm build
pnpm verify:installer
pnpm verify:opencode
```

See [`docs/README.md`](docs/README.md) for the product and implementation plan.
See [`docs/runtime-verification.md`](docs/runtime-verification.md) for the
runtime probe prerequisites and evidence format; it does not assert that a
verification run has passed.

## Installer preview

Build and try the interactive installer against a project:

```sh
pnpm build
node apps/cli/dist/index.js install --project /path/to/project
```

For an isolated trial, use a disposable project under `/tmp/opencode` (for
example, create one with `mktemp -d /tmp/opencode/skynex-project-XXXXXX`) rather
than pointing at a user's existing configuration. Do not remove or overwrite
user files as part of verification. The plugin and prompt hook are executable;
interactive installation asks for confirmation, and noninteractive installation
requires explicit executable-plugin consent.

Available lifecycle commands:

```text
skynex install
skynex update
skynex uninstall
skynex doctor [--json]
skynex backup list
skynex backup restore <transaction-id>
```

OpenCode 2 receives a managed configuration entry, one starter agent, skill and
command, plus the explicit `./skynex/plugins/runtime` plugin and its prompt hook.
Use `--dry-run` to preview without writing. Automated update refuses locally
modified resources instead of resolving them silently.

Noninteractive plugin installation additionally requires `--yes` and
`--allow-executable-plugins`. The optional `verify:opencode` check requires an
`opencode2` executable (or `OPENCODE2` pointing to one), starts it in the
foreground in an isolated `/tmp/opencode` fixture, and checks health plus the
local plugin export without making LLM/provider requests. See
[`docs/security-model.md`](docs/security-model.md) for the trusted-local threat
model and the documented Node filesystem limitation.

## License

Apache-2.0.
