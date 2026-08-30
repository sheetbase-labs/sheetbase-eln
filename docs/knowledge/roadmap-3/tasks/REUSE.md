# REUSE — Reusable Scientific Structures & Workflows

**Status:** planned; not active until promoted by `docs/knowledge/NEXT.md`.

## Programme goal

Make successful scientific structures easy to reuse without introducing hidden inheritance or shared mutable state.

## REUSE-01 — Definition & Template Discovery

### Goal
Make reusable Sheet Definitions, Notebook Templates and related configuration easy to find and understand.

### Scope
- catalogue/search/filter by purpose, owner, status and scientific context;
- preview source requirements/parameters;
- clear published/draft/retired state;
- usage/dependency visibility.

### Exit
A scientist or Steward can find the right reusable structure and understand what it will instantiate before using it.

## REUSE-02 — Composition & Parameterisation Depth

### Goal
Mature reusable composition around existing typed Parameter and Definition/Instance semantics.

### Scope
- richer source/parameter binding;
- defaults and required inputs;
- composition of reusable definitions without inheritance;
- explicit local configuration versus governed reusable structure.

### Exit
Useful scientific structures can be reused across projects with explicit inputs and independent working state.

## REUSE-03 — Upgrade & Adoption Workflows

### Goal
Make upgrades to reusable structures deliberate and safe.

### Scope
- upgrade availability and diff/impact preview;
- explicit consumer adoption;
- preserve local values/working state according to canonical contracts;
- dependency/version evidence.

### Exit
Existing consumers never silently change, while users can intentionally adopt newer reusable definitions with understandable consequences.

## Boundaries

- Reuse does not imply shared mutable state.
- No Definition/Template inheritance hierarchy.
- Dataset reuse never makes the Dataset owned by a Definition or Template.
