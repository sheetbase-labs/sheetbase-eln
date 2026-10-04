# Roadmap 4 reconciliation — 2 October 2026

**Roadmap 4 is active and incomplete.** Audited ELN branch `roadmap-4/ui-app3` at `9bbd305c`; component source at `../sheetbase-components`, `6f12e0b3`. These are local checkout observations, not claims about merge, hosted CI or deployment. Concurrent migration/browser-script edits appeared later in the shared checkout; they were left untouched and are outside this audit baseline.

All **86 original tasks across 17 streams** have an evidence-backed disposition below. At this audit the tracker had **17 done, 52 in progress, 16 todo and one cancelled duplicate**; its generated denominator was therefore **85 active tasks**, with **68 open**. This is a workflow count, not a percentage of product acceptance.

## Update since this audit

### 4 October orb continuation

The continuation starts from pushed `GWP/roadmap-4-shell` at `3e0fe40d`.
The owner supplied the excluded nod archive; restored nod agrees with
`CHECKLIST.md` at **34 of 85 tasks and 125 of 266 steps done**.
The audit statuses and earlier counts below remain historical.

COMP-05 now has an unannotated installed-package comparison against the States
filter-builder design crop in both themes. The same screenshot assertion
rejects a simulated package padding change, at the existing 0.001 tolerance.
This exposed and fixed a missing filter stylesheet import, scoped font-family
fallbacks, and development-fixture dark-theme hydration. Evidence lives in
`tests/visual/package-parity.spec.ts`, `scripts/design-reference.mts`, and
`docs/development/sheetbase-components.md`.

**COMP-05 stays in progress.** This proves the filter comparison, not rejection
of every package upgrade. The 70 full-screen DSYS-06 comparisons still have
expected-failure annotations, which can hide additional drift. No task exit
has been relaxed or closed by this slice.

Baseline verification: frozen registry install, `pnpm roadmap:check`,
`pnpm typecheck`, `pnpm check`, and 3,537 unit tests pass. Fresh local migration
and design seeding pass. Upgrading the orb's older populated demo database
failed at migration 0255's `UPDATE api.sheet_instances SET display_id = …`:
`internal.guard_sheet_instance` rejected it with `42501`, "Sheet Instances
require controlled RPCs". Resetting the disposable orb database established
the fresh-install baseline; it did not fix or accept that populated-upgrade
path. That path remains a programme verification blocker.

Post-slice parity: 73 tests pass, comprising 70 documented expected failures,
the coverage check, and two unannotated installed-filter tests with negative
controls. `pnpm validate` stops at lint with **16 errors and 18 warnings** in
untouched inherited files: canonical-sheet-workspace, formula-reference-editor,
the design seed, import/server, and the sample route test. Changed TypeScript
files pass focused ESLint. Separately running `pnpm typecheck`, `pnpm test`
and `pnpm build` succeeds, with all 3,537 unit tests passing after the slice.
The full validation exit is therefore still unmet.

### Earlier updates

