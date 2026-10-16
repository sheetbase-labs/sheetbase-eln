---
title: Component comparison record — ADR-0055
status: living record — one row per compared component
last_reviewed: 2026-10-16
---

# Component comparison record

ADR-0055 decision 5 requires a ReUI comparison to be recorded as **one row per
component**: what we use now, what the registry offers, the result of the fixed
behavioural checklist on both sides, and the decision with its reason. Decision 4
gives the bar an adoption has to clear. This file is that record; it is the
durable artefact, not the component choice.

It exists because the previous ReUI adoption left nothing behind. An event
calendar was adopted (`3b0951fd`, `1b915579`), then deleted with the
legacy-shell routes it was used on (`9ced9f6d`), and no comparison survived — so
the second attempt could not be judged against the first, and neither reason
could be reconstructed. A row here is what stops that happening again.

The evidence comes from the comparison harness at `/component-compare`
(development-only; runbook [`docs/development/component-compare.md`](../../development/component-compare.md),
code `src/components/component-compare/`). The harness holds the fixtures, the
checklist and the two columns; this file holds the results and the decision.
Neither replaces the other: an adoption is not proposed here, and a row without
a decision is not a record.

## Rows

| #   | Component (generic UI job)                                                      | What we use now                                                                                                                                                                                                                                                       | What ReUI offers                                                                                                                                                                       | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Decision                                                                                                                                                                                                                   | Measured    |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard                         | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                     | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                             | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                                                                                                                                                         | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                           | 16 Oct 2026 |
| 2   | Step progress row — an ordered flow's current stage                             | `src/components/v3/ui/stepper.tsx` (67 lines), the forward kit's row and the import flow's only step chrome (`import-flow.tsx:327`, `:831`). After this change it is the only stepper in `src`; the legacy duplicate `src/components/ui/stepper.tsx` was deleted here | `@reui/stepper` (base-nova pin), a wizard-navigation primitive: `src/components/reui/stepper.tsx` (494 lines) — a `<nav>` of `<div>` items holding a `role="tablist"` of tabs          | Ours: all 8 applicable items pass — display-only, `aria-current="step"`, axe clean, fits 390x844 by wrapping. Theirs: **could not be measured as an adoptable column and was not registered as a pair.** It cannot render the shipped contract (no list named "Steps", no listitem, no `aria-current`), and it fails the harness's own axe gate: 3 critical violations as published, 2 of them still there with the consumer's container fixes. It also fails 390x844 (the row overflows and labels truncate). 8 items are not applicable — no reorder, sort, filter, select, resize or pagination control | **Decline — do not adopt.** The item is a different job (wizard navigation, not a progress row) and clearing the bar means rewriting the tags, roles and attributes it declares, which ADR-0055 decision 2 does not permit | 16 Oct 2026 |
| 3   | File pick and drop — pick or drop a file, watch its upload, and retry a failure | Hand-rolled `<input type="file">` in four screens: import flow, parser settings, instrument ingestion panel and the notebook's file block. Progress was one boolean line per screen, one error string, and no retry; drag-and-drop was absent app-wide                | `@reui/use-file-upload` (base-nova pin), a hook plus the vendor's example compositions: `src/components/reui/use-file-upload.ts`, shipped through `src/components/v3/ui/file-drop.tsx` | Ours: all 8 applicable items pass **as containment** (the shared harness states), but the pair's own job has no drop handler, no file row, no per-file progress and no retry. Theirs: all 8 pass, and the drop, the progress and the retry do (see the detail table). 10 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                                                                                                    | **Adopt — done in this change**, with four conditions carried forward (C1–C4 below). The old implementation is deleted in the same change; its frozen copy is the baseline column this row cites                           | 16 Oct 2026 |

## Row 1 — Reorderable list (`notebook-sortable`)

### What we use now

`src/components/notebook/notebook-block-reorder.tsx` (240 lines): native HTML5
drag-and-drop, started at the row's grip handle and resolved on the row under the
pointer by comparing the pointer's Y with that row's midpoint; one insertion line
above or below the gap the drop would land in; keyboard reordering with
alt+arrow from the focused row. The row frame is the notebook's own
`NotebookBlock`.

In the notebook that grip handle is also the click target for the block menu.
This column passes no `menuItems`, so the handle here only drags and the column
has no "Block actions" trigger: the menu is document chrome, not part of the
reorder mechanism being compared.

Two facts about it that the measurements above turned on:

