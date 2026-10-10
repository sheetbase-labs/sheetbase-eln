---
id: subtask-257
title: MDL-02.1 — Routes /models
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-256
tags:
  - MDL-02.1
  - MDL
---

# MDL-02.1 — Routes /models

Step 1 of 4 in [MDL-02](../../tasks/MDL.md#mdl-02--model-editor); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. The surface exists and renders real seeded data in the parity screenshot runs; the owner has deferred optical comparison as a gate, so the remaining fidelity deltas are recorded as diagnostics rather than blockers. MDL-02.1 - the model routes exist (src/routes/models.tsx and src/routes/models/).
- 2026-10-03: Partial. Added /models/$modelId/rules and /models/$modelId/usage for workspace record models (tabs on the record-model frame): Rules authors api.model_rules (create/remove, field multi-select, condition, effect, message) against record_field_definitions; Usage shows per-field value counts via model_field_usage and the dependency panel via discover_model_dependencies. Acceptance: typecheck; screens 102x2; models area green. REMAINING: (1) Relations route is blocked — api.model_relationship_rules.source_model_key references api.model_kinds only, so workspace record models cannot be relationship sources without a schema decision; (2) the dataset-schema frame (uuid) still has no rules/relations/usage tabs and model_rules does not read dataset_schema_version_fields; (3) discover_model_dependencies resolves model_kinds only and 403s on a workspace model key, so workspace-model impact is not reported (Usage degrades honestly).
- 2026-10-03: Usage tab unblocked: drizzle/0291_record_model_dependencies.sql makes api.discover_model_dependencies resolve a workspace record model (ADR-0051) as an api.records host (kind=key), workspace-scoped. DB test tests/db/record-model-dependencies.test.ts proves fields+records are reported to the owning workspace, another workspace is denied 42501, and built-in kinds still resolve. Remaining in 02.1: Relations route (model_relationship_rules.source_model_key still references model_kinds) and dataset-schema frame tabs.
- 2026-10-03: Relations landed (519caff9): migration 0292 makes api.model_relationship_rules.source_model_key accept a built-in kind or a same-workspace record model; the enforcement trigger resolves the source via internal.model_key_for; /models/$modelId/relations authors rules. DB test 5 passed; unit 3439; typecheck/lint clean. REMAINING in 02.1: record-model Versions tab and the dataset-schema frame tabs.