This register is a point-in-time audit of `9bbd305c` on 2 October 2026. Eleven
tasks have closed since, on 2–3 October 2026, and the nod tracker now records
**28 of 85 active tasks and 87 of 266 steps done**
([CHECKLIST.md](CHECKLIST.md)). The register entries below retain their original
audit status lines for history, each marked with its closing commit; the
[remaining work](#remaining-work-in-order) list is the audit's, not current
sequencing.

| Task     | Closed     | Closing commit                                                                          |
| -------- | ---------- | --------------------------------------------------------------------------------------- |
| LAB-01   | 2026-10-03 | `58018eb1` — feat(lab-01): withdraw dialog, reservations and used/reserved/free Usage   |
| LAB-02   | 2026-10-03 | `3e7cadf5` — feat(lab-02): sample state banners and release/quarantine/disposal actions |
| LAB-03   | 2026-10-03 | `a303d027` — feat(lab-03): seed the design hold data so SMP-2231 matches the board      |
| DSET-03  | 2026-10-03 | `4bf62ec0` — feat(dset-03): manual snapshot, complete inspector and compare paging      |
| DSET-04  | 2026-10-03 | `cda5daec` — feat(dset-04): keep action, prune warning and tombstone presentation       |
| MDL-01   | 2026-10-03 | `4e69f5b6` — feat(mdl-01): model impact for workspace record models                     |
| MDL-03   | 2026-10-03 | `085ded29` — feat(mdl-03): pending approval UI on the model versions surface            |
| MDL-04   | 2026-10-03 | `6c11aefb` — feat(mdl-04): generated record form and record page                        |
| SHELL-02 | 2026-10-02 | `0cdd9f51` — test(shell): prove cross-tab and cross-device appearance                   |
| WORK-02  | 2026-10-02 | `468b7e95` — refactor(work-02): delete the superseded dashboard data layer              |
| SRCH-02  | 2026-10-02 | `91601b87` — feat(srch-02): server-filtered results, palette scopes and actions         |

The counts above include this audit's non-DEC partials; the current tracker is
authoritative for per-task status. DEC-03 supersedes the cancelled SHELL-04 as
before, so the active denominator stays 85.

The audit's evidence dispositions were:

| Evidence disposition               | Tasks | Meaning                                                                                                                                           |
| ---------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted decision                  |    13 | DEC-01..12 and PORTAL-01 have recorded decisions; downstream implementation is separate.                                                          |
| Implemented, acceptance unverified |     4 | DSYS-01/02/04 and SHELL-05 retain historical done status. This audit did not re-certify their full exits.                                         |
| Partial                            |    52 | Current source implements a subset; the original task exit remains open.                                                                          |
| Not started                        |    16 | Reusable foundations exist, but the requested new capability was not found.                                                                       |
| Superseded                         |     1 | SHELL-04 duplicates accepted DEC-03; existing cancelled child steps remain cancelled. Implementation obligations remain with their named streams. |

## Changes to the tracker

Reopened seven parents previously marked done: **COMP-01, DSET-03, DSYS-06, EXP-01, PROJ-01, SHELL-01 and SHELL-02**. Concrete missing behavior, rather than absence of fresh tests alone, caused each reopening. Reopened **21 completed steps** where current source contradicts their full scope. Recorded PORTAL-01 done from its accepted ADR and RLS test plan; cancelled the duplicate SHELL-04 decision task. Partial tasks previously labelled todo now show in progress, meaning implementation exists, not that someone is currently assigned.

Stream metadata now agrees with the task audit: DEC is done; the other sixteen streams remain in progress.

Newly discovered step implementation (COMP-02.1 dimensions and PORTAL-02.2 sharing/messages) is recorded in progress pending full acceptance. Existing done steps are retained where no concrete contradiction was identified; their tests were not all rerun. DSET-04.1 retains credit for persisted policy and computed retention, while the scheduler and product controls remain open.

| Reopened step | Original owner        |
| ------------- | --------------------- |
| DSYS-06.2     | [DSYS-06](#dsys-06)   |
| SHELL-01.2    | [SHELL-01](#shell-01) |
| SHELL-01.4    | [SHELL-01](#shell-01) |
| SHELL-02.2    | [SHELL-02](#shell-02) |
| SHELL-03.2    | [SHELL-03](#shell-03) |
| WORK-02.3     | [WORK-02](#work-02)   |
| PROJ-01.4     | [PROJ-01](#proj-01)   |
| PROJ-03.2     | [PROJ-03](#proj-03)   |
| EXP-01.3      | [EXP-01](#exp-01)     |
| EXP-01.4      | [EXP-01](#exp-01)     |
| EXP-06.2      | [EXP-06](#exp-06)     |
| COMP-01.2     | [COMP-01](#comp-01)   |
| COMP-01.3     | [COMP-01](#comp-01)   |
| COMP-01.4     | [COMP-01](#comp-01)   |
| DSET-03.1     | [DSET-03](#dset-03)   |
| DSET-03.2     | [DSET-03](#dset-03)   |
| DSET-03.3     | [DSET-03](#dset-03)   |
| DSET-04.2     | [DSET-04](#dset-04)   |
| SET-01.1      | [SET-01](#set-01)     |
| SET-01.2      | [SET-01](#set-01)     |
| SET-04.3      | [SET-04](#set-04)     |

The following existing specification/programme-map dependencies were added to nod. They gate full-task completion; partial work can proceed where independent. The broader dependency diagram remains guidance, not a claim that every edge is a hard implementation prerequisite.

| Task      | Added waits-on tasks      |
| --------- | ------------------------- |
| COMP-02   | COMP-01                   |
| COMP-03   | COMP-01                   |
| COMP-04   | COMP-01                   |
| COMP-05   | COMP-02, COMP-03, COMP-04 |
| COMP-06   | COMP-02, COMP-05          |
| COMP-07   | COMP-03, COMP-05          |
| SHEET-02  | MDL-03                    |
| SHEET-05  | COMP-07                   |
| MDL-04    | MDL-01                    |
| PORTAL-02 | PORTAL-01, REV-02         |
| PIPE-02   | PIPE-01                   |
| PIPE-03   | PIPE-01                   |
| PIPE-04   | PIPE-01                   |
| PIPE-05   | PIPE-01                   |

The generated NEXT label “Waiting on a decision” also counts implementation dependencies; interpret it as “waiting on a prerequisite”. All twelve DEC decisions are recorded accepted.

## Remaining work, in order

The sequencing below is the 2 October audit's; see the
[update since this audit](#update-since-this-audit) for the tasks closed after it.

1. **Restore reliable acceptance and shell behavior:** DSYS-05/06, SHELL-01/02/03 and WORK-02. Map real screen states, settle the app-3 versus vendored-reference test contract, prove deliberate visual drift fails, and restore workspace switching, capability-aware navigation, shared shortcuts and theme synchronization. Keep the original acceptance requirements until their replacement is explicitly recorded.
2. **Close scientific correctness gaps:** DSET-01/03/04 and LAB-03/MOB-02. Compare canonical flags, schedule retention safely, show truthful keep/removal state, and resolve the standalone measurement surface against the required Dataset/integration provenance. Complete LAB-07 before claiming enforced EXP-02/03 readiness; complete server-filtered SRCH-02 independently.
3. **Finish shared component integration and scientific workflows:** COMP-01..07, SHEET-01..05 and MDL-01..04. Use the accepted formula authority; retain existing pin storage and materialization. Workspace Record Models remain separate from Dataset-schema editing. MDL-03 owns approval needed by SHEET-02.
4. **Complete governed and operational workflows:** REV-01..05, PORTAL-02, PIPE-01..05, SET and remaining LAB/PROJ/EXP tasks. Existing review, signatures, portal and pipeline pages do not establish reauthentication, hash chaining, approved downloads, human waits or complete server enforcement.
5. **Close the original programme exits:** finish remaining mobile/offline/template work, then demonstrate populated workflows, permission isolation, frozen reconstruction and screen-state acceptance. Keep intentional deferrals explicit and owned; none were silently removed in this reconciliation.

These are sequencing recommendations for the existing backlog, not newly assigned implementation. The per-task remaining work below and original specifications are the executable scope.

## Acceptance and design contract

`tests/visual/design-states.ts` contains **zero mapped states**. The original 126-screen/light-and-dark contract implies 252 comparisons; the current parity loop registers none. The coverage arithmetic can pass with every comparison pending. This is why DSYS-06 is reopened. Browser scripts and the historical port QA are useful separate evidence, not proof of that exit.

The app-3 port is the adopted implementation method. `UI_PORT.md` previously said it superseded vendored-HTML parity, while the programme and accepted ADR retain exact comparison exits. DSYS-06 owns reconciling the reference inventory and test contract, documenting any explicit acceptance change and proving the resulting gate. This audit neither reverts the port nor silently waives parity.

Some route paths differ from the original plan: experiments use `/experiments/$expId/*`, general settings `/settings/`, evidence `/evidence/$revisionId`, and portal `/client-portal`. Treat these as current integration points; verify redirects, permissions and behavior rather than rebuilding duplicate routes solely to match old spelling. The proposed milestone replacement now uses `study_tasks` and `study_deliverables`; PROJ-02 owns documenting that domain choice and completing evidence/reorder behavior.

## Roadmap 5 boundary

Original Roadmap 4 IDs retain ownership of every unfinished requirement. Roadmap 5 stays a proposal. WORK-02 owns first run; SRCH-02 filtered search; DSET-01/LAB-03/MOB-02 measurement provenance; DSET-05/06 intake/parser work; LAB-07 effective protocols; SHEET-03 cell discussions; SHEET-05 composed-source analysis; PIPE-01..05 pipeline workflow gaps; REV/PORTAL governed delivery. Proposal tasks may add acceptance or extensions, but must not create competing implementations or count these requirements twice.

In particular, `materialize_sheet_instance` already commits Definition-backed Sheet rows, local fields and trusted calculations to a canonical Dataset and snapshot, with revision/digest/idempotency controls. R5-SCI-02 must extend that contract under SHEET-05, not introduce another materialization engine or Sheet-version store. Existing `sheet-instance.ts` already stores live/version source policies. MDL-01's workspace Record Model and COMP-06's accepted formula-engine migration remain real unfinished work.

## Verification performed

- Read all original task specifications and inspected source, migrations and selected test assertions across both repositories. Evidence paths below refer to the audited revisions; documentation line numbers may shift during this edit.
- Checked all **161** design manifest hashes: no mismatches; **126** canvas screens found.
- Ran the tracker and contrast unit suites: **49 tests passed** across two files. After metadata changes, tracker synchronization/check passed and the focused tracker suite passed again: **6 tests**.
- Checked changed-document links and `git diff --check` after edits.
- Did not run application, database, API, browser, visual rendering, deployment or recovery suites; did not query hosted CI or publish anything. Historical port test counts are retained as dated history only. The earlier REUSE-02 failure is not a freshly reproduced failure; its old component has been retired and equivalent workflow acceptance remains to be demonstrated.

## Task register

Each entry preserves the original task's owner and exit. “Remaining” includes implementation gaps and acceptance not exercised here; those are distinguished in the text. Read the specification before implementation.

## DEC

Specification: [tasks/DEC.md](tasks/DEC.md).

### DEC-01

**accepted · nod `done`** (was `done`). Adopt UI system v3.

**Evidence:**

- [`docs/knowledge/decisions/0047-ui-system-v3-adoption.md`](../decisions/0047-ui-system-v3-adoption.md):3
- [`docs/knowledge/roadmap-4/UI_PORT.md`](UI_PORT.md):1

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-02

**accepted · nod `done`** (was `done`). Sheet grid and formula authority.

**Evidence:**

- [`docs/knowledge/decisions/0048-sheet-grid-on-sheetbase-table.md`](../decisions/0048-sheet-grid-on-sheetbase-table.md):105

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-03

**accepted · nod `done`** (was `done`). Routes outside the design.

**Evidence:**

- [`docs/knowledge/roadmap-4/tasks/SHELL.md`](tasks/SHELL.md):208

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-04

**accepted · nod `done`** (was `done`). Regulated signing and tamper-evident audit.

**Evidence:**

- [`docs/knowledge/decisions/0045-regulated-intended-use-control-model.md`](../decisions/0045-regulated-intended-use-control-model.md):50

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-05

**accepted · nod `done`** (was `done`). Client users.

**Evidence:**

- [`docs/knowledge/decisions/0049-client-users.md`](../decisions/0049-client-users.md):3

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-06

**accepted · nod `done`** (was `done`). Groups.

**Evidence:**

- [`docs/knowledge/decisions/0050-workspace-groups-and-project-access.md`](../decisions/0050-workspace-groups-and-project-access.md):3

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-07

**accepted · nod `done`** (was `done`). Workspace-defined record models.

**Evidence:**

- [`docs/knowledge/decisions/0051-workspace-defined-record-models.md`](../decisions/0051-workspace-defined-record-models.md):3

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-08

**accepted · nod `done`** (was `done`). Pipelines that pause for a person.

**Evidence:**

- [`docs/knowledge/decisions/0052-pipelines-that-pause-for-a-person.md`](../decisions/0052-pipelines-that-pause-for-a-person.md):3

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-09

**accepted · nod `done`** (was `done`). Durable offline edits.

**Evidence:**

- [`docs/knowledge/decisions/0018-notebook-autosave-and-conflict.md`](../decisions/0018-notebook-autosave-and-conflict.md):79

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-10

**accepted · nod `done`** (was `done`). Labels, printers and scanning.

**Evidence:**

- [`docs/knowledge/roadmap-4/tasks/DEC.md`](tasks/DEC.md):103
- [`docs/knowledge/roadmap-4/tasks/LAB.md`](tasks/LAB.md)

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-11

**accepted · nod `done`** (was `done`). Snapshot retention periods.

**Evidence:**

- [`docs/knowledge/roadmap-4/tasks/DEC.md`](tasks/DEC.md):110
- [`docs/knowledge/roadmap-4/tasks/DSET.md`](tasks/DSET.md)

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

### DEC-12

**accepted · nod `done`** (was `done`). Component package distribution.

**Evidence:**

- [`docs/knowledge/roadmap-4/tasks/DEC.md`](tasks/DEC.md):117
- [`docs/knowledge/roadmap-4/tasks/COMP.md`](tasks/COMP.md)

**Remaining:** Decision recorded; dependent implementation and acceptance remain separate.

## DSYS

Specification: [tasks/DSYS.md](tasks/DSYS.md).

### DSYS-01

**implemented-unverified · nod `done`** (was `done`). Vendor the design reference and render it.

**Evidence:**

- [`docs/knowledge/design/ui-system-v3/SHA256SUMS`](../design/ui-system-v3/SHA256SUMS)
- [`scripts/design-reference.mts`](../../../scripts/design-reference.mts):1

**Remaining:** Recorded delivery retained. Reconciliation verified 161 manifest entries and 126 screens; repeated render byte equality was not rerun.

### DSYS-02

**implemented-unverified · nod `done`** (was `done`). Tokens.

**Evidence:**

- [`src/styles.css`](../../../src/styles.css):18
- [`scripts/design-tokens.mts`](../../../scripts/design-tokens.mts)
- [`scripts/check-colours.mts`](../../../scripts/check-colours.mts)
- [`src/lib/contrast.test.ts`](../../../src/lib/contrast.test.ts)

**Remaining:** Recorded completion retained: current contrast tests pass. Full product literal-colour scan and rendered token acceptance were not rerun.

### DSYS-03

**partial · nod `in-progress`** (was `in-progress`). Primitives restyled in place.

**Evidence:**

- [`src/components/v3/ui/button.tsx`](../../../src/components/v3/ui/button.tsx)
- [`src/components/v3/ui/sonner.tsx`](../../../src/components/v3/ui/sonner.tsx)
- [`src/components/v3/icons.tsx`](../../../src/components/v3/icons.tsx)
- [`docs/knowledge/roadmap-4/UI_PORT.md`](UI_PORT.md):17

**Remaining:** App-3 kit replaces the original restyle-in-place approach. Reconcile remaining icon consumers, component-state/a11y coverage and legacy-kit use with adopted port; do not rebuild the retired kit.

### DSYS-04

**implemented-unverified · nod `done`** (was `done`). New design components.

**Evidence:**

- [`src/components/ui/README.md`](../../../src/components/ui/README.md)
- [`src/components/v3/ui/source.tsx`](../../../src/components/v3/ui/source.tsx)
- [`src/components/v3/ui/tree.tsx`](../../../src/components/v3/ui/tree.tsx)
- [`src/components/v3/ui/secret.tsx`](../../../src/components/v3/ui/secret.tsx)

**Remaining:** Recorded component delivery retained. Mapping document still names the earlier kit; align it with adopted v3 consumers and verify state/a11y coverage before programme acceptance.

### DSYS-05

**partial · nod `in-progress`** (was `in-progress`). Design-data seed.

**Evidence:**

- [`src/db/seed/design.ts`](../../../src/db/seed/design.ts)
- [`tests/visual/design-states.ts`](../../../tests/visual/design-states.ts):158
- [`scripts/design-seed-coverage.mts`](../../../scripts/design-seed-coverage.mts):25

**Remaining:** Populated seed has expanded, but DESIGN_STATES is empty. Coverage scans selected ID families rather than all specified values and does not fail on misses. Complete state mapping, coverage enforcement and idempotent real-service proof.

### DSYS-06

**partial · nod `in-progress`** (was `done`). Visual parity suite.

**Evidence:**

- [`tests/visual/design-states.ts`](../../../tests/visual/design-states.ts):158
- [`tests/visual/parity.spec.ts`](../../../tests/visual/parity.spec.ts):19
- [`tests/visual/parity.spec.ts`](../../../tests/visual/parity.spec.ts):68
- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml):168
- [`docs/knowledge/roadmap-4/UI_PORT.md`](UI_PORT.md):1

**Remaining:** The suite is now a real gate: 35 screens (70 comparisons) are
mapped through a state driver that reproduces the renderer's session, theme,
viewport and clock; the coverage test fails on an unlisted screen, a duplicate
or an empty pending reason; and each mapped comparison is a documented
expected-failure carrying its measured ratio and causes, with the ratchet
proven (a screen that starts passing fails the run). All 70 currently diverge
at 2–4% (gate 0.1%) for four systemic reasons: **(1) body font** — fixed; the
ELN's `@theme` declared `--font-sans` inside `@layer theme`, which loses to the
unlayered `:root` in the package bundle, so app chrome rendered in Instrument
Sans; **(2) shell chrome** — nav counts, the topbar New control and the pinned
projects section differ on every shelled screen; **(3) seeded content** —
dataset list/columns, the consumed sample state, portal shares, webhook
deliveries and the design clock do not match; **(4) detail routes resolve
UUIDs only**, so the design's display identifiers render not-found. Causes 2
and 4 are ELN implementation gaps, 3 is a seed gap. The remaining screens need
states or seed the driver cannot reach yet.

## COMP

Specification: [tasks/COMP.md](tasks/COMP.md).

### COMP-01

**partial · nod `in-progress`** (was `done`). v3 theme contract (components repo).

**Evidence:**

- [`../sheetbase-components/packages/shared/src/themes/v3.css`](../../../../sheetbase-components/packages/shared/src/themes/v3.css):10-47 — v3 variable preset exists
- [`../sheetbase-components/packages/table/src/ui/TableSurface.tsx`](../../../../sheetbase-components/packages/table/src/ui/TableSurface.tsx):90-91,135 — literal palette/default colours remain
- [`../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx`](../../../../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx):2123 — literal reference colours remain
- [`../sheetbase-components/scripts/check-colour-literals.ts`](../../../../sheetbase-components/scripts/check-colour-literals.ts):12-15 — lint only scans CSS; task explicitly includes TSX

**Remaining:** 1: shared variables/preset exist; exhaustive token equality/default-look acceptance unverified. 2: replace remaining TSX literals. 3: add documented host variable mapping in shared README and verify exact token parity. 4: include CSS/TSX outside theme exceptions in lint. Existing done claim is contradicted for literal replacement and lint scope.

### COMP-02

**partial · nod `in-progress`** (was `todo`). Table to v3 (components repo).

**Evidence:**

- [`../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx`](../../../../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx):215-226 — configurable dimensions and columnGroups
- [`../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx`](../../../../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx):411-414 — dimensions used
- [`../sheetbase-components/packages/table/src/ui/TableSections.tsx`](../../../../sheetbase-components/packages/table/src/ui/TableSections.tsx):1 — current sections exports; no notebookTableSections
- Component test inventory: no planned `packages/table/e2e/specs/v3-grids.spec.ts` fixture exists.

**Remaining:** 1 dimension props implemented; v3 preset consuming 28px still needs proof. 2 column groups exist but full source badges incomplete. 3 specified cellState contract absent. 4 append/draft-row design and notebook preset not complete. 5 v3 one-tab-stop behaviour unverified. 6 v3 crop fixtures absent.

### COMP-03

**partial · nod `in-progress`** (was `todo`). Charts to v3 (components repo).

**Evidence:**

- [`../sheetbase-components/packages/explorer/src/index.ts`](../../../../sheetbase-components/packages/explorer/src/index.ts):29-31 — buildChart/export functions exposed, no standalone Chart component
- [`../sheetbase-components/packages/explorer/src/lib/chart.ts`](../../../../sheetbase-components/packages/explorer/src/lib/chart.ts):445 — chart builder exists
- [`../sheetbase-components/packages/explorer/src/explorer-v3.css`](../../../../sheetbase-components/packages/explorer/src/explorer-v3.css):1 — styling groundwork
- [`../sheetbase-components/packages/shared/src/index.ts`](../../../../sheetbase-components/packages/shared/src/index.ts):9 — theme icons, no shared v3 icon set

**Remaining:** 1 standalone Chart export absent. 2 verify/implement v3 marker, excluded-point and reference-line contract. 3 shared-axis multichart contract missing. 4 design-role panel needs implementation/acceptance. 5 shared v3 icon source not established. No visual fixture acceptance recorded by this audit.

### COMP-04

**partial · nod `in-progress`** (was `todo`). Filter builder to v3 (components repo).

**Evidence:**

- [`../sheetbase-components/packages/advanced-search/src/index.ts`](../../../../sheetbase-components/packages/advanced-search/src/index.ts):8-9 — FilterChips exported
- [`../sheetbase-components/packages/advanced-search/src/FilterChips.tsx`](../../../../sheetbase-components/packages/advanced-search/src/FilterChips.tsx):11-20,40-53 — named labels/removal/add callback
- [`../sheetbase-components/packages/advanced-search/src/FilterChips.test.tsx`](../../../../sheetbase-components/packages/advanced-search/src/FilterChips.test.tsx):1 — test exists

**Remaining:** 1 FilterBuilder popover export absent. 2 chips implementation supports existing done flag, runtime tests not rerun. 3 States crop fixture/parity outstanding.

### COMP-05

**not-started · nod `todo`** (was `todo`). Releases and consumption.

**Evidence:**

- [`package.json`](../../../package.json):84-131 — current dependencies retain existing renderers, no sheetbase component packages
- [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml):1 — no component consumption override
- [`docs/knowledge/roadmap-4/tasks/COMP.md`](tasks/COMP.md) — DEC-12 makes registry conditional

**Remaining:** 1 private registry is conditional; do not turn into public publishing assignment. 2 establish reproducible private consumption and theme mapping (none committed now). 3 integration/upgrade document absent at docs/development/sheetbase-components.md. CI frozen install/parity acceptance outstanding.

### COMP-06

**not-started · nod `todo`** (was `todo`). Replace Handsontable.

**Evidence:**

- [`src/components/sheet/sheetbase-grid.tsx`](../../../src/components/sheet/sheetbase-grid.tsx):1-2 — public wrapper remains Handsontable-specific
- [`src/components/sheet/sheetbase-grid-client.tsx`](../../../src/components/sheet/sheetbase-grid-client.tsx):1-6 — HotTable backend
- [`src/lib/formula-write.server.ts`](../../../src/lib/formula-write.server.ts):7,161 — HyperFormula authority
- [`package.json`](../../../package.json):84,119-120 — dependencies retained
- [`docs/knowledge/decisions/0048-sheet-grid-on-sheetbase-table.md`](../decisions/0048-sheet-grid-on-sheetbase-table.md):24-35 — accepted authority contract

**Remaining:** All five implementation steps remain: neutral wrapper, package backend across surfaces, editors, accepted single-engine compatibility migration, dependency/license/CSS removal. Existing grid remains working baseline; no claim of regression.

### COMP-07

**done · nod `done`** (was `partial`). Replace Recharts. **Recharts removed 2026-10-03; histogram and violin cut over to the package 0.4.0 bin/density primitives 2026-10-03.**

**Evidence:**

- [`src/lib/chart-package.ts`](../../../src/lib/chart-package.ts) — the single
  adapter from the ELN's `ChartSpec` + `MaterialisedChart` to the package's
  `FigureSvg` model, covering every `CHART_TYPES` kind: point/line, `bar`/
  `grouped_bar`/`stacked_bar`/`summary` (the package's `bar` primitive),
  `histogram` (bin primitive), `box`, `violin` (density primitive) and
  `heatmap`.
- [`src/components/viz/chart-renderer.tsx`](../../../src/components/viz/chart-renderer.tsx)
  — package figure + overlay + selection hit layer (points, bars, bins, boxes,
  violins, heatmap cells); heatmap accessible table.
- `src/components/viz/chart-plots.tsx` deleted — the ELN histogram/violin
  renderers and their dead helpers are gone; `ChartSelection`/`PlotSelectionProps`
  now live in `chart-renderer.tsx`.
- `grep -rn recharts src package.json` — empty.

**Remaining package limits (reported, not faked):** per-series colours /
palette (the v3 figure chooses `series-a/b/c` by index), number formatting (the
figure formats its own ticks) and `display.axes.{x,y}.reverse`. `display.gridlines=false`
is honoured by clearing the figure model's gridlines. The package's violin box
overlay draws the five-number summary and Tukey whiskers but not outlier
points. PNG export is rasterised by the ELN from the package-serialised SVG
because `exportChartPng` downloads directly and cannot carry the ELN's preset
dimensions, background or provenance.

## SHELL

Specification: [tasks/SHELL.md](tasks/SHELL.md).

### SHELL-01

**partial · nod `in-progress`** (was `done`). New shell and navigation.

**Evidence:**

- [`src/components/v3/shell/app-shell.tsx`](../../../src/components/v3/shell/app-shell.tsx):46-106 — current shell mounts its own palette/listener and fixed responsive nav; TopBar at 215 has no workspace switcher.
- [`src/components/v3/shell/nav.ts`](../../../src/components/v3/shell/nav.ts):15-32 — nav arrays contain no capability/role rules.
- [`src/routes/__root.tsx`](../../../src/routes/__root.tsx):125-267 — v3 shell used for listed routes; legacy ShellProvider remains for others.
- [`src/lib/request-auth.ts`](../../../src/lib/request-auth.ts):88 — active-workspace backend selection exists.

**Remaining:** Restore active-workspace switcher, role-filtered navigation, user collapse preference and uniform shell coverage; verify keyboard/focus and live counts. Existing backend switching is not current-shell integration.

### SHELL-02

**done · nod `done`** (audit said partial). Appearance setting. **Closed 2026-10-02 by `0cdd9f51`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/components/theme-provider.tsx`](../../../src/components/theme-provider.tsx):63-109 — server read/write and local cache exist, but no storage event or media-query change listener.
- [`src/components/v3/lib/theme.ts`](../../../src/components/v3/lib/theme.ts):12-58 — separate local listener Set, localStorage read/apply; no cross-tab listener.
- [`src/components/v3/shell/app-shell.tsx`](../../../src/components/v3/shell/app-shell.tsx):392-449 — account segmented control writes server appearance.

**Remaining:** Unify provider state; implement and verify cross-tab updates, live System changes and SSR/server initial preference. Persistence alone does not meet exit.

### SHELL-03

**partial · nod `in-progress`** (was `in-progress`). Keyboard shortcuts and command palette frame.

**Evidence:**

- [`src/lib/shortcuts.ts`](../../../src/lib/shortcuts.ts):132-157 — registry exists.
- [`src/components/shell/shell.tsx`](../../../src/components/shell/shell.tsx):789-966 — legacy shell mounts ShortcutProvider/dialog.
- [`src/components/v3/shell/app-shell.tsx`](../../../src/components/v3/shell/app-shell.tsx):55-64 — actual v3 shell instead has ad-hoc Cmd-K keydown.
- [`src/components/v3/search/search-palette.tsx`](../../../src/components/v3/search/search-palette.tsx):67-74 — palette installs another Cmd-K listener.

**Remaining:** Mount one registry for current v3 shell and migrated screens; restore global/list/notebook/review bindings and generated help, then verify input suppression/focus return.

### SHELL-04

**superseded · nod `cancelled`** (was `todo`). Decide the fate of surfaces outside the design.

**Evidence:**

- [`docs/knowledge/roadmap-4/tasks/SHELL.md`](tasks/SHELL.md):217-249 — DEC-03 records each route decision and target owner.
- [`docs/knowledge/roadmap-4/.nod/tasks/task-96-shell-04-decide-the-fate-of-surfaces-outside-the.md`](.nod/tasks/task-96-shell-04-decide-the-fate-of-surfaces-outside-the.md) — parent remains todo while child steps cancelled.
- [`src/routes/projects/$projectId/milestones.tsx`](../../../src/routes/projects/$projectId/milestones.tsx):53-58 — planner replacement exists; route inventory no longer includes planner/storage/report-builder/instrument-monitor standalone routes.

**Remaining:** Treat decision work as superseded by accepted DEC-03; preserve implementation obligations under PROJ/LAB/PIPE rather than reopening cancelled duplicate steps. Do not infer feature completion from retired routes.

### SHELL-05

**implemented-unverified · nod `done`** (was `done`). Narrow screens.

**Evidence:**

- [`src/components/v3/shell/app-shell.tsx`](../../../src/components/v3/shell/app-shell.tsx):79-102 — full nav at xl, rail at lg, drawer below.
- [`tests/browser-scripts/phone.mjs`](../../../tests/browser-scripts/phone.mjs) — responsive coverage exists.
- [`docs/knowledge/roadmap-4/CHECKLIST.md`](CHECKLIST.md):124-126 — breakpoint step done; old board registration cancelled.

**Remaining:** Verify current tablet/laptop inspector behavior and touch targets against current acceptance scope; cancelled old parity-registration step should remain cancelled.

## WORK

Specification: [tasks/WORK.md](tasks/WORK.md).

### WORK-01

**partial · nod `in-progress`** (was `todo`). Work items.

**Evidence:**

- [`drizzle/0273_inbox_scope_and_gov01.sql`](../../../drizzle/0273_inbox_scope_and_gov01.sql):8-106 — current security-invoker work-items view includes reviews, failed runs, data issues, expiring materials and follows.
- [`src/lib/work-items/data.ts`](../../../src/lib/work-items/data.ts):16-35 — only five kinds represented.
- [`docs/knowledge/roadmap-4/CHECKLIST.md`](CHECKLIST.md):132-137 — later kinds remain open.

**Remaining:** Add signature requests, waiting runs, approvals and conflicts when source capabilities exist; verify full seeded exit and automatic removal upon canonical completion.

### WORK-02

**done · nod `done`** (audit said partial). Home and Inbox pages. **Closed 2026-10-02 by `468b7e95`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/routes/index.tsx`](../../../src/routes/index.tsx):117-124 — Continue working selects recent workspace experiments rather than personal recents.
- [`src/routes/index.tsx`](../../../src/routes/index.tsx):350-357 — empty state has no first-run checklist.
- [`src/routes/inbox.tsx`](../../../src/routes/inbox.tsx):91-125 — current Inbox state/filter selection exists; no scoped-shortcut registration or keydown handler anywhere in file.
- [`src/routes/help/records.tsx`](../../../src/routes/help/records.tsx):137 — records help exists.

**Remaining:** Complete state-derived first run and personal recents, restore Inbox J/K and verify required review inspector/empty states.

### WORK-03

**partial · nod `in-progress`** (was `todo`). Notifications and preferences.

**Evidence:**

- [`drizzle/0203_notifications.sql`](../../../drizzle/0203_notifications.sql):28-61 — producer handles review request and signature creation only.
- [`src/lib/email-delivery.server.ts`](../../../src/lib/email-delivery.server.ts) — durable email worker implementation exists.
- [`src/lib/email-scheduler.server.ts`](../../../src/lib/email-scheduler.server.ts) — scheduler exists.
- [`src/components/v3/shell/app-shell.tsx`](../../../src/components/v3/shell/app-shell.tsx):340-384 — current bell renders notifications.

**Remaining:** Complete all eight event producers/addressing and channel mapping; validate preferences, quiet hours, digest and durable delivery end-to-end. Existing outbox code is not proof all events route.

### WORK-04

**partial · nod `in-progress`** (was `todo`). Schedule.

**Evidence:**

- [`src/routes/schedule.tsx`](../../../src/routes/schedule.tsx):78-214 — day/week, bookings, review/material panels implemented.
- [`src/routes/schedule.tsx`](../../../src/routes/schedule.tsx):234 — unavailable state uses weekend assumption.
- [`src/components/v3/schedule/schedule-data.ts`](../../../src/components/v3/schedule/schedule-data.ts):151-167 — bookInstrument delegates to existing createBooking.
- [`src/routes/schedule.tsx`](../../../src/routes/schedule.tsx):613-632 — dialog submits directly; no next-free-slot or qualification check.

**Remaining:** Implement real availability, next-free-slot/clash preview and server calibration/qualification refusal; verify active experiment readiness and schedule exit.

## PROJ

Specification: [tasks/PROJ.md](tasks/PROJ.md).

### PROJ-01

**partial · nod `in-progress`** (was `done`). Project properties and list.

**Evidence:**

- [`drizzle/0237_black_ender_wiggin.sql`](../../../drizzle/0237_black_ender_wiggin.sql):16 — typed client property migration.
- [`drizzle/0238_project_details_clients.sql`](../../../drizzle/0238_project_details_clients.sql):157 — update_project_details exists.
- [`src/components/v3/projects/projects-page.tsx`](../../../src/components/v3/projects/projects-page.tsx):101-145 — URL-backed filters/sorts and archive exclusion.
- [`src/components/v3/projects/projects-page.tsx`](../../../src/components/v3/projects/projects-page.tsx):693-790 — new-project dialog accepts title/client/stage only; no copy-structure selection.

**Remaining:** Finish copy-structure workflow over members/milestones/protocols, preserving no-record-copy invariant; verify list/dialog acceptance and archived read-only behavior.

### PROJ-02

**partial · nod `in-progress`** (was `todo`). Milestones.

**Evidence:**

- [`src/routes/projects/$projectId/milestones.tsx`](../../../src/routes/projects/$projectId/milestones.tsx):53-58 — uses study_tasks milestone and study_deliverables.
- [`src/routes/projects/$projectId/milestones.tsx`](../../../src/routes/projects/$projectId/milestones.tsx):156-233 — create, due-date change, visibility and mark-done mutations.
- [`src/routes/projects/$projectId/index.tsx`](../../../src/routes/projects/$projectId/index.tsx):119-165 — overview milestones use live read model.

**Remaining:** Record current study-task/deliverable choice in canonical task; verify/complete reorder and evidence linking/derived completion rather than manual done alone; verify overview variants. Earlier read-only-baseline prose is stale.

### PROJ-03

**partial · nod `in-progress`** (was `todo`). Members, roles and project settings.

**Evidence:**

- [`drizzle/0182_project_settings_enforcement.sql`](../../../drizzle/0182_project_settings_enforcement.sql):3-7 — independent reviewer implemented; effective protocol delegated to future owner.
- [`drizzle/0252_client_portal_project_switch.sql`](../../../drizzle/0252_client_portal_project_switch.sql):22-52 — automatic sharing switch participates in portal reads.
- [`drizzle/0244_project_members.sql`](../../../drizzle/0244_project_members.sql):51-75 — members expose access level and is_lead, not full project-role/training contract.
- [`src/routes/projects/$projectId/members.tsx`](../../../src/routes/projects/$projectId/members.tsx):147-167 — current lead/access UI.

**Remaining:** Complete project roles/groups/training display and effective-protocol server enforcement; verify settings/archive permissions. Store-only effective flag contradicts completed settings step.

### PROJ-04

**partial · nod `in-progress`** (was `todo`). Folders and files.

**Evidence:**

- [`src/routes/projects/$projectId/folders.tsx`](../../../src/routes/projects/$projectId/folders.tsx):65-121 — reads project records and moves selected record IDs only.
- [`src/db/schema.ts`](../../../src/db/schema.ts):719 — placement is records.folder_id.
- [`src/routes/experiments/$expId/files.tsx`](../../../src/routes/experiments/$expId/files.tsx) — current files surface exists; src/routes/projects/$projectId.tsx:99 links folders but has no Files route/tab.

**Remaining:** Mixed-kind placement and project Files surface remain; deliver explicit file version chain/new-version upload, retained old downloads and parser/parsed-into/retention provenance. Validate cross-project refusal.

## EXP

Specification: [tasks/EXP.md](tasks/EXP.md).

### EXP-01

**partial · nod `in-progress`** (was `done`). Experiment page frame and tabs.

**Evidence:**

- [`src/routes/experiments/$expId/samples.tsx`](../../../src/routes/experiments/$expId/samples.tsx):7-15 and datasets.tsx:7-15 — both delegate to generic LinkTab.
- [`src/routes/experiments/$expId/links-tab.tsx`](../../../src/routes/experiments/$expId/links-tab.tsx):29-74 — only linked ID and link type; no sample inspector or dataset row/provenance view.
- [`src/routes/experiments/$expId/results.tsx`](../../../src/routes/experiments/$expId/results.tsx):67-124 — real results/decision reads present.
- [`src/routes/experiments/$expId/history.tsx`](../../../src/routes/experiments/$expId/history.tsx):25-39 — History is revision list.

**Remaining:** Route split and real tabs exist, but complete sample lineage/properties/print actions and dataset filtered-row/provenance inspector; check list open-issues contract and seven-tab acceptance.

### EXP-02

**partial · nod `in-progress`** (was `todo`). Overview: plan, progress and readiness.

**Evidence:**

- [`src/routes/experiments/$expId/overview.tsx`](../../../src/routes/experiments/$expId/overview.tsx):101-132 — protocol links followed by explicit 'Step progress is not modelled' message.
- [`src/routes/experiments/$expId/overview.tsx`](../../../src/routes/experiments/$expId/overview.tsx):135-190 — key results show links/placeholder, not readiness.
- Search of current src and drizzle found no experiment_readiness RPC.

**Remaining:** Implement server readiness shared with submit, protocol-step progress/evidence, follows/upstream creation and exact resolving deep links.

### EXP-03

**partial · nod `in-progress`** (was `todo`). New experiment from a protocol.

**Evidence:**

- [`src/routes/experiments/new.tsx`](../../../src/routes/experiments/new.tsx):72-81 — protocol selector lists records without effective version identity.
- [`src/routes/experiments/new.tsx`](../../../src/routes/experiments/new.tsx):107-123 — creates blank draft then applies reviewer/end/setup in separate operations.
- Search current src/drizzle found no start_experiment or set_experiment_status RPC.

**Remaining:** Controlled lifecycle, private drafts, server start checklist/effective version/training, follows/material copy and verified draft deletion/ID nonreuse remain; existing creation page alone does not meet exit.

### EXP-04

**partial · nod `in-progress`** (was `todo`). Notebook working surface.

**Evidence:**

- [`src/routes/records/$recordId/notebook.tsx`](../../../src/routes/records/$recordId/notebook.tsx):2259-2261 — inspector describes Properties/History/Activity rather than full selected-cell/comments contract.
- [`src/components/notebook/notebook-document.tsx`](../../../src/components/notebook/notebook-document.tsx):499-500 — read-only and block discussion behavior exist.
- [`src/lib/collaboration/types.ts`](../../../src/lib/collaboration/types.ts):81-123 — Sheet row/cell anchors absent.
- [`src/components/notebook/slash-command-menu.tsx`](../../../src/components/notebook/slash-command-menu.tsx) — existing insert menu present.

**Remaining:** Complete v3 notebook states, selected-cell provenance/validation inspector, row threads, view-only request-access and pipeline proposal experience; establish per-state visual/semantic acceptance rather than treating existing editor as full task.

### EXP-05

**not-started · nod `todo`** (was `todo`). Offline editing and conflict resolution.

**Evidence:**

- [`docs/knowledge/decisions/0018-notebook-autosave-and-conflict.md`](../decisions/0018-notebook-autosave-and-conflict.md): amendment requires IndexedDB per user/workspace/record and sign-out retention.
- [`src/components/notebook/use-autosave.ts`](../../../src/components/notebook/use-autosave.ts) — inherited in-memory offline hold exists.
- Search current src/drizzle found no indexedDB/IndexedDB storage or resolve_cell_conflict; src/lib/offline directory absent.

**Remaining:** Implement all five new durable-offline steps; do not count prior in-memory autosave as Roadmap 4 delivery. Verify reconnect, two-user conflicts and same-user sign-out retention.

### EXP-06

**partial · nod `in-progress`** (was `todo`). History tab.

**Evidence:**

- [`src/routes/experiments/$expId/history.tsx`](../../../src/routes/experiments/$expId/history.tsx):25-39 — selects only revisions with reason/time/digest and limit 50.
- [`src/routes/experiments/$expId/history.tsx`](../../../src/routes/experiments/$expId/history.tsx):47-75 — simple table; no actor/category filters, inspector or CSV action.

**Remaining:** Restore real audit timeline with category/actor filters, old/new/reason/session/knock-on details, workspace timezone and matching filtered export; completed History step contradicted by current code.

## SRCH

Specification: [tasks/SRCH.md](tasks/SRCH.md).

### SRCH-01

**partial · nod `in-progress`** (was `todo`). Search coverage.

**Evidence:**

- [`src/lib/search.ts`](../../../src/lib/search.ts):810-836 — separate cell/file-content RPC helpers exist.
- [`docs/knowledge/roadmap-4/tasks/SRCH.md`](tasks/SRCH.md):41-72 — published Dataset cells and CSV/TXT/JSON extraction implemented; Sheet values/PDF extraction still deferred.
- [`tests/db/comment-search.test.ts`](../../../tests/db/comment-search.test.ts) and tests/db/dataset-cell-search.test.ts — targeted contract tests exist.

**Remaining:** Complete Sheet-cell indexing and PDF text extraction, integrate coverage into user-visible search, verify archived behavior and populated scale/permission evidence; tests were not run.

### SRCH-02

**done · nod `done`** (audit said partial). ⌘K palette and results page. **Closed 2026-10-02 by `91601b87`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/components/v3/search/search-palette.tsx`](../../../src/components/v3/search/search-palette.tsx):86 — palette requests eight search results; keyboard logic at 118-129.
- [`src/routes/search.tsx`](../../../src/routes/search.tsx):102-136 — requests top 100 unfiltered then local facets/filters.

**Remaining:** Complete scope/contextual palette actions and multi-type/project/date filtering on server with stable pagination/counts; verify keyboard new-tab and focus return.

## MOB

Specification: [tasks/MOB.md](tasks/MOB.md).

### MOB-01

**partial · nod `in-progress`** (was `todo`). Phone shell.

**Evidence:**

- [`src/components/v3/shell/app-shell.tsx`](../../../src/components/v3/shell/app-shell.tsx):89-104 — bottom tabs and navigation drawer exist.
- [`src/routes/index.tsx`](../../../src/routes/index.tsx):189 onward — shared dashboard, no dedicated compact Today state.
- [`tests/browser-scripts/phone.mjs`](../../../tests/browser-scripts/phone.mjs) — viewport checks exist.

**Remaining:** Complete exact phone header/back and compact Today/Inbox behavior including review/sign larger-screen guidance; verify 390px touch/accessibility acceptance.

### MOB-02

**partial · nod `in-progress`** (was `todo`). Bench flows.

**Evidence:**

- [`src/routes/scan.tsx`](../../../src/routes/scan.tsx):72-106 — actual camera stream and BarcodeDetector scanning plus typed fallback.
- [`src/routes/samples/$sampleId.tsx`](../../../src/routes/samples/$sampleId.tsx):59-65 — withdrawal uses consumeSample.
- [`src/routes/readings/new.tsx`](../../../src/routes/readings/new.tsx):60-83 — standalone measurement insert, no planned row/range/dilution/photo.

**Remaining:** Finish planned-row reading with scientific validation/dilution/photo, destination-aware withdrawal/numeric keypad and evidence/model record phone acceptance; scan is implemented but full bench exit not met.

## DSET

Specification: [tasks/DSET.md](tasks/DSET.md).

### DSET-01

**partial · nod `in-progress`** (was `todo`). Value flags and repeats.

**Evidence:**

- [`drizzle/0194_dataset_value_flags.sql`](../../../drizzle/0194_dataset_value_flags.sql):27-111 — manual flag/clear RPCs
- [`drizzle/0196_snapshot_flags.sql`](../../../drizzle/0196_snapshot_flags.sql):29-31 — flags frozen
- [`drizzle/0198_planned_dataset_rows.sql`](../../../drizzle/0198_planned_dataset_rows.sql):7-56 — single planned row/no-values enforcement
- [`src/lib/pipeline-execute.server.ts`](../../../src/lib/pipeline-execute.server.ts):758-765 — pipeline exclusion
- [`src/lib/analysis-definition.ts`](../../../src/lib/analysis-definition.ts):300-312 — analysis exclusion
- [`src/routes/datasets/$datasetId/rows.tsx`](../../../src/routes/datasets/$datasetId/rows.tsx):137 — manual flag UI

**Remaining:** 1 manual flags and snapshots exist; system rule-generated flags and clear reason contract incomplete. 2 chart/analysis/pipeline coverage exists, criteria/formula exclusion and complete visible reporting not established. 3 planned-row shell exists but later import matching/fill by sample/well absent. 4 atomic derived-sample repeat request absent. 5 dataset flag UI exists; notebook/experiment selected-value actions need full workflow acceptance.

### DSET-02

**partial · nod `in-progress`** (was `todo`). Dataset explorer.

**Evidence:**

- [`src/routes/datasets/$datasetId/rows.tsx`](../../../src/routes/datasets/$datasetId/rows.tsx):66-147 — data view and flags
- [`src/routes/datasets/$datasetId.tsx`](../../../src/routes/datasets/$datasetId.tsx):42 — dataset frame
- [`src/routes/datasets/$datasetId/compare.tsx`](../../../src/routes/datasets/$datasetId/compare.tsx):65 — comparison tab
- `src/routes/datasets/$datasetId/imports.tsx` is absent; no `set_dataset_field_unit` found in `src` or `drizzle`.

**Remaining:** 1 list/detail/data(rows)/columns/snapshots/compare/history partly implemented; import/legacy redirect parity needs closure. 2 list exists but full issue inspector/partial-error acceptance unverified. 3 import read model and complete Used-by missing. 4 audited unit correction RPC with schema/snapshot/parser mapping updates absent.

### DSET-03

**done · nod `done`** (audit said partial). Snapshots and comparison. **Closed 2026-10-03 by `4bf62ec0`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`drizzle/0183_dataset_version_compare.sql`](../../../drizzle/0183_dataset_version_compare.sql):71-85,118-130 — comparison reads values only; no dataset_version_flags
- [`tests/db/dataset-version-compare.test.ts`](../../../tests/db/dataset-version-compare.test.ts):49-51,117-119 — purported flag-only test changes ordinary boolean field
- [`drizzle/0187_dataset_retention.sql`](../../../drizzle/0187_dataset_retention.sql):106-121 — list has creator/count/change/retention but no full cited-by/source read model
- [`src/routes/datasets/$datasetId/snapshots.tsx`](../../../src/routes/datasets/$datasetId/snapshots.tsx):82-84 — hardcoded Kept
- [`src/routes/datasets/$datasetId/compare.tsx`](../../../src/routes/datasets/$datasetId/compare.tsx):65-70 — fixed first 100 results

**Remaining:** 1 complete maker/import/run/hash/cited-by read model and truthful retention presentation. 2 canonical flag-only changes currently invisible; existing boolean-field test does not meet exit. 3 snapshot/compare routes exist but manual snapshot action, complete inspector and >100 change paging need closure. Entire done claim contradicted by canonical flag comparison exit.

### DSET-04

**done · nod `done`** (audit said partial). Snapshot retention. **Closed 2026-10-03 by `cda5daec`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/db/schema.ts`](../../../src/db/schema.ts):413-419 — workspace retention defaults exist
- [`drizzle/0189_dataset_version_keep.sql`](../../../drizzle/0189_dataset_version_keep.sql):11-44 — keep RPC with reason
- [`drizzle/0191_dataset_version_prune.sql`](../../../drizzle/0191_dataset_version_prune.sql):25-94 — protected pruning function and tombstone writes
- [`src/routes/datasets/$datasetId/snapshots.tsx`](../../../src/routes/datasets/$datasetId/snapshots.tsx):82-84,122-125 — hardcoded Kept and policy text
- Search of `src` and `scripts` — no caller scheduling prune_dataset_versions; no settings edit, keep action or removed snapshot page found

**Remaining:** 1 backend policy exists; workspace settings editing not found, acceptance unverified. 2 prune function exists and DB tests cover direct invocation, but a scheduled job invoking it is missing. 3 keep RPC exists; warning, keep UI and tombstone screen absent. Preserve backend work credit while reopening job-completion claim.

### DSET-05

**partial · nod `in-progress`** (was `todo`). Import flow.

**Evidence:**

- [`src/components/import/import-wizard.tsx`](../../../src/components/import/import-wizard.tsx):86-100,149-157 — browser preview/mapping/whole-file parse
- [`src/lib/import-parse.ts`](../../../src/lib/import-parse.ts):5-8 — 10MiB/1000 limits unchanged
- [`src/lib/import-commit.ts`](../../../src/lib/import-commit.ts):77-95 — one canonical dataset batch
- [`docs/knowledge/roadmap-4/tasks/DSET.md`](tasks/DSET.md):245-257 — raw file/parser/planned-row/streaming exits

**Remaining:** 1 route/wizard exists but raw-file checksum-first persisted stepper workflow incomplete. 2 registered parser recognition absent in wizard. 3 mapping exists but parser-default persistence/units incomplete. 4 planned/new/flagged/skipped server outcome preview and one snapshot/history absent. 5 three recovery choices incomplete. 6 streaming/workload limit exit not implemented.

### DSET-06

**not-started · nod `todo`** (was `todo`). Parsers per instrument.

**Evidence:**

- [`src/lib/connectors/registry.ts`](../../../src/lib/connectors/registry.ts):1 — existing connector registry baseline
- [`src/db/schema.ts`](../../../src/db/schema.ts) — no parsers/parser_versions model
- [`docs/knowledge/roadmap-4/tasks/DSET.md`](tasks/DSET.md) — versioned parser task differs from existing connector ingestion

**Remaining:** All three steps remain: parser definitions/versions and test-file validation/QA approval; parser-version import provenance and governed gating; instrument settings plus failure work items. Existing connectors are not versioned instrument parser approval.

## SHEET

Specification: [tasks/SHEET.md](tasks/SHEET.md).

### SHEET-01

**partial · nod `in-progress`** (was `todo`). Working sheet surface.

**Evidence:**

- [`src/lib/sheet-instance.ts`](../../../src/lib/sheet-instance.ts):55-67 — live/version source policy already exists
- [`drizzle/0074_core_033_sheet_instance_controls.sql`](../../../drizzle/0074_core_033_sheet_instance_controls.sql):83 — version ownership validation
- [`src/lib/sheet-composition-data.ts`](../../../src/lib/sheet-composition-data.ts):154-166 — coherent revision paging
- [`src/routes/sheets/new.tsx`](../../../src/routes/sheets/new.tsx):56-70 — start links
- [`src/routes/sheets/$sheetId.tsx`](../../../src/routes/sheets/$sheetId.tsx):51-74 — context/header, explicit comment-anchor limitation

**Remaining:** 1 do not re-create pin storage; verify actual working-sheet pinned reads and add explicit audited update-source-version workflow. 2 source headers/inspector incomplete pending COMP-02. 3 empty-start screen exists, but snapshot/template/import links are not proof complete direct starts. 4 dataset-row addition/notebook embedding workflow needs acceptance. Original task baseline claiming no pins is outdated.

### SHEET-02

**not-started · nod `todo`** (was `todo`). Promote local columns.

**Evidence:**

- [`src/lib/schema-evolution.ts`](../../../src/lib/schema-evolution.ts):106-127 — immediate promote_local_field wrapper remains
- [`drizzle/0096_core_055_evolution_promotion.sql`](../../../drizzle/0096_core_055_evolution_promotion.sql):170 — immediate publish path
- [`src/components/sheet/canonical-sheet-lifecycle-panel.tsx`](../../../src/components/sheet/canonical-sheet-lifecycle-panel.tsx):310-338 — explicit materialization is a different existing operation
- [`src/db/schema.ts`](../../../src/db/schema.ts) — no promotion/approval request model

**Remaining:** 1 approval-backed promotion request absent. 2 approval transaction/snapshot/rebind and returned-state path absent. 3 request/returned UI absent. 4 direct UI caller no longer found, but governance path not implemented; do not confuse materialization with approved column promotion. Depends MDL-03.

### SHEET-03

**not-started · nod `todo`** (was `todo`). Sheet-cell and range comments.

**Evidence:**

- [`src/db/schema.ts`](../../../src/db/schema.ts):1537-1538 — comment target constraint only revision/block/table_region/diff
- [`src/routes/sheets/$sheetId.tsx`](../../../src/routes/sheets/$sheetId.tsx):74 — presence only, row-thread anchors await contract

**Remaining:** Both steps remain: stable canonical Sheet row/cell/range target model with stability proofs, then markers/inspector/shortcut/record comments/search. Existing table_region dataset comments are not Sheet cell anchors.

### SHEET-04

**partial · nod `in-progress`** (was `todo`). Templates.

**Evidence:**

- [`src/components/v3/templates/templates-data.ts`](../../../src/components/v3/templates/templates-data.ts):20-22,111-128 — notebook-template catalogue and in-use counts
- [`src/routes/templates/$templateId/update.tsx`](../../../src/routes/templates/$templateId/update.tsx):45-79 — real preview and revision-checked apply
- [`src/lib/notebook-template-data.ts`](../../../src/lib/notebook-template-data.ts) — existing canonical lifecycle/upgrade RPCs

**Remaining:** 1 REUSE-02 old failing component was retired; no fresh proof of equivalent default-value regression acceptance located, do not perpetuate historical failure as current. 2 catalogue notebook-only, not notebook/sheet/record across kinds. 3 editor incomplete for all sheet field definitions/change/impact scope. 4 update preview/apply exists; notebook banner and signed/no-rewrite end-to-end acceptance remain unverified.

### SHEET-05

**partial · nod `in-progress`** (was `todo`). Analysis workspace.

**Evidence:**

- [`src/lib/analysis-definition.ts`](../../../src/lib/analysis-definition.ts):4-11,41-44 — single Dataset contract
- [`src/lib/chart-data.ts`](../../../src/lib/chart-data.ts):243-252 — only first Dataset source resolved
- [`src/lib/analysis-studio-data.ts`](../../../src/lib/analysis-studio-data.ts):46-48 — bounded view contract
- [`src/routes/experiments/$expId/results.tsx`](../../../src/routes/experiments/$expId/results.tsx):119-209 — cited analyses/datasets/decision
- [`src/lib/sheet-materialization-data.ts`](../../../src/lib/sheet-materialization-data.ts):86-125 — existing explicit materialization route to canonical Dataset

**Remaining:** 1 multi-source/server join/match report missing; existing Sheet materialization is reusable bridge, not missing new engine. 2 multiple chart/shared axes/calculated-field workspace incomplete. 3 frozen evidence exists but complete versioned rerun/stale workflow needs acceptance. 4 existing exclusions/analysis views do not establish all Diagnostics/Versions exits. 5 Results tab implemented, figure/table/provenance rendering and seeded exit still need acceptance.

## MDL

Specification: [tasks/MDL.md](tasks/MDL.md).

### MDL-01

**done · nod `done`** (audit said not-started). Workspace-defined record models. **Closed 2026-10-03 by `4e69f5b6`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`docs/knowledge/decisions/0051-workspace-defined-record-models.md`](../decisions/0051-workspace-defined-record-models.md):24-48 — accepted generic host decision
- [`src/db/schema.ts`](../../../src/db/schema.ts):1621-1630 — global model_kinds, no workspace record_models
- [`src/components/v3/models/models-data.ts`](../../../src/components/v3/models/models-data.ts):17-22 — Models UI uses Dataset schema registry

**Remaining:** Accepted decision is complete; all three implementation steps remain: workspace-owned versioned model identity/prefix and RLS; generic records/validation/search/lineage; API/SDK exposure. Dataset schema models do not satisfy custom record kinds.

### MDL-02

**partial · nod `in-progress`** (was `in-progress`). Model editor.

**Evidence:**

- [`src/routes/models/$modelId/edit.tsx`](../../../src/routes/models/$modelId/edit.tsx):49-52,110-114,136-164 — Dataset schema draft editor exists
- [`src/routes/models/$modelId/versions.tsx`](../../../src/routes/models/$modelId/versions.tsx):69-99 — status/date/publish table
- [`src/routes/models/$modelId/datasets.tsx`](../../../src/routes/models/$modelId/datasets.tsx):20-23 — dataset instances in place of model records
- [`src/components/v3/models/models-data.ts`](../../../src/components/v3/models/models-data.ts):17-22 — current model semantics

**Remaining:** 1 partial routes; rules/relations/usage/record surfaces absent. 2 model_rules with submit effects absent. 3 draft editing exists, reason/record impact/open-experiment migration flow absent. 4 version status list lacks what happened to records. Preserve editor progress; do not mark full model domain complete.

### MDL-03

**done · nod `done`** (audit said not-started). Approval of model versions. **Closed 2026-10-03 by `085ded29`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`drizzle/0094_core_052_capabilities.sql`](../../../drizzle/0094_core_052_capabilities.sql):393-420 — publish requires capability/draft then immediately activates; no approval request
- [`src/routes/models/$modelId/versions.tsx`](../../../src/routes/models/$modelId/versions.tsx):37-44 — direct publish action
- [`src/db/schema.ts`](../../../src/db/schema.ts) — no approval_requests

**Remaining:** All three steps remain: reusable request/role/state model; approval-gated publication with independence/withdraw/return/work items; pending UI. Capability authorization is not approval.

### MDL-04

**done · nod `done`** (audit said not-started). Model lists, generated forms and record pages. **Closed 2026-10-03 by `6c11aefb`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/routes/models/$modelId/datasets.tsx`](../../../src/routes/models/$modelId/datasets.tsx):20-42 — lists Dataset schema instances, not generic records
- [`src/components/v3/models/models-data.ts`](../../../src/components/v3/models/models-data.ts):17-22 — record/measurement split not represented
- [`src/routes/records/$recordId/notebook.tsx`](../../../src/routes/records/$recordId/notebook.tsx) — canonical notebook rather than proposed generated model record detail

**Remaining:** All three steps remain after MDL-01: field-driven record list/filter/export; generated versioned form with matching server errors and ID preview; sectioned record detail with version additions, used-by/history/integration results. Existing field editors are reusable baseline only.

## LAB

Specification: [tasks/LAB.md](tasks/LAB.md).

### LAB-01

**done · nod `done`** (audit said partial). Withdrawals and reservations. **Closed 2026-10-03 by `58018eb1`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/routes/samples/$sampleId.tsx`](../../../src/routes/samples/$sampleId.tsx):59-65 — withdraw passes quantity/notes to consumeSample.
- [`src/routes/samples/$sampleId/usage.tsx`](../../../src/routes/samples/$sampleId/usage.tsx):27-40 — usage reads record_links, not quantity/reservation ledger.
- Search current src/drizzle found no withdraw_sample or sample_reservations.

**Remaining:** Purpose/derived-container withdrawal, reservations and used/reserved/free semantics remain; preserve sample_events authority and enforce reserved-volume refusal server-side.

### LAB-02

**done · nod `done`** (audit said not-started). Hold time, quarantine and release. **Closed 2026-10-03 by `3e7cadf5`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/routes/samples/$sampleId.tsx`](../../../src/routes/samples/$sampleId.tsx):109 — UI active state only distinguishes consumed/expired.
- Search current src/drizzle found no hold_exceeded or release_sample implementation.
- [`docs/knowledge/roadmap-4/tasks/LAB.md`](tasks/LAB.md):95-114 — new hold/release job/rules are required beyond existing quarantine.

**Remaining:** Implement timed hold fields/system transition, allowed uses, measurement-based authorized release and disposal; existing generic sample status is baseline, not completion.

### LAB-03

**done · nod `done`** (audit said partial). Sample record pages. **Closed 2026-10-03 by `a303d027`** — see [update since this audit](#update-since-this-audit); the remaining-work note below is the audit's and is retained for history.

**Evidence:**

- [`src/routes/samples/$sampleId/measurements.tsx`](../../../src/routes/samples/$sampleId/measurements.tsx):51-56 — reads sample_measurements.
- [`src/routes/samples/$sampleId/measurements.tsx`](../../../src/routes/samples/$sampleId/measurements.tsx):159-170 — editable Record measurement action writes standalone measurement RPC.
- [`docs/knowledge/roadmap-4/tasks/LAB.md`](tasks/LAB.md):128-157 — explicitly requires read-only Dataset/integration aggregation with source-row links.
- [`src/routes/samples/$sampleId/history.tsx`](../../../src/routes/samples/$sampleId/history.tsx) — sample event history exists.

**Remaining:** Resolve measurement workflow conflict: aggregate authoritative Dataset/integration values with row provenance, then complete label/hold meter and verify lineage/details acceptance. Current measurement tab is implemented differently, not accepted task delivery.

### LAB-04

**partial · nod `in-progress`** (was `todo`). Materials and lots.

**Evidence:**

- [`src/routes/materials.tsx`](../../../src/routes/materials.tsx):50-60 — Materials tabs wrap built-in reagent records; receive uses reagent movement.
- [`drizzle/0273_inbox_scope_and_gov01.sql`](../../../drizzle/0273_inbox_scope_and_gov01.sql):64 — expiring material work items exist.
- [`docs/knowledge/decisions/0051-workspace-defined-record-models.md`](../decisions/0051-workspace-defined-record-models.md) — materials remain built-in.

**Remaining:** Complete replacement lot/quarantine/certificate/release metadata and server refusal for expired/quarantined references in all experiment/material/Sheet paths; surface/rename does not establish enforcement.

### LAB-05

**partial · nod `in-progress`** (was `todo`). Labels and scanning.

**Evidence:**

- [`src/routes/scan.tsx`](../../../src/routes/scan.tsx):75-87 — BarcodeDetector capability test and camera path; typed fallback when unsupported.
- Current src/routes inventory has no /r/$identifier resolver and no label/print route.
- [`docs/knowledge/roadmap-4/tasks/LAB.md`](tasks/LAB.md):199-236 — accepted browser-print URL payload decision.

**Remaining:** Implement label model/QR render and audited browser print, stable URL resolver and scanner fallback; verify printed-label round trip and history. Existing typed scan is not label completion.

### LAB-06

**partial · nod `in-progress`** (was `todo`). Instruments: identity, calibration and qualification.

**Evidence:**

- [`src/routes/instruments/$instrumentId.tsx`](../../../src/routes/instruments/$instrumentId.tsx):70-128 — calibration records/history and due status.
- [`src/routes/instruments/$instrumentId.tsx`](../../../src/routes/instruments/$instrumentId.tsx):272-307 — calibration write dialog.
- [`drizzle/0257_overconfident_the_fallen.sql`](../../../drizzle/0257_overconfident_the_fallen.sql):1 — instrument calibration table and capability.
- [`src/components/v3/schedule/schedule-data.ts`](../../../src/components/v3/schedule/schedule-data.ts):151-167 — bookings use unqualified generic createBooking.

**Remaining:** Complete qualified-for/user qualification, booking checks, rename/location/signed-name preservation and used-by/telemetry acceptance; calibration alone covers only part of step 2.

### LAB-07

**partial · nod `in-progress`** (was `todo`). Controlled protocols.

**Evidence:**

- [`src/db/schema.ts`](../../../src/db/schema.ts):3479-3508 — protocol training keyed by protocol record/user, no version.
- [`src/routes/protocols/$protocolId.tsx`](../../../src/routes/protocols/$protocolId.tsx):482-489 — manual training status write.
- [`src/routes/experiments/$expId/overview.tsx`](../../../src/routes/experiments/$expId/overview.tsx):130-132 — explicitly no protocol version stored in this experiment surface.
- [`docs/knowledge/roadmap-4/tasks/LAB.md`](tasks/LAB.md):296-338 — controlled versions/acknowledgement/start/deviation requirements.

**Remaining:** Complete effective/superseded lifecycle, per-version training/enforcement/reminders, periodic review and pinned-version deviation history; respect regulated-use decision gates. Existing Training tab is not controlled protocol delivery.

## PIPE

Specification: [tasks/PIPE.md](tasks/PIPE.md).

### PIPE-01

**partial · nod `in-progress`** (was `in-progress`). Pipeline screens.

**Evidence:**

- [`src/routes/pipelines/$pipelineId/steps.tsx`](../../../src/routes/pipelines/$pipelineId/steps.tsx):17 — version editor saves a single transform/description/output; lines 166-184 render one SQL textarea, no per-step dry-run.
- [`src/routes/pipelines/$pipelineId/runs/$runId.tsx`](../../../src/routes/pipelines/$pipelineId/runs/$runId.tsx):95 — real failure banner; lines 103-163 show retained Dataset snapshots and run logs.
- [`src/lib/pipelines/config.ts`](../../../src/lib/pipelines/config.ts):80 — SQL/Python ordered steps exist in engine; src/routes/api/pipelines/execute.ts:5 only executes an existing run, no test-this-step endpoint.

**Remaining:** 1 List/inspector needs acceptance against full starts-on/keeps/allowed-actions contract; 2 ordered SQL/Python/ELN/Notify editor, pinned preview inputs and rollback-only Test this step absent; 3 complete keeps selector and trigger/output/service identity summaries; 4 per-step durations/output preview/temp deletion timing and failed-run fixes. Existing pages are real, not complete task parity.

### PIPE-02

**not-started · nod `todo`** (was `todo`). Waiting for a person.

**Evidence:**

- [`src/db/schema.ts`](../../../src/db/schema.ts):7770 — run status CHECK remains running/succeeded/failed/cancelled, no waiting.
- [`src/lib/pipelines/config.ts`](../../../src/lib/pipelines/config.ts):80 — steps permit only sql/python; no confirm step or pipeline_run_prompts table found in source/migrations.
- [`docs/knowledge/roadmap-4/tasks/PIPE.md`](tasks/PIPE.md):116 — task requires durable prompts/resume/expiry and person attribution.

**Remaining:** All four steps: waiting schema, bounded persisted temporary state and resume/skip/stop/expiry, person-attributed history plus work/email notification, waiting UI.

### PIPE-03

**not-started · nod `todo`** (was `todo`). ELN actions as proposals.

**Evidence:**

- [`src/lib/pipelines/config.ts`](../../../src/lib/pipelines/config.ts):67 — action shape only name/operation/arguments, no propose mode.
- [`src/lib/pipeline-actions.server.ts`](../../../src/lib/pipeline-actions.server.ts) — executor uses existing direct canonical action dispatch; existing agent proposal surface is separate.
- [`docs/knowledge/roadmap-4/tasks/PIPE.md`](tasks/PIPE.md):147 — requested proposal block/run linkage/accept-as-person scope.

**Remaining:** All three steps: pipeline proposal persistence instead of immediate action, accept/reject/supersession lifecycle with person/run attribution, in-place notebook Compare/Accept/Reject.

### PIPE-04

**not-started · nod `todo`** (was `todo`). File and figure outputs.

**Evidence:**

- [`docker/pipeline-python/worker.py`](../../../docker/pipeline-python/worker.py):44 — transform must return rows; lines 55-65 reject non-list output and serialize only rows/logs.
- [`scripts/pipeline-python-runner.mjs`](../../../scripts/pipeline-python-runner.mjs):104 — fixed Docker memory cap exists, but no declared file output contract/peak-resource result.
- [`src/lib/pipelines/config.ts`](../../../src/lib/pipelines/config.ts):48 — canonical retained outputs currently Dataset create/append/none.

**Remaining:** All three steps: bounded file-return worker/broker contract; per-run temporary artifact storage/keep/proposal cleanup; recorded peak storage/memory and measured limit failures. Reuse the current runner, not a second engine.

### PIPE-05

**not-started · nod `todo`** (was `todo`). Notification channels.

**Evidence:**

- [`src/lib/pipelines/config.ts`](../../../src/lib/pipelines/config.ts):82 — notification targets are subscriptionId/payload only.
- [`src/lib/pipeline-notifications.server.ts`](../../../src/lib/pipeline-notifications.server.ts):32 — existing durable signed webhook deliveries, not typed Teams/email channels; line 88 writes notificationDeliveryIds into result.
- [`src/routes/pipelines/$pipelineId/runs/$runId.tsx`](../../../src/routes/pipelines/$pipelineId/runs/$runId.tsx):103 — run UI renders Dataset outputs/logs, no notification-delivery status.

**Remaining:** All three steps: workspace Teams/email configuration and templates using existing outbox, owner work item on failure, delivery/retry status on run page. Existing signed-webhook support is baseline.

## SET

Specification: [tasks/SET.md](tasks/SET.md).

### SET-01

**partial · nod `in-progress`** (was `todo`). Workspace general settings.

**Evidence:**

- [`src/components/v3/settings/settings-general.tsx`](../../../src/components/v3/settings/settings-general.tsx):56 — persisted general settings/prefix editing; lines 219-232 render editing rules as static statements.
- [`src/lib/notebook-data.ts`](../../../src/lib/notebook-data.ts):539 and src/lib/workspace-admin.ts:648 — separate fixed en-GB formatters still exist; shared workspace-driven formatter replacement required by step 1 is not done.
- [`drizzle/0231_record_identifier_assignment.sql`](../../../drizzle/0231_record_identifier_assignment.sql):27 — prefix overrides used; lines 46-50 persist never-reused counter; drizzle/0234_identifier_assignment_paths.sql:21 extends assignment to model paths.
- [`src/components/v3/settings/settings-general.tsx`](../../../src/components/v3/settings/settings-general.tsx):177 — ID table has Record/Prefix/Example, no next number; example at line 209 is hardcoded prefix-2025-0001.
- [`tests/db/workspace-general.test.ts`](../../../tests/db/workspace-general.test.ts):50 — settings/prefix permissions tests; tests/db/id-sequences.test.ts:53 — ID sequence tests present, not executed.

**Remaining:** 1 Finish applying chosen date/number formats across specified consumers (route currently /settings/, superseding proposed /settings/general needs explicit documentation); 2 expose authoritative next numbers as specified and verify no reuse/audit after prefix change; 3 enforce configured saved-value reasons, signing locks and offline permission on server. Reopen step 1 and step 2 full-scope done claims while retaining their implemented subsets.

### SET-02

**partial · nod `in-progress`** (was `todo`). Members, roles, groups and project access.

**Evidence:**

- [`src/routes/settings/members.tsx`](../../../src/routes/settings/members.tsx):43 — role labels/descriptions reuse canonical roles; real membership/invitation administration at lines 76-123.
- [`src/routes/settings/access.tsx`](../../../src/routes/settings/access.tsx):45 — access UI explicitly grants individual people, not groups; mutation input userId at lines 104-109.
- [`src/lib/workspace-admin.ts`](../../../src/lib/workspace-admin.ts):573 — client-viewer role description exists; no workspace-group/access-request schema found in current src/db/schema.ts.

**Remaining:** 1 Complete documented role mapping and training/certification columns; 2 group memberships/grants and immediate RLS-backed matrix; 3 audited request/approval; 4 finish SettingsMembers/SettingsAccess against these semantics and parity. Existing people-grant pages do not satisfy group access task.

### SET-03

**partial · nod `in-progress`** (was `todo`). Profile, sessions and sign-in security.

**Evidence:**

- [`src/routes/settings/profile.tsx`](../../../src/routes/settings/profile.tsx):20 — explicitly states initials/job title/timezone have no fields; display name and appearance persist.
- [`src/components/v3/settings/settings-sessions.tsx`](../../../src/components/v3/settings/settings-sessions.tsx):55 — listSessions and line 65 revokeSession wired; src/components/v3/settings/settings-sessions.test.tsx:48 exercises other-session sign-out.
- [`src/lib/auth.ts`](../../../src/lib/auth.ts):29 — Better Auth configuration has GitHub social providers and hooks; no task-specific inactivity/3-attempt 15-minute lockout/audit configuration.

**Remaining:** 1 Persist initials/job title/timezone and signature status; 3 implement and test inactivity timeout and failed-sign-in lockout/audit, signed-out/offline explanatory state. Step 2 implementation and component-test evidence support preserving done, without a fresh passing-test claim.

### SET-04

**partial · nod `in-progress`** (was `todo`). Integrations and API.

**Evidence:**

- [`src/routes/settings/integrations.tsx`](../../../src/routes/settings/integrations.tsx):38 — real connector list/register flow; src/routes/settings/integrations/$connectorId.tsx:55 pauses/resumes connector and displays existing ingestion/run history.
- [`src/lib/api-credentials.ts`](../../../src/lib/api-credentials.ts):147 — credential expiry may be null and only rejects past dates; no 90-day maximum.
- [`src/components/v3/settings/settings-api-tokens.tsx`](../../../src/components/v3/settings/settings-api-tokens.tsx):216 — no expiry displayed as Never; no refusal/unused/replacement workflow found.
- [`src/routes/settings/integrations/$connectorId.tsx`](../../../src/routes/settings/integrations/$connectorId.tsx):8 — connector credentials/source/ingestion/run-history components, not webhook delivery history/retry/expiry UI.

**Remaining:** 1 Settings moves mostly landed and former admin/integrations route files removed; document remaining admin disposition/redirect decision. 2 Enforce 90-day max and token last-4/unused/refusal/replacement behavior. 3 Complete requested service-identity connect and delivery retry/pause/expiry-to-Inbox flow; connector pause is not webhook delivery control. Reopen SET-04.3 because checklist label omits its task-step delivery requirement.

## REV

Specification: [tasks/REV.md](tasks/REV.md).

### REV-01

**partial · nod `in-progress`** (was `todo`). Review workspace.

**Evidence:**

- [`src/routes/records/$recordId/notebook.tsx`](../../../src/routes/records/$recordId/notebook.tsx):941 — Open review navigates separate /review/$revisionId, not requested notebook review mode.
- [`src/routes/review/$revisionId.tsx`](../../../src/routes/review/$revisionId.tsx):326 — default comparison chooses immediately prior revision, not necessarily last reviewed round.
- [`src/routes/review/$revisionId.tsx`](../../../src/routes/review/$revisionId.tsx):272 — real review decisions/signatures/check-results exist; existing diff/check/comment UI remains baseline.
- No private-draft comment publication/atomic return implementation found in current migrations/source.

**Remaining:** 1 Notebook review mode/round identity and retired route handling; 2 last-reviewed-round diff/margin/cell reason/navigation; 3 private reviewer drafts and atomic return-with-comments; 4 save draft/returned state and checklist results bound to decision. Existing separate review workspace remains useful partial implementation.

### REV-02

**not-started · nod `todo`** (was `todo`). Signature meanings and author signing.

**Evidence:**

- [`drizzle/0044_sign_001_electronic_signatures.sql`](../../../drizzle/0044_sign_001_electronic_signatures.sql):196 — sign_revision accepts only approve-for-record/witness; line 305 writes session+name-confirmation.
- [`src/components/notebook/sign-notebook-dialog.tsx`](../../../src/components/notebook/sign-notebook-dialog.tsx):50 — default still approve-for-record; options from existing signature meanings.
- [`src/routes/settings/signatures.tsx`](../../../src/routes/settings/signatures.tsx):47 — UI displays Authored/Reviewed/Approved policy labels, which does not widen the executable signature RPC.

**Remaining:** All three steps: canonical role-restricted expanded meaning vocabulary/migration, author signature at submission/witness work item, actual expanded meanings in signed records and evidence packages. Existing signature tables do not establish these new semantics.

### REV-03

**partial · nod `in-progress`** (was `todo`). Signing with password re-entry and signature certification.

**Evidence:**

- [`drizzle/0248_signature_certification.sql`](../../../drizzle/0248_signature_certification.sql):24 — self-certification RPC and status model implemented; tests/db/signature-certification.test.ts:67 covers certify/withdraw/visibility.
- [`src/components/notebook/sign-notebook-dialog.tsx`](../../../src/components/notebook/sign-notebook-dialog.tsx):93 — signing uses submission/meaning/typed-name/digest only; lines 174-181 request typed name, not password.
- [`drizzle/0044_sign_001_electronic_signatures.sql`](../../../drizzle/0044_sign_001_electronic_signatures.sql):305 — actual sign_revision records session+name-confirmation; no short-lived revision-bound token argument.
- [`drizzle/0261_agent_policy_governance_fix.sql`](../../../drizzle/0261_agent_policy_governance_fix.sql):36 — certification gates agent policy creation specifically; this must not be mistaken for a sign_revision gate.

**Remaining:** 1 Authenticated password/provider step-up and single-use user/session/revision token; 2 require token and certification in sign_revision; 3 admin identity verification/password/practice signature beyond current self-certification; 4 password-focused signing dialog and denial/reuse tests. Preserve self-certification as implemented subset, not full REV-03.3 done.

### REV-04

**partial · nod `in-progress`** (was `todo`). Evidence versus live.

**Evidence:**

- [`src/routes/evidence/$revisionId.tsx`](../../../src/routes/evidence/$revisionId.tsx):69 — frozen revision fetched; lines 75-78 fetch live record for metadata, lines 149-154 only derive coarse drift from supersession/lock revision.
- [`src/routes/evidence/$revisionId.tsx`](../../../src/routes/evidence/$revisionId.tsx):153 — renders block_snapshot and stored digest, not cited-Dataset-versus-latest comparison or verified-at result.
- [`tests/db/core-h3-frozen-composed-evidence.test.ts`](../../../tests/db/core-h3-frozen-composed-evidence.test.ts) — canonical frozen composed evidence coverage exists; no nightly verification job found.

**Remaining:** 1 Source-aware snapshot/live comparison including renamed-record differences; 2 full evidence/phone presentation with frozen-only cited values (current route /evidence/$revisionId differs from planned nesting); 3 scheduled digest verification results. Existing snapshot summary/amendment entry is partial.

### REV-05

**partial · nod `in-progress`** (was `todo`). Tamper-evident audit trail.

**Evidence:**

- [`src/routes/settings/audit.tsx`](../../../src/routes/settings/audit.tsx):22 — v3 audit page uses append-only change_events; line 30 caps loaded rows at 200.
- [`src/routes/settings/audit.tsx`](../../../src/routes/settings/audit.tsx):53 — local operation/text filtering; line 69 exports only visible rows.
- [`src/db/schema.ts`](../../../src/db/schema.ts) — current change-event model has no audit-chain previous/content hash; no nightly chain verifier found in migrations/scripts.

**Remaining:** 1 Hash chain and append-only insertion semantics; 2 nightly chain plus signed-digest verification/System entries; 3 full range/actor/project filters, retention and inspection export beyond last-200 UI, verification-result display. Existing append-only log is not a tamper-evident chain.

## PORTAL

Specification: [tasks/PORTAL.md](tasks/PORTAL.md).

### PORTAL-01

**accepted · nod `done`** (was `todo`). Client identity and access decision.

**Evidence:**

- [`docs/knowledge/decisions/0049-client-users.md`](../decisions/0049-client-users.md):3 — accepted ADR dated 2026-09-27.
- [`docs/knowledge/decisions/0049-client-users.md`](../decisions/0049-client-users.md):23 — same-workspace client_viewer identity/sharing/authentication decision.
- [`docs/knowledge/decisions/0049-client-users.md`](../decisions/0049-client-users.md):40 — explicit RLS test plan covers approved/shared, drafts/comments/rows/files, other clients/workspaces and unaffected internal members.

**Remaining:** Task decision exit is met; tracker todo is stale and should be reconciled to accepted/done by parent. Implementation gaps belong to PORTAL-02, not this decision task.

### PORTAL-02

**partial · nod `in-progress`** (was `todo`). Portal.

**Evidence:**

- [`drizzle/0250_client_portal.sql`](../../../drizzle/0250_client_portal.sql):104 — approved-only manual share; :182 portal RPCs scope approved shares to caller client.
- [`tests/db/client-portal.test.ts`](../../../tests/db/client-portal.test.ts):180 — automatic sharing when project enabled; :208 invitation/accept; :253 messages; :300 workspace/client isolation tests present.
- [`drizzle/0253_client_portal_messages.sql`](../../../drizzle/0253_client_portal_messages.sql) — client/team message table and RLS/RPCs implemented.
- [`src/routes/client-portal.tsx`](../../../src/routes/client-portal.tsx):202 — shared record/report table only renders title/kind/shared date, no approved document/PDF/verification-code download.
- [`src/lib/auth.ts`](../../../src/lib/auth.ts):19 — only GitHub social provider configured, not ADR email client sign-in; tests/db/client-portal.test.ts:155 checks records/blocks/projects but does not explicitly exercise complete comments/dataset-row/file-denial matrix.

**Remaining:** 1 Finish ADR-compatible client email authentication and full denial matrix including comments/dataset rows/files; 2 acceptance-test sharing/messages and intended manual/team UI; 3 approved record content/PDF/verification code, milestones and complete portal flow/parity (implemented /client-portal route differs from proposed /portal). Current portal is substantial partial, not not-started; do not mark all exits from presence of RLS tests.