- The grip handle is desktop-only. `notebook-block.tsx` renders it inside
  `hidden w-7 … lg:flex`, so below 1024px the list offers **no pointer or touch
  reordering at all** — not a small handle, none. HTML5 drag-and-drop has no
  touch path either.
- The drag mechanics are ours to maintain: they existed inline in
  `notebook-document.tsx` and were extracted into this module by this change, so
  that the harness measures the code the product ships rather than a copy of it.
  `notebook-document.tsx` is the only other consumer.

### What ReUI offers

`src/components/reui/sortable.tsx` (471 lines, installed from
`@reui/sortable` at the pinned base-nova registry and placed by hand; the only
edit is the `cn` import re-pointed to `#/lib/utils`): `Sortable`,
`SortableItem`, `SortableItemHandle`, `SortableOverlay`. It wraps `@dnd-kit`:
mouse (10px activation), touch (250ms) and keyboard sensors, a drag overlay
rendered through a portal, a movement transform with layout animation instead of
an insertion line, live-region announcements while dragging, and `disabled` per
item.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Applicable
items are the 10 whose control class (`reorder`) or state the pair has; the other
8 need sort, filter, select, resize or pagination controls that neither side of
this pair has, and are recorded as not applicable rather than skipped.

| Check                                                     | Ours                                                                                                | Theirs                                                                                                   | How it was measured                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — grip handle (named "Drag block"), then each focusable row                                    | Pass — the handle button per row; the item container is deliberately not a tab stop                      | Browser, both columns                                                 |
| Reorder by keyboard                                       | Pass — alt+arrow from the focused row; the row's accessible name states the shortcut                | Pass — lift with Enter, move with arrows, drop with Enter; the candidate announces the row it is over    | Browser, both columns                                                 |
| Reorder by pointer                                        | Pass — drag from the handle; insertion line shows the gap                                           | Pass — drag from the handle past the 10px activation; overlay follows the pointer, order changes at drop | Browser, both columns; both produced the same order for the same drop |
| Empty (0 rows), loading, error, permission-restricted     | Pass (see the caveat below)                                                                         | Pass                                                                                                     | Browser (both columns) and jsdom                                      |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                                                  | Pass                                                                                                     | axe in Chromium with colour contrast on, both columns and both themes |
| Density and overflow at 1440x900                          | Pass — no horizontal overflow, no clipped row, handle visible                                       | Pass                                                                                                     | Browser, both columns                                                 |
| Density and overflow at 390x844                           | **Pointer reordering is unavailable** — the handle is not rendered; keyboard reordering still works | Pass — the handle is rendered and usable                                                                 | Browser, both columns, asserted per column rather than averaged       |

Sort, filter, select, resize and pagination: not applicable to this pair (8
items). They are listed in the harness with that verdict and will be answered
when a pair that has those controls is added.

**Caveat on the empty, loading and error states.** These are picture states of a
whole screen, and the harness owns them: both columns show the same harness
notice for a 0-row fixture, for loading, and for a load failure. The notebook
does ship its own empty state — `notebook-document.tsx` renders the
"Start this Notebook" panel with its own controls when a record has no blocks —
but this column renders the reorder mechanism, not the whole document, so it
does not reproduce that panel; ReUI's `Sortable` ships no empty state at all.
Those three items therefore measure the column's containment and keyboard order,
not the shipped empty rendering. `restricted` is different: each column renders
its own disabled affordances, and those were compared.

### Automated evidence

| Evidence                                                                                           | Result                                                                                      | Command                                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                       | 18 cases, **zero violations** (colour contrast disabled: jsdom cannot measure it)           | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`          |
| axe in Chromium, colour contrast **on**                                                            | 4 cases (2 columns × 2 themes), **zero violations**                                         | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep axe` |
| axe, the candidate item unchanged, two handle renderings (C1)                                      | as published: clean; handle as a real `button`: `nested-interactive` (serious) on every row | same file, "the candidate rules or not on how its handle is rendered (C1)"                       |
| Harness contracts (one scenario object to both columns, frozen fixtures, keyboard reorder, states) | 12 tests, pass                                                                              | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`               |
| Full browser checklist (keyboard, pointer, states, density, 4 screenshots)                         | 18 tests for this pair, pass (Row 3 added 7 more to the same file)                          | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`            |

