---
id: task-38
title: DSYS-06 — Visual parity suite
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-04"
parent: epic-14
related:
  - task-2
tags:
  - DSYS-06
  - DSYS
  - wave-A
---

# DSYS-06 — Visual parity suite

Spec: [DSYS-06 in tasks/DSYS.md](../../tasks/DSYS.md#dsys-06--visual-parity-suite)

- Stream: DSYS (epic-14)
- Wave: A
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-09-27: DSYS-06 suite built: parity project, spec and CI job; screens migrate as they are rebuilt.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: tests/visual/design-states.ts:158; tests/visual/parity.spec.ts:19; tests/visual/parity.spec.ts:68; .github/workflows/ci.yml:168; docs/knowledge/roadmap-4/UI_PORT.md:1. Remaining: Parity scaffolding exists but maps zero screen/theme cases; coverage arithmetic passes with everything pending. Adopted app-3 port also changed the reference method. Record the reference/test-contract reconciliation, then prove mapped comparisons and a deliberate-drift failure. Do not silently weaken the original exit. See docs/knowledge/roadmap-4/RECONCILIATION.md#dsys-06. Source audit, not fresh service/browser acceptance.
- 2026-10-03: DSYS-06 finding from the fixture work: scripts/design-reference.mts never applies Inter (the @fontsource pipeline does not reach the canvas), so every reference render rasterises in the platform UI font. Any ported route that renders Inter will differ from the reference. Resolve the renderer font or pin the parity contract to the platform font before mapping screens.
- 2026-10-03: DSYS-06 correction to the font finding: the reference renders rasterise in Helvetica (not system-ui, and not Inter). Pinning sans-serif in a fixture moved the step-yield chart from 1.21% to 0.44%. Any parity pinning or renderer fix must target the actual reference font.
- 2026-10-04: Full original DSYS-06 acceptance assigned. Accepted ADR0047 unchanged canvas reference remains authoritative. Worker confirms36/126 registered screens,72 theme comparisons,70 expected-failure annotations and90 pending screens. No tolerance/reference relaxation or completion claim.
