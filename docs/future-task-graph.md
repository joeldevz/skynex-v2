# Future Task Graph — Architectural Reservation

The Task Graph is not part of the installer MVP and no graph scheduler will be implemented now.

## Reserved principles

- The graph is a Skynex-owned capability, not a copied Claude API.
- Nodes will invoke application-level capabilities through ports.
- Target installers and transformers remain independent of scheduling.
- Resource identities are stable inputs that a future graph may reference.
- Provider-specific sessions, agents, and hooks remain adapters or installed artifacts.
- Durable execution state will be designed from actual orchestration journeys, not inherited from
  the previous `skynex workflow` machinery.

## Explicitly deferred decisions

- DAG schema and dynamic graph mutation.
- Scheduler, concurrency, and worktree ownership.
- Persistence technology.
- Agent result envelopes and retry policy.
- Wayfinder/discovery graph.
- UI visualization.

## Compatibility seam

Application use cases should expose explicit command/query interfaces and return typed results.
The CLI is one caller today; a graph coordinator may become another caller later. No installer
aggregate may acquire `nodeId`, `workflowId`, dependencies, leases, or scheduling status merely to
anticipate that future.