The 5,000-row fixture is rendered and measured for overflow in both columns in
the browser run, but it is not an axe target in either engine: one axe pass over
~25,000 nodes per column takes minutes (measured: 14.6 minutes for the four bulk
cases in Chromium alone) without exercising a rule that the same component's
smaller fixture does not already exercise. That exclusion is a deliberate,
recorded limit, not an omission.

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `ours-light.png`,
`ours-dark.png`, `theirs-light.png`, `theirs-dark.png` — one per column per
theme, on the long-labels fixture. Appearance is evidence; it is not the verdict.

### What an adoption would cost — conditions

- **C1 — resolve where the drag's semantics live, and keep the fix-up.** The
  item puts `@dnd-kit`'s attributes on the row container (`role="button"`,
  `tabindex="0"`) while the drag listeners sit on the handle inside it, and the
  handle it renders by default is a non-focusable `<div>`. So:
  **as published the item is axe-clean** — nothing inside the widget it declares
  can take focus — and for that same reason its keyboard sensor is unreachable.
  Make the handle a real `<button>`, which an integration has to do for the
  keyboard path, and every row becomes a widget containing a control: axe
  reports `nested-interactive` (serious). Both halves are measured against the
  vendored item unchanged by
  `src/components/component-compare/component-compare.a11y.test.tsx`, "the
  candidate rules or not on how its handle is rendered (C1)". This column
  resolves it by handing the container the list's own semantics
  (`<ul>`/`<li>`, `role="listitem"`, `tabindex="-1"`) so the handle is the
  single control, and that resolution is what the per-column axe suite covers.
  An adoption must keep that override or move the attributes onto the handle in
  the copy, and must not drop the keyboard path while doing so.
- **C2 — verify touch on a device.** The harness measures the mouse path in
  desktop Chromium; `@dnd-kit`'s touch sensor (250ms hold, 5px tolerance) was not
  exercised. The touch path is the main reason the candidate clears the bar, so
  it needs a real device before the notebook's implementation is deleted.
- **C3 — accept the dependencies.** `@dnd-kit/core`, `@dnd-kit/sortable` and
  `@dnd-kit/utilities` join the application's dependencies, plus one
  copy-and-own file to maintain. The alternative is the 240 lines we maintain
  today.
- **C4 — decide the drop preview deliberately.** The candidate replaces the
  insertion line with a moving overlay. That is a design change to the notebook,
  not a like-for-like swap; the notebook's design-set row and its parity
  expectation must be updated with it.
- Plus the standing requirements from ADR-0055 decision 4: restyle to Sheetbase
  tokens, pass the colour check and the adoption guard, and replace the old
  implementation in the same change with no parallel implementation left behind.

### Decision and reason

**Adopt, in a follow-up change that satisfies C1–C4. Not adopted here.** ADR-0055
does not authorise an adoption, and this change adds no product surface: it adds
the harness, the fixtures, the checklist and this row.

The reason is a measured missing behaviour, not a preference. Below 1024px our
list cannot be reordered by pointer or touch at all — the handle is not rendered
(`hidden lg:flex`) and HTML5 drag-and-drop has no touch path — while the
candidate keeps a pointer/touch handle at every width, adds drag announcements
our version does not have, and removes 240 lines of drag mechanics we currently
own. That is ADR-0055 decision 4's second test, "a named behaviour is missing, or
the maintenance burden is demonstrably ours", met twice over.

The reason it is conditional is C1: the item's keyboard path is unreachable as
published, and making it reachable is what exposes its container semantics to
axe, so resolving where the drag's semantics live — and keeping that resolution
— is the adoption's work. If a future change decides the notebook
needs keyboard-only reordering below 1024px, the missing-behaviour half of the
reason disappears and this decision should be re-measured rather than inherited.

### Limits of this row

- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run.
- The comparison holds the row chrome constant on the candidate's side (it is
  restyled to Sheetbase tokens because an adoption means restyling anyway), so
  the row's _look_ is not what was compared; the reorder interaction is.
- The 5,000-row fixture is measured for rendering and overflow, not by axe.
- This row records one pair. It is not a verdict on `@dnd-kit`, on ReUI as a
  registry, or on any other ReUI item.

## Row 2 — Step progress row (`import-stepper`)

### The step chrome in `src`, as found (2026-10-16)

The proposal counted eight distinct step-chrome renderers (`plans/notebook-editor-and-reui.html` §11.2). Eight stateful stage renderers is what this change found; exactly **two of them are the same job**, and those two are the ones consolidated here.

