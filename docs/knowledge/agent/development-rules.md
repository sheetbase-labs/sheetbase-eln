---
title: Sheetbase Development Rules
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Development Rules

## Task boundaries

Work one named roadmap task/epic at a time. Complete its whole exit criterion before presenting it as done.

Small supporting changes required to complete that task are implementation details, not partial progress on another roadmap item.

Do not quietly broaden into adjacent roadmap tasks.

## Branches and PRs

- branch per epic/task;
- PR to `main`;
- do not merge without explicit approval;
- keep commits/source/docs attribution under Gareth Price `<garethprice@me.com>`;
- generated PR footer metadata is not itself a blocker;
- PR description should state actual scope, known limits and validation honestly.

## Reviews

Review the actual implementation, not only the PR summary.

Trace consequential flows end-to-end:

```text
UI/client
→ server function/API
→ capability/RLS
→ persistence
→ evidence/audit
→ read/reconstruction path
```

A green-looking component test is insufficient if the real server path differs.

## Canonical-model discipline

Before adding a new object/table/API/model ask:

1. Is there already a canonical concept for this?
2. Is this just a state/view/configuration of that concept?
3. Would this create a second authority?
4. Can UI/API/automation all use the same contract?

Prefer extending canonical concepts over parallel models.

## Pre-release cleanup

There are no production users/data. When replacing development-era behaviour:

- delete obsolete APIs/schemas/UI routes;
- delete aliases/shims/fallbacks that serve only old development state;
- update fixtures/seeds to canonical data;
- delete compatibility-only tests;
- avoid migration/conversion code for hypothetical stored data.

Keep compatibility only when a current explicit dependency actually needs it.

## Security

- PostgreSQL/RLS/server enforcement is authoritative.
- Never rely solely on hidden UI/nav.
- Reuse canonical capabilities.
- SECURITY DEFINER functions must re-establish caller/workspace checks explicitly.
- Fail closed when identity, scope or mapping is ambiguous.

## Data/evidence

- durable relationships use stable IDs;
- preserve Dataset Schema Version interpretation;
- evidence pins immutable canonical state;
- do not confuse audit events with evidence snapshots;
- do not sample/truncate scientific calculations without explicit semantics;
- frozen and live scientific computations should share one deterministic implementation where possible.

## UI quality

New screens must fit the established dense product language. Do not introduce huge headings, sparse card dashboards or unrelated design systems.

For Sheets and figures, maximise usable working area. Advanced controls should be progressively disclosed.

## Tests

Test semantics, not merely rendering.

For important changes include the relevant combination of:

- unit/domain tests;
- DB/RLS tests;
- API tests;
- browser workflow tests;
- performance tests;
- evidence/reconstruction tests.

For duplicated contracts (e.g. TS + DB validation), add parity tests.

## Validation

Run the repository's full applicable validation before hand-off. Distinguish pre-existing failures from regressions with evidence; do not add exclusions to hide new failures.

## Documentation

Update canonical docs when a feature changes a durable concept or public contract. Update this knowledge base only for cross-cutting product/architecture/roadmap understanding.

ADRs remain the right place for consequential architecture changes.

## Roadmap maintenance

Roadmap files should describe Sheetbase itself, not adjacent projects. Status should reflect merged reality, not aspirational PR descriptions.

Do not call a roadmap stream complete if a core user workflow or scientific invariant remains broken.
