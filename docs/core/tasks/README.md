# Core Task Specifications

These files are the executable planning layer beneath `ROADMAP.md` and `CORE_MIGRATION.md`.

## Planning hierarchy

```text
PRODUCT_CORE.md       product meaning and invariants
CORE_ARCHITECTURE.md  target technical contracts
ROADMAP.md            high-level programme / epic order
CORE_MIGRATION.md     current-state migration strategy
NEXT.md               exactly what an agent should do now
 tasks/*.md            implementation-ready and progressively elaborated tasks
ADRs                  durable decisions settled through implementation
```

If documents appear to conflict, do not guess. Product semantics in `PRODUCT_CORE.md` are authoritative; architectural constraints in `CORE_ARCHITECTURE.md` follow them. `NEXT.md` identifies the active task. Raise/update documentation when implementation evidence reveals a genuine conflict.

## Progressive elaboration

Do not pretend distant work is implementation-ready.

Current detail policy:

- **CORE-01:** fully decomposed and implementation-ready.
- **CORE-02:** substantially decomposed; refine after CORE-01 evidence.
- **CORE-03:** task skeletons plus strong acceptance constraints; refine during CORE-02.
- **CORE-04 to CORE-06:** epic-level implementation notes and non-negotiable outcomes only.
- **AUTO-01 / AUTO-02:** architecture and exit-gate level only until the Core substrate is stable.

At the end of each epic, review the next epic and promote its task specifications to implementation-ready status.

## Required task structure

Implementation-ready tasks should contain:

### Goal

One clear outcome. Avoid combining unrelated architectural decisions.

### Why

The product/architecture reason the task exists.

### Blocked by

Explicit dependencies. `Nothing` if genuinely independent.

### Existing implementation to inspect

Concrete files, migrations, tables, functions, components, tests or ADRs that should be read before changing behaviour. If exact paths are not yet known, the first task in an epic should discover and record them.

### Deliverables

Concrete artefacts/behaviours required for completion.

### Data/API changes

Expected database, RLS, RPC, REST or public-contract impact. State `None` when the task is intentionally analysis-only.

### UX behaviour

Expected user behaviour where applicable. Do not prescribe visual implementation unnecessarily when the design system already governs it.

### Must preserve

Existing guarantees that must survive the change.

### Do not

Likely shortcuts or architecture mistakes that are explicitly out of scope/prohibited.

### Tests / evidence

Automated tests, fresh-database proof, browser evidence, performance evidence or audit artefacts required.

### ADR trigger

A decision that must be documented before implementation proceeds if the task discovers competing durable approaches.

### Exit gate

Objective conditions for marking the task complete.

### Completion evidence

Initially blank. When completed, record commit/PR, key files, ADRs and test evidence so the next agent does not have to rediscover what happened.

## General definition of done

Unless a task explicitly says it is analysis/documentation-only:

- migrations are additive and verified on a fresh database;
- PostgreSQL/RLS remains authoritative;
- API validation and stable error behaviour exist;
- success and important failure/isolation paths are tested;
- relevant UI has loading/error/permission states and keyboard/accessibility consideration;
- `pnpm validate` passes;
- documentation and ADRs are updated;
- the golden workflow is not made harder or less reconstructable.

## Agent rules

1. Work only the task identified by `NEXT.md` unless explicitly asked to take a larger scope.
2. Inspect existing implementation before designing replacement abstractions.
3. Prefer convergence over parallel systems.
4. Stable IDs, not labels/positions, back dependencies.
5. Never make Handsontable/client state authoritative.
6. Never weaken RLS/security to simplify a vertical slice.
7. Never create an agent-only data mutation path.
8. Do not broaden specialist surfaces during early Core work.
9. If a task uncovers a durable architectural fork, stop and write/propose the ADR rather than silently choosing.
10. Update completion evidence and `NEXT.md` as part of the hand-off.
