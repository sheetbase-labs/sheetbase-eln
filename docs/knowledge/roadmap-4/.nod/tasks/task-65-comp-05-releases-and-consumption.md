---
id: task-65
title: COMP-05 — Releases and consumption
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-42
related:
  - task-2
  - task-13
  - task-48
  - task-55
  - task-61
tags:
  - COMP-05
  - COMP
  - wave-A
---

# COMP-05 — Releases and consumption

Spec: [COMP-05 in tasks/COMP.md](../../tasks/COMP.md#comp-05--releases-and-consumption)

- Stream: COMP (epic-42)
- Wave: A
- Waits on: DEC-01 (task-2), DEC-12 (task-13), COMP-02 (task-48), COMP-03 (task-55), COMP-04 (task-61)
- Steps: 3 subtasks

## Work Log
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: package.json:84-131 — current dependencies retain existing renderers, no sheetbase component packages; pnpm-workspace.yaml:1 — no component consumption override; docs/knowledge/roadmap-4/tasks/COMP.md — DEC-12 makes registry conditional. Remaining: 1 private registry is conditional; do not turn into public publishing assignment. 2 establish reproducible private consumption and theme mapping (none committed now). 3 integration/upgrade document absent at docs/development/sheetbase-components.md. CI frozen install/parity acceptance outstanding. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-05. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates COMP-02, COMP-03, COMP-04. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: COMP-05 configuration complete (components b83b697): packages scoped to @sheetbase-labs, publishConfig -> npm.pkg.github.com restricted, release workflow uses the built-in Actions token, ELN .npmrc scope added, docs/development/sheetbase-components.md written. Exit (ELN installs from the registry in CI with a frozen lockfile) is blocked on the first real lockstep release, which needs a tag/release run and the ELN dependency pin.
- 2026-10-03: All steps done; closed by roadmap sync.
- 2026-10-03: First lockstep release published: components tag v0.1.0 -> release run 37138980944 succeeded (built-in GITHUB_TOKEN, no long-lived secret); six @sheetbase-labs/* 0.1.0 packages on GitHub Packages. ELN now consumes shared/table/explorer/advanced-search at 0.1.0 with a frozen lockfile (01c09302), maps the package variables onto the ELN tokens, adds packages:read CI auth, and renders the package grid at the dev-only /sheetbase-components route. Remaining for the exit: the DSYS-06 parity loop, which is what makes a package release that changes a v3 screen fail the ELN suite.
- 2026-10-03: Both CI halves now real: ELN consumes 0.2.0+ from GitHub Packages with a frozen lockfile; releases 0.1.0-0.4.0 published from sheetbase-components tags. Remaining for the exit: the DSYS-06 parity loop so a package release that changes a v3 screen fails the ELN suite.
- 2026-10-03: Reopened: the registry/frozen-lockfile half is delivered and verified (releases 0.1.0-0.5.0 consumed), but the second exit clause — a package release that changes a v3 screen must fail the ELN parity suite — depends on the DSYS-06 parity loop, which is still empty.
- 2026-10-04: 4 October orb continuation: added tests/visual/package-parity.spec.ts, unannotated installed 0.6.0 filter-builder comparison against the States design crop in light/dark at 0.001 tolerance. Clean comparison passes first, simulated padding drift is rejected. Fixed missing filter stylesheet import, scoped font aliases, fixture dark hydration. Focused parity: 2 passed; stylesheet contract: 6 passed. COMP-05 remains open: full-screen expected failures can still hide package regressions outside this fixture. Durable evidence: docs/development/sheetbase-components.md and RECONCILIATION.md.
