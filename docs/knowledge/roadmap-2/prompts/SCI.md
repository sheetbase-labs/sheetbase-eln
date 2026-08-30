# Prompt — SCI Scientific Analysis & Visualisation

Work on the active **SCI — Scientific Analysis & Visualisation** epic in `phlohouse/sheetbase-eln`.

Read `docs/roadmap/NEXT.md`, `tasks/SCI.md`, PC-00 findings, canonical Sheet/Dataset/calculation contracts, frozen evidence rules and current chart/analysis code before editing.

## Objective

Make analysis and visualisation first-class, provenance-aware scientific objects over canonical Sheet/Dataset data rather than a disconnected analytics subsystem.

## Principles

- charts reference stable fields/sources, not copied anonymous arrays as durable identity;
- analysis definitions are inspectable and reproducible;
- results distinguish live exploratory state from frozen evidence;
- calculation/analysis scope reuses existing semantics where possible;
- visualisations remain dense, accessible and scientifically precise;
- large-data operations use appropriate server-side/streaming strategies;
- do not create a second transformation architecture ahead of Pipelines.

## Working method

Implement only the active SCI epic. Audit existing chart/analysis remnants first and classify reuse versus deprecation. Add numerical correctness, provenance, historical rendering and accessibility tests appropriate to the feature.

## Do not

Do not start a general Pipeline engine, arbitrary Python execution or a separate data warehouse. Do not make charts the authoritative storage of their source data.

## Completion

Report scientific capabilities, source/provenance model, reproducibility semantics, performance evidence, UI/accessibility proof, tests and remaining analysis boundaries.
