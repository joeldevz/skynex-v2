# Installer security model

Skynex v2 currently targets a single trusted local operator installing into their
own OpenCode 2 configuration. It rejects traversal, malformed persisted state,
symlink roots and destinations, concurrent Skynex transactions, and unexpected
digest changes.

## Trust boundary

The current Node.js implementation does not claim resistance to a malicious local
process that can replace directory components between an `lstat` check and a later
filesystem mutation. Eliminating that TOCTOU class requires descriptor-relative
native operations such as `openat` with `O_NOFOLLOW`, which are outside the portable
Node 24 API used by this release.

Do not run the installer while an untrusted process can modify the selected target
or state roots. Multi-user or adversarial-local installations require a future
native filesystem backend.

## Executable extensions

The OpenCode plugin and hook are executable code. Interactive installation displays
this fact before confirmation. Noninteractive installation requires both `--yes`
and `--allow-executable-plugins`.

## Transaction durability and recovery

The executor exclusively creates each backup directory; transaction IDs cannot
reuse or overwrite an existing backup. Before changing targets it writes snapshots,
exact prior-lock bytes, and the manifest using exclusive temporary files, file
`sync`, close, rename, and parent-directory `sync`. Newly created directories are
also synced with their parents. Target and lock writes use the same protocol;
deletions sync their parent. A synced completion record precedes lease release.
These operations require filesystem support for directory fsync (verified here on
Linux); unsupported sync operations fail rather than silently weakening durability.
This is not multi-file atomicity or a guarantee of power-loss immunity: storage
hardware, filesystem semantics, and crashes between operations remain relevant.

Rollback uses only captured prior state and only changes the lock if this executor
actually changed it. Failures before mutation release only the owned lease.
After mutation, `recovery.json` records the transaction, restored/unreconciled paths,
lock path and backup root. Incomplete rollback or failure to persist that record
retains the lease. Do not delete a retained lease blindly: inspect the snapshots,
manifest and recovery record, reconcile the listed paths and exact prior lock,
then explicitly release it. A crash may leave only the prepared manifest and lease;
there is no automatic crash-recovery command in this release.

## Verification boundaries

`verify:installer` uses isolated `/tmp/opencode` fixtures and real planner, apply,
uninstall and restore APIs. Assertions cover exact present/absent lock restoration,
reverse restoration, uninstall snapshots, lease ownership and commit lifetime,
local edits with valid and invalid locks, read-lock failure, commit-failure rollback
and recovery fields, valid-ID/wrong-path ownership, intermediate ancestor symlinks,
and snapshot corruption. Fault injection is an internal executor dependency seam,
not a CLI flag. These checks do not simulate power loss or prove TOCTOU resistance.

`verify:opencode` is an optional isolated runtime probe. It starts the configured
`opencode2` executable as a foreground loopback service, checks `/api/health`, and
verifies that exactly one `skynex.runtime` plugin export is active and resolved
from the isolated local snapshot. It makes no LLM or provider requests. The probe
uses a disposable `/tmp/opencode` fixture and writes redacted logs/evidence there;
it does not modify a user's configuration. The executable must be available at
the default local path or via `OPENCODE2`.

Node 24 is the declared baseline. The final runtime closure ran `pnpm check`, a
real CLI installation into a fresh isolated project/state directory, and the
installed-snapshot runtime probe on Node v24.21.0; all exited zero. The plugin API
reported exactly one active local `skynex.runtime` export from the byte-preserved
installed config/native snapshot. This proves setup and hook registration, not
execution of a prompt-hook event; no prompt or provider inference was submitted.
The owned foreground server was terminated and its PID confirmed absent. See
[runtime verification](runtime-verification.md) for exact commands, hashes, and
fixture evidence. These checks do not simulate power loss, prove TOCTOU resistance,
or substitute for release-wide security review.
