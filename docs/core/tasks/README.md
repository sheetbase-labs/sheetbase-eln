# Core Task Specifications

These files are the executable planning layer beneath `ROADMAP.md` and `CORE_MIGRATION.md`.

## Planning hierarchy

```text
PRODUCT_CORE.md       product meaning and invariants
CORE_ARCHITECTURE.md  target technical contracts
ROADMAP.md            high-level programme / epic order
CORE_MIGRATION.md     current-state migration strategy
NEXT.md               exactly what an agent should do now
tasks/*.md            granular Core implementation tasks
ADRs                   durable decisions
```

If documents appear to conflict, do not guess. Accepted ADRs and canonical Core semantics govern; `NEXT.md` identifies the active task. Implementation evidence may refine later task mechanics but must not silently overturn settled product semantics.

## Detail policy

All **Core Data Workspace epics are now granularly decomposed**:

- `CORE-01.md` — Common Schema Kernel (completed/active evidence as recorded there).
- `CORE-02.md` — Dataset Primitive and Versioning.
- `CORE-03.md` — Sheet Definition and Compositional Sheet Instance.
- `CORE-04.md` — Records from Sheets.
- `CORE-05.md` — Schema Evolution and Role-aware Configuration.
- `CORE-06.md` — Notebook Templates, Sharing and Frozen Evidence (complete).
  Do not start AUTO-01 from this file.

Later tasks remain subject to evidence-based refinement at the preceding epic exit gate. Refinement means adding concrete paths/tests/implementation details learned from the code; it does **not** mean reopening ADR 0020–0026 decisions without a genuinely new contradiction.

`LATER_EPICS.md` is retained only for AUTO-01/AUTO-02 high-level planning; its former CORE-04–06 summaries are superseded by the dedicated files above.

## Required implementation-task contract

Each task should make the following explicit where relevant: Goal; dependencies; implementation to inspect; deliverables; Data/API impact; UX behaviour; guarantees to preserve; prohibited shortcuts; tests/evidence; ADR trigger; objective exit gate; completion evidence.

The audit task at the start of an epic is deliberately evidence-first. It should discover exact implementation paths and current behaviour before the following coding tasks modify them.

## General definition of done

Unless explicitly analysis/documentation-only:

- migrations are additive and verified on a fresh database when changed;
- PostgreSQL/RLS remains authoritative;
- API validation and stable error behaviour exist;
- success plus important failure/isolation paths are tested;
- relevant UI covers loading/error/permission states and keyboard/accessibility behaviour;
- representative scale/performance is tested where the task affects large data;
- `pnpm validate` passes;
- documentation/ADRs/completion evidence are updated;
- the golden workflow remains reconstructable.

## Agent rules

1. Work the task identified by `NEXT.md` unless explicitly given a larger scope.
2. Inspect existing implementation before replacing abstractions.
3. Prefer convergence over parallel systems.
4. Stable IDs, not labels/positions, back dependencies.
5. Never make Handsontable/client state authoritative.
6. Never weaken RLS/security to simplify a vertical slice.
7. Never create an agent-only mutation path.
8. Do not broaden specialist surfaces during early Core work.
9. Use accepted ADRs 0020–0026 as settled product semantics.
10. Create a new ADR only for a genuinely new durable fork exposed by implementation evidence.
11. Record completion evidence and advance `NEXT.md` as part of hand-off.