| #   | Renderer                | Where                                                                                                                            | What marks the stage                                                                                    | Same job as the row?                             |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `Stepper` (forward kit) | `src/components/v3/ui/stepper.tsx`; import flow `:327`, `:831`                                                                   | `aria-current="step"`, tick on done steps, reserved `failed` marker                                     | **Yes — the survivor**                           |
| 2   | `Stepper` (legacy kit)  | `src/components/ui/stepper.tsx`; a story only                                                                                    | `data-state` (`done`/`now`/`todo`/`bad`); no `aria-current`                                             | **Yes — deleted by this change**                 |
| 3   | `ApprovalStepper`       | `src/components/audit/approval-stepper.tsx`; review workspace, `/foundations`                                                    | per-step review state (pending, active, completed, rejected, returned, unavailable) with actor and time | No — an approval workflow, not a flow's progress |
| 4   | `GuidePanel`            | `src/components/assist/guide-panel.tsx`; analysis-to-figure and submission-readiness guides                                      | per-step Done / Current / Blocked, with blocked reasons and next-action buttons                         | No — a guidance panel                            |
| 5   | Protocol progress list  | `src/components/overview/overview-view.tsx:245-307`                                                                              | per-step `Status` Done / Not started; no current step                                                   | No — procedure progress in an inspector          |
| 6   | Agent workflow steps    | `src/components/v3/pipelines/agents/agent-surface.tsx:480` (a `current_step / steps` cell) and `:561` (the Steps inspector list) | step records with status, and a numeric progress cell                                                   | No — agent-run detail                            |
| 7   | First-run checklist     | `src/routes/index.tsx:630-679`                                                                                                   | numbered circle, tick when done, "N of M done"; no current step                                         | No — an onboarding checklist, order-free         |
| 8   | Review walkthrough      | `src/components/review/revision-diff-review.tsx:166`, `:265`                                                                     | `aria-current="step"` on the change being walked                                                        | No — walking a change list                       |

Two near-misses were checked and are not step chrome at all: the help centre's how-to list (`src/routes/help/index.tsx:203`, `Step {i + 1}` over `list-decimal`, no state) and the pipeline's code-step list (`src/components/v3/pipelines/pipeline-code.tsx`, `PipelineSteps`) — a guide's numbered list and a pipeline's code steps, as §11.4 predicted. The run log list (`runs/$runId.tsx:314`) and the "Step {step_id}" caption on a paused prompt (`run-prompt.tsx:255`) are likewise not.

So the consolidation is two implementations to one, not eight to one. Renderers 3–8 are different jobs, and this change leaves them alone.

### What we use now

`src/components/v3/ui/stepper.tsx` (67 lines): `<ol aria-label="Steps">` with one `<li>` per step, `aria-current="step"` on the current one, a tick on the steps behind it, and `!` on the current step when its `failed` prop is set. Display-only — no focusable element, no interaction. Its only product surface is the import flow (`src/components/import/import-flow.tsx:334`, `:854`), and `tests/browser/import-flow.test.ts:185-193` is its shipped contract. Story: `UI/Stepper` (`src/stories/Stepper.stories.tsx`).

The legacy kit's `src/components/ui/stepper.tsx` was the same row with the same state derivation and no accessibility contract: `data-state` only, no accessible name for the list, no `aria-current`, no `label`, `text-caption`/`text-muted-foreground` where the v3 row is on the app-3 tokens. Its only consumer was a story. Deleted in this change, with the story repointed at the survivor, the legacy barrel export removed, the legacy README mapping row re-pointed at `v3/ui/stepper.tsx`, and its two unit cases replaced by `src/components/v3/ui/stepper.test.tsx` — which pins the shipped contract and the `failed` marker that no browser test asserts positively.

### What ReUI offers

`src/components/reui/stepper.tsx` (494 lines): `@reui/stepper` installed from the pinned base-nova registry with the shadcn CLI in a scratch directory and placed by hand at the path the item's own `files[].target` names, with the two permitted edits — the `cn` import re-pointed to `#/lib/utils`, and the classes restyled to the app-3 vocabulary (`bg-surface`, `text-fg-muted`, `bg-accent-strong`, `text-on-accent`, `bg-border-strong`, `outline-focus`, `text-label`). No dependency was added: `@base-ui/react` is already the kit's base and `cn` is never installed.

