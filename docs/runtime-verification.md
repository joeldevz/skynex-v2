# Isolated OpenCode V2 runtime verification

The runtime probe is deliberately separate from installer/build verification. It
never uses the shared OpenCode service or the user's configuration/database.

```sh
OPENCODE2=/home/clasing/.opencode/bin/opencode2 node scripts/verify-opencode2.mjs
```

This default mode copies the two native resource files into their manifest layout
inside a fresh `/tmp/opencode/skynex-runtime-*` fixture. It is **resource-fixture**
evidence, not proof that the current installer produced those files.

After the installer owner supplies a clean, freshly installed fixture:

```sh
OPENCODE2=/home/clasing/.opencode/bin/opencode2 node scripts/verify-opencode2.mjs \
  --installed-config-dir /tmp/opencode/INSTALLER_FIXTURE/.opencode
```

The input must be an isolated fixture under `/tmp/opencode`, with one
`opencode.json` or `opencode.jsonc`, containing only `$schema` and the single
`./skynex/plugins/runtime` registration. The probe copies that config byte-for-byte
and the installed `index.ts` / `prompt.ts` into a new isolated project. It rejects
symlinked source paths, remote/package registrations, and ancestor OpenCode config.
It uses the target package's existing `jsonc-parser`; it does not install anything.

## What constitutes success

The script starts the existing binary as a **foreground** server with
`serve --hostname 127.0.0.1 --port 0`. HOME, all four XDG directories, TMPDIR, cwd,
and environment are isolated. No inherited `OPENCODE_*`, provider credentials,
`NODE_OPTIONS`, or service/auth settings are passed. A lower-precedence global
fixture config disables all builtins, while the installed project registration
loads the local runtime plugin. The foreground-generated password is used only
in memory for authenticated loopback HTTP, and redacted from the saved stdout log.

Success requires all of these, not just `--help` or a config string:

1. `/api/health` identifies the exact child PID and reports healthy.
2. `/api/plugin/await-activation` settles.
3. `/api/plugin` reports exactly one `skynex.runtime` export, `features.server:
   true`, `state.status: active`, and the local snapshot source path.
4. The reported location is the isolated project.

An active export proves the real resource loaded and its setup completed; this
probe does **not** submit prompts or claim a model-driven prompt hook execution.
No provider/auth discovery, inference, plugin update, package installation, or
shared service management endpoints are called. No resource implementation is
replaced with a fake probe. Exit status is nonzero on failure.

The script bounds startup (20 seconds), HTTP requests (10 seconds each), and server
lifetime (45 seconds), then reconciles its child using SIGTERM / a five-second
grace / SIGKILL. Each fixture retains `evidence.json`, redacted `server.log`, and
its own OpenCode data for inspection. Evidence includes binary/version/PID, script,
manifest, config and resource SHA-256 digests, source mode, API result, and exit.
Retained directories are not shared-service data and are not committed.

## Final installed-snapshot verification on Node 24

The final installed-artifact probe passed using Node **v24.21.0** at
`/tmp/opencode/skynex-node24-jo0uje_k/node-v24.21.0-linux-x64/bin/node`.
Both commands below exited zero, with an allowlisted environment and fresh
HOME/XDG/TMPDIR directories. This latest installation/probe followed the final
delivery-5 policy rejecting even byte-identical unmanaged-file collisions. The other owners' Node 24 check, build, and
installer regression checks were not repeated. Source and executed dist digests
were captured before execution and confirmed unchanged afterward.

```sh
NODE=/tmp/opencode/skynex-node24-jo0uje_k/node-v24.21.0-linux-x64/bin/node
FIXTURE=/tmp/opencode/skynex-final-install-6lhcwo68
# Executed with PATH scoped to the Node 24 bin directory plus /usr/bin:/bin:
"$NODE" apps/cli/dist/index.js install --project "$FIXTURE/project" \
  --state-dir "$FIXTURE/state" --yes --allow-executable-plugins
"$NODE" scripts/verify-opencode2.mjs \
  --installed-config-dir "$FIXTURE/project/.opencode"
```

The real CLI installed six files, wrote the isolated state lock, and created
backup transaction `3adb7aaf-1b66-40a5-966d-654c32fdc9fa`. The probe copied the
actual installed JSONC configuration and native files without changing their
bytes. Both installed native files were also compared byte-for-byte with current
catalog resources. Their SHA-256 values are listed in the resource-fixture
section below. Installed config SHA-256:

```text
805868194c88f2e9f896c48ae996acf1719ad5abd24aed7ac9d8890bc584491d
```

OpenCode **0.0.0-beta-19425** reported exactly one `skynex.runtime` export with
`features.server: true`, `state.status: active`, and local source
`/tmp/opencode/skynex-runtime-0UuTA8/project/.opencode/skynex/plugins/runtime/index.ts`.
Health identified the exact owned foreground PID **1571866**, listening at
`http://127.0.0.1:44343`. The server was terminated after verification and its PID
was confirmed absent.

Evidence retained locally:

- `/tmp/opencode/skynex-final-install-6lhcwo68/final-verification.json`: delivery-5 identity, commands,
  exits, all six installed-file hashes, source/CLI-dist hashes, and runtime result.
- `/tmp/opencode/skynex-final-install-6lhcwo68/{install,runtime}.stdout`
  and corresponding `.stderr` files.
- `/tmp/opencode/skynex-runtime-0UuTA8/evidence.json`: isolated runtime receipt.

Latest verified code-round SHA-256 identities:

