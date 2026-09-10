# ADR 0002 — Canonical and native resources

## Status

Accepted.

## Decision

Maintain semantically portable resources once as canonical intent and compile them per target.
Keep behavior without a faithful portable representation as target-native resources.

## Consequences

Equivalent resources avoid duplication without forcing plugins, hooks, or TUI features into a
lowest-common-denominator abstraction. Both forms enter the same installation lifecycle.