It is a wizard-navigation primitive. `Stepper` renders `<div role="tablist">`, `StepperNav` a `<nav>`, `StepperItem` a `<div>`, and `StepperTrigger` a `<button role="tab">` with `aria-selected`, a roving tabindex and `aria-controls="stepper-panel-N"`; `StepperIndicator`, `StepperTitle`, `StepperDescription`, `StepperSeparator`, `StepperPanel` and `StepperContent` complete it. Its states are `active` / `completed` / `inactive` (and a `loading` flag); there is no failed step. Story: `ReUI/Stepper` (`src/components/reui/stepper.stories.tsx`).

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The 8 items that apply to a step row are below; the 8 that need reorder, sort, filter, select, resize or pagination controls are not applicable to this job and are recorded as such, not skipped.

| Check                                                     | Ours                                                                                                                                     | Theirs                                                                                                                                             | How it was measured                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass, vacuously — the row is display-only and holds no focusable element, so Tab passes over it in DOM order                             | One tab stop: the current step's trigger (roving tabindex `0`; the others `-1`), ring on the `outline-focus` token                                 | jsdom structure (S1 pin); not run in a browser for the candidate — see the limits                                  |
| Empty (0 steps), loading, error, permission-restricted    | Pass — the row itself has none of those states (the flow's `STEPS` is a constant); with `restricted` there is nothing to disable         | Pass on containment; `restricted` is the pair's difference — its steps stay interactive unless the consumer disables every item                    | jsdom (S1 pin) and the code read                                                                                   |
| Dark theme                                                | Pass — axe with colour contrast **on** reports zero violations and zero incomplete on the shipped row in the running app, in both themes | **Not run** — the candidate is not a registered pair                                                                                               | Ours: axe injected into the dev server on `/import`, colour contrast enabled, dark and light; theirs: not measured |
| Density at 1440x900                                       | Pass — no overflow                                                                                                                       | Pass — no page overflow at 1200 in the story                                                                                                       | Storybook capture at 1200x260                                                                                      |
| Density at 390x844                                        | Pass — the row fits by wrapping labels                                                                                                   | **Fail** — the row overflows its container and labels truncate; the consumer has to allow the trigger to shrink (`min-w-0`) and truncate the title | Storybook captures of both stories at 390x260, and the measured overflow (`ol.scrollWidth - clientWidth`)          |

The row's remaining checklist lines are answered by measurements the harness cannot host — the contract run and axe — and are under "Automated evidence" below.

### Automated evidence

| Evidence                                                                                                                                       | Result                                                                                                                                             | Command                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| axe, both sides, on the flow's own three steps with the second current (S1)                                                                    | Ours **zero violations**; theirs as published **3 critical violations**: `aria-required-children`, `aria-required-parent`, `aria-valid-attr-value` | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`   |
| axe, the candidate with the consumer's own container fixes (`role="none"` on the item wrappers, the panel targets its `aria-controls` expects) | `aria-valid-attr-value` cleared; the two structural violations remain                                                                              | same file, third S1 case                                                                  |
| The candidate cannot render the shipped contract                                                                                               | No `list` named "Steps", no `listitem`, no `aria-current="step"` (S1, case 1)                                                                      | same file                                                                                 |
| The shipped contract, ours, end to end                                                                                                         | Pass — 3 steps, names, `aria-current` on the current one                                                                                           | `pnpm exec playwright test tests/browser/import-flow.test.ts --project=browser`           |
| The same spec with the candidate composed in the import flow (the adoption attempt)                                                            | **Fails at the first assertion**: `getByRole('list', { name: 'Steps' }).getByRole('listitem')` resolved to 0 elements, expected 3                  | same command, run 16 Oct 2026 and then reverted; the structural half is pinned by S1      |
| The survivor's contract and its `failed` marker                                                                                                | 4 tests pass                                                                                                                                       | `pnpm exec vitest run src/components/v3/ui/stepper.test.tsx`                              |
| axe, the shipped row in the running app, colour contrast **on**                                                                                | Zero violations and zero incomplete on `/import` in **both** themes (dark and light)                                                               | axe injected into the dev server at 1280x800; the dark capture is `import-steps-dark.png` |

### Why this row is not a registered harness pair

`docs/development/component-compare.md` is explicit that a column which cannot pass axe is not adoptable and that a violation fails the harness's own a11y suite with no allow-list. The candidate cannot pass that gate in any composition a consumer could ship for a progress row — two of the three critical violations are structural to the item, and the third needs placeholder elements for a panel id nothing renders. Registering it would either leave `pnpm test` red or require the harness to tolerate violations, which the runbook forbids. Its measurements are therefore pinned in the harness suite itself (S1 in `component-compare.a11y.test.tsx`), where both sides are rendered on the same steps and compared, and the pair is not in `pairs/index.ts`.

### Decision and reason

**Decline. `@reui/stepper` does not replace the step chrome, and the two in-house steppers are consolidated to one instead.** Four reasons, in the order they decide it:

1. **The shipped contract cannot be met.** `tests/browser/import-flow.test.ts:185-193` requires `<ol aria-label="Steps">`, one `<li>` per step and `aria-current="step"` on the current one. The item renders a `<nav>` of `<div>`s holding a `role="tablist"` of tabs, with no `aria-current` anywhere: measured structurally (S1, case 1) and end to end, where the spec fails at its first assertion with 0 listitems against 3 expected. Producing the contract would mean rewriting the element tags, roles and attributes the copied item declares — which ADR-0055 decision 2 does not permit beyond import-path fixes and restyling.
2. **It fails the harness's own axe gate.** Three critical violations as published, two of them still present after the consumer's own container fixes. An adoption would have to strip the semantics the item declares rather than restyle them.
3. **It is a different job, not a better one.** The item is wizard navigation — steps that change the active step, a roving tab stop, panels it expects to control — where the flow needs a display-only progress row, and its state union has no failed step for the marker the flow reserves. The attempt had to invent that marker; the item cannot mark it.
4. **ADR-0055 decision 4's bar is "materially better, not merely different".** The candidate is ~490 lines to own where the repository owns 67, and what it adds over our row (jumping between steps, a loading indicator, a vertical orientation) is behaviour the import flow does not want.

The one place it does measure better — labels truncate where ours wrap, so a narrow row could be made tidier with consumer work — is not a missing behaviour in our row, and it comes with the checkout of everything above.

If a future surface genuinely needs a navigable wizard (steps as controls, panels per step), this item is the right shape for _that_ screen, and this row should be re-measured rather than inherited: the decline is about this job, not about the registry.

### Limits of this row

- The candidate was measured on its own composition (jsdom axe, structure, and one end-to-end contract run in the import flow). It is not a registered pair, so the browser checklist — screenshots per column per theme, keyboard focus, the four states, dark-theme contrast — was not run for it. The items marked "not run" above are ones the decision did not turn on.
- Appearance evidence comes from Storybook at 1200x260 and 390x260 rather than the harness; appearance is evidence, not the verdict.
- The 5,000-step case was not measured. The item registers every trigger through a state-setting effect and scans its node list per trigger, so its cost grows faster than the step count — a code read, not a measurement; the fixtures' bulk case applies to registered pairs and this one is not.
- Desktop Chromium (Storybook and Playwright) only; no Firefox, WebKit or real device.
- The candidate's restyle was verified visually in Storybook in light theme only; our row was captured in the app in dark and light.

## Row 3 — File pick and drop (`import-file-upload`)

### What we use now

Four screens picked a file, each with a bare `<input type="file">` and each
carrying its own copy of the surrounding state:

- `src/components/import/import-flow.tsx` step 1 ("Laboratory file"): the v3
  `Input`, disabled until a target was chosen; upload progress was one boolean —
  `busy` — rendered as one `role="status"` line, "Storing and reading the
  file…", and a failure was a page-level `Banner` ("Import error"). The retry
  was the person picking the file again.
- `src/components/v3/settings/parser-settings.tsx` ("Upload a new test file"):
  progress was `upload.isPending` on the input's `disabled`.
- `src/components/v3/integrations/ingest-panel.tsx` ("Instrument file", inside a
  `Field`): the pick was only a selection — the bytes were retained later, when
  the run started.
- `src/components/notebook/block-editor.tsx` (the file block): a dashed, centred
  box with an icon well and a file input inside it. This is the box that looked
  like a drop target and had no drop handler; progress was a `pending` line and
  the failure a `Notice`.

None of the four could say which file failed, none offered a retry, and none
accepted a dropped file. Drag-and-drop was absent app-wide. ReUI's own note on
the item — "no example sends a picked `File` to a server; picks stay in React
state until you add the upload request" — describes the shape the adoption
keeps: transport, validation and storage policy stay with the screens.

### What ReUI offers

`@reui/use-file-upload` (base-nova pin): one file, `registry:hook`, no
dependencies, and no `cn` import to re-point. It is a hook, not a component:
the pick-and-drop machinery (a hidden input, the four drag handlers,
`isDragging`, `multiple`, `maxFiles`, `maxSize`, `accept`, and its own
validation), plus the vendor's example compositions — a dashed drop zone, a
queue of file rows with a per-file progress bar, a retry and a remove, and a
drag state. `src/components/reui/use-file-upload.ts` is the item;
`src/components/v3/ui/file-drop.tsx` is the shipping integration, which takes
the caller's transport as `onFile`, its validation policy as `validate`, and the
text of its disabled reason as `disabledReason`.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Applicable
items are the 8 whose control class or state this pair has; the other 10 need
sort, filter, select, resize or pagination controls that neither side has, and
are recorded as not applicable rather than skipped.

| Check                                                     | Ours                                                          | Theirs                                                                                                                                     | How it was measured                                         |
| --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the native input is the tab stop, with a UA focus ring | Pass — the "Choose file" button is the tab stop; the hidden input is `sr-only` and `tabIndex={-1}`, as the vendor's own examples render it | Browser, both columns                                       |
| Empty (0 rows), loading, error, permission-restricted     | Pass (see the caveat below)                                   | Pass — and with permission restricted the pick button, the retry and the remove are all disabled, with the reason in text                  | Browser, both columns; jsdom across 6 fixtures              |
| Dark theme                                                | Pass — token-bound colours only                               | Pass                                                                                                                                       | axe in Chromium with colour contrast on, both themes; jsdom |
| Density and overflow at 1440x900                          | Pass — the input is bounded, and the surface shows no queue   | Pass, **after one layout fix-up** (C2)                                                                                                     | Browser, both columns, asserted per row and per control     |
| Density and overflow at 390x844                           | Pass                                                          | Pass — the pick button meets the phone control size                                                                                        | Browser, both columns                                       |

The pair-specific behaviour the fixed checklist does not name — the drop, the
per-file progress and the retry — is measured in the browser run:

| Pair-specific check                           | Ours                                                                  | Theirs                                                                                                  | How it was measured                     |
| --------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| A dropped file reaches the caller's transport | **No drop handler**: a drop adds nothing and the surface shows no row | Pass — the drop adds a row, which then carries its own progress and status                              | Browser, both columns, real drop events |
| Per-file progress while the transport runs    | **One boolean line** for the surface, not per file, and no file row   | Pass — a row per file with its own progress bar and status                                              | Browser and jsdom                       |
| Retry after a failure                         | **None** — the only retry is picking the file again                   | Pass — a rejected transport puts the message on the row with a Retry that runs it again and resolves    | Browser, both columns; jsdom            |
| The caller's validation refuses a pick        | Client-side check, message on the page, no file row                   | Pass — the refusal is the row's own message, and a refusal offers removal rather than a pointless retry | jsdom and the Storybook `Refused` story |

**Caveat on the empty, loading and error states.** These are picture states of a
whole screen and the harness owns them: both columns show the same harness
notice for a 0-row fixture, for loading and for a load failure, so those rows
measure containment and keyboard order rather than either side's own empty
rendering. `restricted` is different — each column renders its own disabled
affordances and those were compared — and the file pair's own empty state (a
pick surface with nothing picked) is what both columns render beside the shared
notice.

