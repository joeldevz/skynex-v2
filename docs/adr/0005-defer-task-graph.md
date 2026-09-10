# ADR 0005 — Defer the Task Graph

## Status

Accepted.

## Decision

Do not implement graph orchestration in the installer MVP. Preserve clean application ports so a
future Skynex-owned graph can invoke capabilities without changing target integrations.

## Consequences

The rewrite avoids speculative workflow machinery while retaining an intentional extension seam.
