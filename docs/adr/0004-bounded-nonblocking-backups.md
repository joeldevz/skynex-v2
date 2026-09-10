# ADR 0004 — Bounded, non-blocking backups

## Status

Accepted.

## Decision

Snapshot only existing files selected for mutation in the accepted plan. Historical backup reads,
retention, and cleanup are not prerequisites for installing unrelated resources.

## Consequences

Failure to protect a file about to be changed blocks that transaction before mutation. Problems
with old or unrelated backups are reported as warnings and never trigger broad target scans.
