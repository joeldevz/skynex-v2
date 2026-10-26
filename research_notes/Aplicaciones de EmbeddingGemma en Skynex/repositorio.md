# Repository findings

Read-only scout, NodeID repo, WorkflowID eg2-research-20261012, AttemptID a1, supplied basis tree 6525caf268462ae88c6163d4a7edafaa4adf69a7. Ten bounded read/search operations, no modifications or execution. Basis Git inspection belongs to coordinator.

All proposed embedding integrations below are hypothetical, not existing behavior.

## Concrete boundaries and opportunities

- Agent/skill recommendation: targets/opencode/resources/canonical/agents/thalam.md:238-267 requires bounded briefs, accepted decisions and explicit scope. Similarity could recommend candidates, never grant permissions or dispatch automatically.
- Classifier: targets/opencode/resources/native/plugins/skynex-runtime.ts:68-128 and :240-283 uses TypeSafe jev-1.13.0, validates choices/probabilities and reports unavailable provider. :289-296 accepts request/context strings. Embeddings are not a drop-in equivalent of this contract; examples or atypical-request hints are a proposal.
- Task duplicates/clusters: packages/tasks/src/service.ts:105-128,391-401 uses title slug and numeric suffixes, not semantic matching. :358-368 stores scope, done criteria, expected evidence. Similarity could suggest existing tasks, not merge or adopt identity.
- Failure grouping: packages/tasks/src/service.ts:331-350 exposes blocked steps and blockReason; targets/opencode/resources/canonical/agents/verifier.md:198 specifies structured findings. Grouping similar descriptions is not diagnosis or proof of common cause; historical failure store not established.
- Reviews: packages/tasks/src/service.ts:278-304 reads/updates validated review settings; :265-274 returns declared:true,approved:false for step completion. Similarity cannot disable reviews or approve completion.
- Context: targets/opencode/resources/canonical/agents/thalam.md:109-125 makes Neurox advisory, not authority. :238-267 specifies compact brief/evidence. Selection and dedup need provenance, freshness and permission checks.
- Profiles: packages/sky-agents/src/profiles.ts:12-19 validates agent-model assignments; packages/sky-agents/src/index.ts:21 binds preview to a SHA256 digest. Profile recommendation would require actual capability/cost evidence, not model-name similarity.
- Multimodal input: no attachment ingestion boundary confirmed in inspected code. An eventual screenshot/audio mapping feature requires new ingestion and encoder support, rather than assuming existing UI integration.
- Tasks is not scheduling: targets/opencode/resources/canonical/agents/thalam.md:146-150 explicitly excludes scheduling, resumption, prioritization and authorization. packages/tasks/src/service.ts:34-65 shows task/step/review API; :309-324 provides read-only UI facade.

## Gaps

Full skill resolver, attachment ingestion, installer comparator and historical failure storage were outside bounded inspection. Public Neurox optional wording site/public/docs/agentes.md:88-90 differs from shared protocol mandatory wording targets/opencode/resources/canonical/skills/_shared/neurox-protocol.md:7-9; Thalam permits unavailable memory at :123-125. No change or resolution proposed as part of this research.
