# Prompt — COLLAB Collaboration

Work on the active **COLLAB — Collaboration** epic in `phlohouse/sheetbase-eln`.

Read `docs/roadmap/NEXT.md`, `tasks/COLLAB.md`, PC-00 findings and current Notebook/Sheet/Record/Dataset identity and revision contracts before editing.

## Objective

Add collaboration around canonical scientific objects without creating a parallel content or workflow system.

## Principles

- comments/mentions attach to stable object/block/cell identities;
- presence is ephemeral and separate from durable scientific evidence;
- notifications derive from durable events where appropriate;
- review/task state should remain lightweight and scientifically contextual;
- concurrent editing must respect existing revision/conflict semantics;
- permissions apply equally to collaboration surfaces.

## Working method

Implement only the active COLLAB epic. Audit existing event, identity and notification seams first. Add permission, lifecycle, concurrency and deletion/retention tests appropriate to the feature.

## Do not

Do not turn Sheetbase into a generic project-management product. Do not make comments or presence part of scientific evidence unless an explicit future requirement says so. Do not invent coordinate-based durable identity when stable IDs exist.

## Completion

Report supported collaboration workflow, attachment identities, permission/concurrency semantics, event/notification behaviour, tests and remaining gaps.