### Automated evidence

| Evidence                                                                                                                 | Result                                                                                           | Command                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                                             | 18 cases, **zero violations** (colour contrast off: jsdom)                                       | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                       |
| axe in Chromium with colour contrast **on**, both columns in both themes                                                 | 4 cases, **zero violations**                                                                     | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep 'file pair'`      |
| Harness contracts (every pair × fixture × state, the registration, frozen fixtures)                                      | pass                                                                                             | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                            |
| The field's own contract: drop → transport, failure → retry, refusal → nothing handed on, remove → cleared selection     | 4 tests, pass                                                                                    | `pnpm exec vitest run src/components/v3/ui/file-drop.test.tsx`                                                |
| The pair's browser checks: drop and retry, ours' limits, keyboard, the four states, density at two widths, 5 screenshots | 7 tests, pass                                                                                    | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep 'file pair'`      |
| The four screens' own tests, which address the input by its label                                                        | pass                                                                                             | `pnpm exec vitest run src/components/import/import-flow.test.tsx src/components/notebook/file-block.test.tsx` |
| The import flow end to end, in the browser, against the seeded design Dataset                                            | 3 tests, pass                                                                                    | `pnpm exec playwright test tests/browser/import-flow.test.ts --project=browser`                               |
| Storybook, `UI/FileDrop`: at rest, uploading, uploaded, refused, failed                                                  | renders; the four non-default stories pick or drop a real file through the component's own input | `pnpm storybook`, then `/?path=/story/ui-filedrop--default`                                                   |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `file-upload-ours-light.png`,
`file-upload-ours-dark.png`, `file-upload-theirs-light.png`,
`file-upload-theirs-dark.png`, and `file-upload-dropped.png` for the candidate
after a real drop, all on the long-labels fixture. Appearance is evidence; it is
not the verdict.