```text
apps/cli/src/index.ts: 26f2dfe4b6ad2aecdfed5ce1b19f99e1e5e43c2e485c2aee97a71b02177c0f8e
packages/catalog/src/schema.ts: 70e389b401ec09a41b193e249cc8a5bdfc976c8f90fb63ae89ec431da95e3ce8
packages/installer/src/uninstall.ts: 40d08434a50c77cac910d95e0494f3450f52f4b30d0677ccb07b5fefb57222ee
packages/installer/src/index.ts: 7a4dedd4692184c6af2568a25a49b5e8dde187be64def7e80a3b62976e27e6cb
packages/installer/dist/index.js: 16e5bbc0199aff725bea928bc09de1e85b1c23b021468a20354817782fc83b3f
packages/catalog/src/load-catalog.ts: 06b157d811f97a00704c1817c4b1fea6181bebf118f51f2adf262ad44f13a3d7
apps/cli/dist/index.js: 0cfe77e9e8470b81013a3fe02fa96bafa2c2298268aeea7f70881ab382eaa46f
packages/catalog/dist/schema.js: e4f320a4b7485c50c58b230493045d1d8bdfb4be6dd6643fd429687577cdc760
packages/installer/dist/uninstall.js: 2c0fcc4130093b0c6f67a1be577627192e575a24a69c4172eab6e9b7e0a3ee3e
```

This passes the **installed configuration/native plugin snapshot** gate. It proves
runtime setup and prompt-hook registration, **not execution of a prompt-hook
event**. No prompts, provider discovery, inference requests, dependency downloads,
or shared-service changes were performed. It does not independently verify the
installed agent/skill/command behavior inside OpenCode or provide release-wide
security acceptance.

## Earlier resource-fixture verification on Node 24

After the native owner removed the runtime dependency on `@opencode/plugin`, one
resource-fixture probe completed successfully with this exact command:

```sh
/tmp/opencode/skynex-node24-jo0uje_k/node-v24.21.0-linux-x64/bin/node \
  scripts/verify-opencode2.mjs
```

The harness ran on **v24.21.0**; the foreground OpenCode server reported
**0.0.0-beta-19425**. Its plugin API returned the actual `skynex.runtime` export,
`features.server: true`, `state.status: active`, and source
`/tmp/opencode/skynex-runtime-tOlsfd/project/.opencode/skynex/plugins/runtime/index.ts`.
Health identified the exact child PID, 1404322. The probe exited successfully,
terminated its foreground child, and retained evidence at
`/tmp/opencode/skynex-runtime-tOlsfd/evidence.json`.

Resource SHA-256 values:

```text
index.ts: ee2b4d72b4e7f0f859739a963633780a502422f04c300e7759947ad6ff458303
prompt.ts: 831ba19799445754976bc4895e2c7358550272b0f4223db46f218d181943f68d
```

This proves **native resource loading and completed setup**, not the final
installer-produced artifact or a model-driven prompt-hook invocation. The
subsequent installed-snapshot gate is recorded above.
No build, installation, dependency download, or inference was performed for this
resource-fixture probe.

## Historical blockers in the initial closure attempt

On 2026-09-11, `/usr/bin/node` reported `v26.8.1` and the existing
`/home/clasing/.opencode/bin/opencode2` reported `v0.0.0-beta-19425`.
The bounded Node lookup found no usable Node 24 in `/usr/local/bin`, `/opt`,
`~/.nvm/versions/node`, `~/.local/share/fnm/node-versions`,
`~/.volta/tools/image/node`, or `~/.local/share/mise/installs/node`.

The actual resource-fixture probe reached healthy foreground HTTP, but the real
plugin failed to load: `Cannot find package '@opencode/plugin' imported from .../index.ts`.
The API reported `state.status: failed`; this is **not** successful integration.
No matching installed `@opencode/plugin` was found by the bounded repository and
`~/.opencode` lookup. The native owner subsequently removed that runtime import;
the successful resource-fixture result above supersedes this failure. The probe
neither downloads that package nor alters the resource.

### Approved isolated Node 24 acquisition

The initial attempt did not download a runtime. After explicit user approval,
provisioning created `/tmp/opencode/skynex-node24-jo0uje_k`, downloaded
`https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz` and the same
version's `SHASUMS256.txt`, verified SHA-256 against both the official file and
the pinned digest, and extracted **only into that new directory**. The resulting
absolute `bin/node --version` returned `v24.21.0`. No shell profile, global symlink, system Node,
package-manager config, or shared service changes are necessary. Existing Node
remains the fallback; no existing file was overwritten. Before downloading,
`preinstall-manifest.json` recorded the existing runtime path/version/digest and
the no-overwrite scope. `provision-evidence.json` records the resulting binary
and archive hashes; both files are in that isolated provisioning directory.

The official `latest-v24.x/SHASUMS256.txt` live read identified v24.21.0 and the
Linux x64 xz digest:

```text
fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
```

This is an HTTPS checksum source, **not a verified release signature**. Signature
verification was not performed. Acquire/validate release signing material only
under an additional approved acquisition procedure if required.

## Authoritative references

- https://opencode.ai/v2/docs/cli
- https://opencode.ai/v2/docs/cli/web (foreground server and generated password)
- https://opencode.ai/v2/docs/plugins (relative config paths and disable directives)
- https://opencode.ai/v2/docs/build/plugins (setup and active plugin exports)
- https://opencode.ai/v2/docs/api
- https://opencode.ai/v2/openapi.json (plugin state/source schemas)
- https://opencode.ai/v2/docs/troubleshooting
- https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
