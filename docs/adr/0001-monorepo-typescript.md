# ADR 0001 — TypeScript monorepo

## Status

Accepted.

## Decision

Use one pnpm monorepo on Node.js LTS with TypeScript 7 and ESM. Workspace packages remain private
under a provisional internal scope until product naming and publication are decided.

## Consequences

Cross-boundary changes remain atomic and tooling is shared. Package dependency rules must prevent
the domain from importing target or infrastructure code.
