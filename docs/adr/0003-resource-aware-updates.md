# ADR 0003 — Resource-aware updates

## Status

Accepted.

## Decision

Update managed resources through a three-way comparison: previous upstream, current local, and
next upstream. Skills and agent prompts expose upstream changes and require a visible per-resource
decision when local customization exists.

## Consequences

The lockfile stores source and installed digests separately. Keeping a local version cannot be
misrepresented as accepting the new upstream version.