### What the adoption cost — conditions

- **C1 — re-point the item's `accept`.** The hook's `accept` option defaults to
  `"*"`, and it writes `accept="*"` onto the input. A wildcard that matches no
  file type is how both a browser dialog and `user-event`'s `upload` read the
  attribute, so every pick is dropped before the hook sees it and the screen
  fails silently. The field passes its own `accept` after the spread, omitting
  the attribute when the caller has none. Any re-composition of the item has to
  repeat that.
- **C2 — `min-w-0` on the file row.** The vendor's example rows sit in a block
  container; the field and the pair's column list them in a grid, where a row's
  automatic minimum size is its content's — so a long file name kept the row at
  the name's full width and pushed the row's own Retry and Remove past the
  column edge. It is fixed with one `min-w-0`, and the appearance screenshots
  are what showed it.
- **C3 — the queue is not adopted, only the pick.** The shipping field holds one
  file at a time, because every transport on these screens takes one
  (`uploadImportFile`, `attachFileToBlock`). Multi-file, `maxFiles` and the
  queue's own summary counts were therefore measured on the candidate and not
  taken; a screen that needs a queue is a new change against the hook.
- **C4 — the progress is indeterminate, and that is the transport's limit.**
  Every one of these transports is a single `fetch` POST with no byte events, so
  the row reports the state it can (uploading, uploaded, refused, failed) with a
  live bar rather than a percentage. A determinate bar would mean rewriting the
  shared import transport on `XMLHttpRequest`, which this adoption deliberately
  did not do.
- Plus the standing requirements from ADR-0055 decision 4: restyle to Sheetbase
  tokens, pass the colour check and the adoption guard, and replace the old
  implementation in the same change with no parallel implementation left behind.
  The frozen pre-adoption column in the harness is not a parallel
  implementation: it is this row's baseline, it ships on a development-only
  route, and the product's copy is gone.

### Decision and reason

**Adopt — done in this change.** Decision 4's second test is met twice over, and
both halves are named behaviours rather than preferences: the repository had no
drop target anywhere in the application, and a failure had no retry anywhere —
the person's only recourse was to pick the file again, and on the notebook's
file block not even the file's name was on screen. The candidate adds the drop
path, a row per file with its own progress and status, and a retry that re-runs
the caller's transport.

The change deletes the four hand-rolled copies in the same commit (decision 4's
fourth clause), and it lies inside the programme's non-goals: the transport, the
validation policy and the storage policy are untouched, and no scientific
surface is involved. The four screens that pick a file now compose one field,
and the field's keyboard route — a real button that opens the dialog the hidden
input would — is the route all four keep.

### Limits of this row

- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run. The drop path is desktop-only in any case: a touch device has
  no drag-and-drop for files, so the pick button is its route.
- The harness's transport is a stand-in with a fixed 600 ms delay and a
  first-attempt failure. It measures the field's own progress, status and retry
  states, not the real transports' latency or error vocabulary.
- The fixture's "files" are built from its rows (the row's name becomes the
  file's name), so the hostile names are the fixture's, not a file system's.
- The candidate column composes the registry item rather than the shipping field
  (`file-drop.tsx`), because the field takes one file at a time and this pair
  measures the queue. The shipping field's own behaviour is what the four
  screens' tests and the Storybook stories cover.
- The pre-adoption column is a frozen copy: it is no longer the code that ships,
  and it exists to make the record readable.
- The 5,000-row fixture is capped at 12 listed files per column, with the count
  stated on screen; the queue's cost at length is not measured.
- This row records one pair. It is not a verdict on ReUI as a registry, on the
  hook's other options, or on any other ReUI item.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
