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

| #   | Component (generic UI job)                                   | What we use now                                                                                                                                                                                                                                                                                                                                                                                  | What ReUI offers                                                                                                                                                                                                                                                                                                                                                                                           | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Decision                                                                                                                                                                            | Measured    |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard      | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                                                                | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                                                                                                                                 | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                                                                                                                                                                                        | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                    | 16 Oct 2026 |
| 2   | Working indicator — show that work is in progress            | Six spellings of `animate-spin` over four glyphs in five files: `live/connection-status.tsx:43,54` (`Loader2`, `RefreshCw`), `notebook/save-status.tsx:43,53` (our `clock`, our `move`), `offline/offline-banner.tsx:76` (`RefreshCw`), `dataset-schema/schema-badge.tsx:46` (`Loader2`), `routes/analysis/new.tsx:1191` (our `clock`)                                                           | **No admissible registry item.** `spinner` is stock shadcn, not ReUI: `/r/base-nova/spinner.json` 404s, and §11.3.1 records that a bare-name install resolves into the legacy Radix kit decision 1 refuses to extend. Candidate is in-house: `src/components/v3/ui/spinner.tsx`                                                                                                                            | Ours: Tab reaches no control in either column — the indicators are decorative and the states are named in text. Theirs: the same, and it adds the reduced-motion decision (`motion-reduce:animate-none`) that nothing in ours owned. Chromium axe with colour contrast **on**: 0 violations, both columns, both themes. jsdom axe: 0 violations, 6 fixtures and 3 states per side                                                                                                                                                                                                                                                         | **Adopt — the in-house component**, and delete the legacy file with it (zero product call sites; `/foundations` does not render it)                                                 | 16 Oct 2026 |
| 3   | Horizontal quantity bar — show one value against its maximum | Four renderings: a correct `progressbar` (`v3/samples/sample-hold-meter.tsx:179-196`), two `role="img"` bars whose only accessible content is a sentence (`v3/home/home-quiet.tsx:281-300`, `v3/samples/sample-usage.tsx:58-76`), and a bare `{n}%` text (`routes/instruments/$instrumentId.tsx:533-535`), plus `routes/settings/usage.tsx:438-454`                                              | **No admissible registry item.** `progress` is stock shadcn (`/r/base-nova/progress.json` 404s) with the same bare-name trap. Candidate is in-house on Base UI: `src/components/v3/ui/progress.tsx`                                                                                                                                                                                                        | Ours: the shipped bars render correctly on every fixture — but only because each caller computed its own percentage by hand (see the detail section). Theirs: **the harness caught a critical `aria-valid-attr-value` in the candidate itself** on the high-precision fixture — `aria-valuenow="1.6e-19"` is not a valid ARIA number — fixed, and both halves pinned; the same rule also fires on an exponential `aria-valuemax`, which is recorded as a limit below. After the fix: 0 violations everywhere, both engines, both themes; the two `role="img"` renderings gain a real `progressbar` contract and the bare text gains a bar | **Adopt — the in-house component**, one per shape (single value and stacked ledger); the caller's arithmetic is no longer the contract                                              | 16 Oct 2026 |
| 4   | Disclosure — reveal detail behind a control                  | Four in-scope `<details>` (`v3/projects/projects-page.tsx:1385`, `v3/integrations/run-history.tsx:201`, `v3/settings/parser-settings.tsx:238`, `settings/signatures.tsx:578,660`) and one expander that manages its own state with **no `aria-expanded` at all** (`v3/integrations/run-history.tsx:150-157`)                                                                                     | **No admissible registry item.** `collapsible` and `accordion` are stock shadcn (`/r/base-nova/collapsible.json`, `/accordion.json` 404). Candidate is in-house on Base UI Collapsible: `src/components/v3/ui/collapsible.tsx`                                                                                                                                                                             | Measured in Chromium: ours has 7 `<summary>` elements, all focusable, **0 carrying `aria-expanded`**, plus 1 expander button that also carries none; theirs has 8 triggers, each with `aria-expanded` and `aria-controls`. Chromium axe: 0 violations both columns, both themes. jsdom axe: 0 violations, 6 fixtures and 3 states per side                                                                                                                                                                                                                                                                                                | **Adopt — the in-house component.** The expander is the one place with a real defect and it gains a stated state; `<details>` converts for consistency, not for a missing behaviour | 16 Oct 2026 |
| 5   | Code and raw-payload block — show text as text               | Five renderings: the pipeline `CodeBlock` (the one deliberate one) and four ad-hoc `<pre>`s — `v3/pipelines/agents/agent-surface.tsx:117-126`, `v3/integrations/run-history.tsx:201-208`, `v3/settings/parser-settings.tsx:242-246`, `review/review-check-results.tsx:124`, `audit/object-history-timeline.tsx:130-151`. None of the four is copyable; three have no label, bound or empty state | `@reui/code-block` exists and was **measured, then declined** — see the detail section. 3,402 lines of copy-and-own source across two files, and `shiki@4`: **13.1 MB installed across 1,062 files** (9.0 MB of it language grammars), for highlighting, streaming, diffs, folding and per-line interaction this job does not have. Its own registry dependencies pull the legacy Radix `button` (§11.3.1) | Ours: **Chromium axe reports `scrollable-region-focusable` (serious)** — three of the four ad-hoc `<pre>`s scroll without a keyboard path; Tab reaches 1 control in the column. Theirs: 0 violations in both engines and both themes, and Tab reaches a `Copy` control plus a focusable payload region on every row                                                                                                                                                                                                                                                                                                                       | **Decline the install; adopt the in-house `CodeBlock`** (promoted from `pipeline-code.tsx`), with one `CopyButton`/`copyText` for the single-value copy sites                       | 16 Oct 2026 |

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
| Full browser checklist (keyboard, pointer, states, density, 4 screenshots)                         | 18 tests, pass                                                                              | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`            |

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

## Row 2 — Working indicator (`spinner`)

### What we use now

Six spellings of `animate-spin`, over four different glyphs, in five files:

| Where                                | Glyph       | Size and tone                       |
| ------------------------------------ | ----------- | ----------------------------------- |
| `live/connection-status.tsx:43`      | `Loader2`   | `size-3`, `text-fg-muted`           |
| `live/connection-status.tsx:54`      | `RefreshCw` | `size-3`, `text-warning-text`       |
| `offline/offline-banner.tsx:76`      | `RefreshCw` | `size-3`, spins only while retrying |
| `dataset-schema/schema-badge.tsx:46` | `Loader2`   | `size-3`                            |
| `notebook/save-status.tsx:43`        | our `clock` | 12px                                |
| `notebook/save-status.tsx:53`        | our `move`  | 12px                                |
| `routes/analysis/new.tsx:1191`       | our `clock` | 16px                                |

Two of the seven spin a _semantically different_ glyph to mean the same thing —
a clock for "saving", a movement glyph for "retrying" — so the same state reads
differently on adjacent surfaces. Nothing owned the reduced-motion decision.
`src/components/ui/spinner.tsx` also exists and has **zero product call sites**;
`/foundations` does not render it (checked by reading the route and every
`spinner` reference in `src/`).

`notebook/save-status.tsx:43,53` is the row's boundary case: the indicator sits
inside a `<span role="status" aria-live="polite">` whose text carries the state,
which is why the component's default is `aria-hidden`, not a second live region.

### What the candidate offers

**No registry item is admissible**, so the candidate is the in-house component.

- `spinner` is a stock shadcn item, not a ReUI one: `reui.io/r/base-nova/spinner.json`
  returns 404 with _"spinner is part of shadcn/ui, not a ReUI item"_. ReUI's own
  spinner page is a set of example components over that stock primitive.
- Installing the stock item by bare name resolves `aliases.ui` to
  `#/components/ui` — the legacy Radix kit ADR-0055 decision 1 says is not
  extended — which is the trap §11.3.1 records for every adoption.
- `src/components/v3/ui/spinner.tsx` (in-house, on our own icon vocabulary): one
  ring glyph, `size` in px, `motion-reduce:animate-none`, `aria-hidden` when a
  visible label sits beside it and `role="status"` + `aria-label` when it stands
  alone.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. This pair
declares no control classes, so 14 of the 18 items are _not applicable_ — the
spinner has nothing to sort, filter, select, resize, reorder or page.

| Check                                                     | Ours                                                                                      | Theirs      | How it was measured                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass (vacuously) — the indicators are decorative `aria-hidden` SVGs; the state is in text | Pass — same | Chromium, both columns                       |
| Empty (0 rows), loading, error, permission-restricted     | Pass                                                                                      | Pass        | jsdom and Chromium, both columns             |
| Dark theme                                                | Pass — token-bound colour only                                                            | Pass        | axe in Chromium **with colour contrast on**  |
| Density and overflow at 1440x900 and 390x844              | Pass — no page overflow, no clipped column                                                | Pass        | Chromium at both widths, asserted per column |

Sort, filter, select, resize, reorder and pagination: not applicable (14 items).

**The comparison's own reading.** Four glyphs against one, one size vocabulary
against three, and a reduced-motion rule that the shipped spellings did not have.
Appearance evidence is in the harness screenshots; it is evidence, not the
verdict.

### Automated evidence

| Evidence                                                                    | Result                                                                | Command                                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures x 2 sides + 3 states x 2 sides                | 18 cases, zero violations (contrast off: jsdom cannot lay colour out) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| axe in Chromium, colour contrast on, both themes                            | 2 cases (2 columns x 2 themes), zero violations                       | manual run on `/component-compare`, axe injected into the page                          |
| Harness contracts and the registered pair set                               | pass                                                                  | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`      |
| Product sites: connection status, save status, offline banner, schema badge | pass                                                                  | `pnpm test` (full suite)                                                                |

### Decision and reason

**Adopt the in-house component, and delete the legacy file with it.** ADR-0055
decision 4's first test — a named behaviour missing — is met twice: nothing in
the shipped spellings honours reduced motion, and the glyph and size vocabulary
differs per site. The second test — the maintenance burden is demonstrably ours —
is met by six spellings of a one-line animation.

The legacy `src/components/ui/spinner.tsx` goes with it: it is unreferenced by
the product and by `/foundations`, and leaving a dead twin beside the new
component is the `ui/empty.tsx` pattern §11.2 already records.

### Limits of this row

- The spinner has no data of its own, so the fixture supplies the text the
  indicator sits beside and the row index cycles the spellings; the hostile
  fixtures therefore measure layout, tone and cost, not value handling.
- Chromium only; no Firefox, WebKit or real device.
- Reduced motion was reasoned from the class, not measured with a
  `prefers-reduced-motion` emulation.

## Row 3 — Horizontal quantity bar (`progress`)

### What we use now

Four renderings of one job, in three bar styles and three fill vocabularies:

- `v3/samples/sample-hold-meter.tsx:179-196` — a correct `role="progressbar"` with
  `aria-valuemin`/`max`/`now`, `h-1.5 rounded-full`, fill by state.
- `v3/home/home-quiet.tsx:281-300` — `role="img"` whose only accessible content is
  the sentence "`{n}` of `{m}` experiments approved", `h-1.5 rounded-full`.
- `v3/samples/sample-usage.tsx:58-76` — `role="img"` with a prose label and a
  two-segment bar of used and reserved volume, `h-2.5 rounded-sm`.
- `routes/instruments/$instrumentId.tsx:533-535` — a bare `{r.progressPercent}%`
  in the Runs table, with no bar at all where the design intent is one.
- `routes/settings/usage.tsx:438-454` — a correct `role="progressbar"` whose tone
  moves ok → warning → danger at 80 and 90 percent.

### What the candidate offers

**No registry item is admissible** (`progress` is stock shadcn;
`/r/base-nova/progress.json` 404s, with the same bare-name trap), so the
candidate is `src/components/v3/ui/progress.tsx`, built on `@base-ui/react`'s
`Progress`, which owns the `progressbar` role, the value attributes, the clamped
percentage and `aria-valuetext`. Two shapes: `value`/`max` for a single measure,
`segments` for a ledger whose parts fill one bar (the sample volume readout). The
tone vocabulary is the caller's — the component only names the fills that exist —
so "expired", "at 90 percent" and "reserved volume" stay with their domains.

### Checklist result

This pair declares no control classes; 14 of the 18 items are not applicable.

| Check                                                     | Ours                                                                                                                         | Theirs                                                                       | How it was measured                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass (vacuously) — a bar is not focusable; the value is text where it matters                                                | Pass — same                                                                  | Chromium, both columns                      |
| Empty (0 rows), loading, error, permission-restricted     | Pass                                                                                                                         | Pass                                                                         | jsdom and Chromium, both columns            |
| Dark theme                                                | Pass — axe clean in dark                                                                                                     | Pass                                                                         | axe in Chromium **with colour contrast on** |
| Density and overflow at 1440x900 and 390x844              | Pass                                                                                                                         | Pass                                                                         | Chromium at both widths                     |
| The high-precision fixture                                | Pass, but **only because each caller computed its own percentage** — rounded to a whole percent before it reached the markup | **Failed `aria-valid-attr-value` (critical)** before the fix; clean after it | axe in Chromium and jsdom, both columns     |

### The finding this row exists for

The harness's high-precision fixture holds figures such as `1.6e-19` and
`2.220446049250313e-16`. ARIA's number grammar has no exponential notation, so a
`progressbar` that forwards one writes an `aria-valuenow` axe rejects. The
**candidate** did exactly that: this comparison found a critical violation in the
new component, not in the old code.

The shipped bars never met such a figure because every caller did its own
arithmetic first — the hold meter from its day count, the approval bar behind
`project.total ? … : 0`, the settings bar behind `Math.min(100, Math.max(0, percent))`
— and rounded to a whole percent. That is the maintenance burden the row is
about: the contract lived in five call sites, and none of them could be reused.

`Progress` now reports what the bar can draw (rounded to three decimals, which is
finer than any bar it renders) and passes the caller's exact reading through
`valueText` untouched. Both halves are pinned in
`src/components/component-compare/component-compare.a11y.test.tsx`, "the progress
candidate normalises a figure ARIA cannot express".

**The same rule fires on the maximum.** Base UI writes `aria-valuemax` verbatim,
so a scale such as `6.02214076e+23` — which this fixture reaches, as a column
total — is rejected by the same rule. Unlike `value`, the maximum cannot be
rounded: it is the scale the caller declared, and scaling it would misstate the
bar. The comparison column therefore configures the candidate the way a real
caller would, on a percentage scale, and the limit is recorded below rather than
worked around with a cast.

### Automated evidence

| Evidence                                                                                  | Result                                                                             | Command                                                                                 |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures x 2 sides + 3 states x 2 sides                              | 18 cases, zero violations after the fix                                            | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| The pinned finding: raw figure fails, `Progress` passes                                   | 2 cases, as asserted                                                               | same file, "the progress candidate normalises a figure ARIA cannot express"             |
| axe in Chromium, colour contrast on, both themes                                          | 4 cases (2 columns x 2 themes), zero violations                                    | manual run on `/component-compare`, axe injected into the page                          |
| Product sites: hold meter, approval bar, volume ledger, instrument Runs, Settings > Usage | pass — including `aria-valuenow` `36`, `90`, `86` and the `aria-valuetext` reading | `pnpm test` (full suite)                                                                |

### Decision and reason

**Adopt the in-house component.** Decision 4's first test is met: two of the four
renderings announced a sentence where a value belongs, and one showed no bar at
all where the design intent is one. The second test is met by the contract: the
percentage arithmetic was in five call sites and the component now owns it.

Two judgements inside the adoption are recorded rather than hidden: the sample
volume ledger keeps a stacked shape (a ledger has no single value to report, so
it keeps `role="img"` and the caller's sentence) and the domain tone vocabulary
stays at the call site.

### Limits of this row

- Chromium only; no Firefox, WebKit or real device.
- The `ours` column reproduces what each shipped site's own arithmetic produced
  (a whole percent of a part over a total). That is the point of the row, not a
  softened comparison: the shipped markup was only ever handed that.
- A `max` at 1e21 or beyond is still written verbatim by Base UI and would fail
  `aria-valid-attr-value`; React types the attribute as a number, so the
  string-notation workaround is not open to the component. No caller has one, the
  comparison column does not invent one, and this is a recorded limit rather than
  a fixed defect.

## Row 4 — Disclosure (`collapsible`)

### What we use now

Five sites in this batch, in two shapes:

- Native `<details>`/`<summary>`: `v3/projects/projects-page.tsx:1385-1404`
  (inside the New project form, wrapping two `Field`s),
  `v3/integrations/run-history.tsx:201-208` (the technical result payload),
  `v3/settings/parser-settings.tsx:238-246` (validation evidence),
  `settings/signatures.tsx:578-604` and `:660-730`.
- An expander that manages its own state: `v3/integrations/run-history.tsx:150-157`
  renders a quiet `Show`/`Hide` button with **no `aria-expanded` at all** and a
  hand-rolled ternary for the detail row.

`<details>` is honest native disclosure — accessible, keyboard-operable, free —
so the gain at those four sites is chrome consistency (one chevron, one spacing,
one place for a control beside the summary) and the ability to put a control
there. The expander is different: it is a control whose only signal of what it
would do is its own label.

### What the candidate offers

**No registry item is admissible.** `collapsible` and `accordion` are stock
shadcn (`/r/base-nova/collapsible.json` and `/accordion.json` 404;
`reui.io/components/collapsible` is typed "shadcn/ui component"), and a bare-name
install writes into the legacy Radix kit. The candidate is
`src/components/v3/ui/collapsible.tsx`, on Base UI's `Collapsible`: `aria-expanded`
and `aria-controls` on the trigger, the panel association, Enter/Space, and an
unmounted panel while closed.

### Checklist result

This pair declares no control classes, so the 6 control-specific items are not
applicable — the checklist has no disclosure item, which is itself a recorded
limit below.

| Check                                                     | Ours                                                                                                         | Theirs                                                           | How it was measured                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — 7 `<summary>` elements, all focusable, plus the expander button; **0 of the 8 carry `aria-expanded`** | Pass — 8 triggers, each with `aria-expanded` and `aria-controls` | Chromium, counted in the live DOM           |
| The disclosure opens from the keyboard                    | Pass — native `details` semantics                                                                            | Pass — Enter/Space on the trigger, asserted in jsdom             | Chromium and jsdom                          |
| Empty (0 rows), loading, error, permission-restricted     | Pass                                                                                                         | Pass                                                             | jsdom and Chromium, both columns            |
| Dark theme                                                | Pass — axe clean in dark                                                                                     | Pass                                                             | axe in Chromium **with colour contrast on** |
| Density and overflow at 1440x900 and 390x844              | Pass — long names truncate, no overflow                                                                      | Pass                                                             | Chromium at both widths                     |

### Automated evidence

| Evidence                                                                                    | Result                                                         | Command                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures x 2 sides + 3 states x 2 sides                                | 18 cases, zero violations                                      | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| axe in Chromium, colour contrast on, both themes                                            | 4 cases, zero violations                                       | manual run on `/component-compare`, axe injected into the page                          |
| `Collapsible` contract (state on the control, panel association, keyboard, unmounted panel) | 3 cases, pass                                                  | `pnpm exec vitest run src/components/v3/ui/collapsible.test.tsx`                        |
| The expander's defect, fixed and pinned                                                     | 2 cases, pass                                                  | `pnpm exec vitest run src/components/v3/integrations/run-history.test.tsx`              |
| The payload disclosure, re-pointed onto the new component                                   | pass — `aria-expanded` false then true, panel rendered on open | `pnpm exec vitest run src/components/audit/object-history-timeline.test.tsx`            |

### Decision and reason

**Adopt the in-house component.** The expander is the case that clears decision 4
— a control with no stated state is a named accessibility defect, not a style
difference — and it is why the run history is restructured so each run is its own
`<tbody>`: the trigger row and its detail row are siblings, and only a row group
can hold both. The four `<details>` sites convert for consistency, which the v3
scan ranks as "consistency, not a missing behaviour", and they gain the chevron,
one spacing rule and a control beside the summary.

**Not converted, and why:**

- `src/components/viz/chart-frame.tsx:112-117` — this is the recorded judgement on
  the "expand chart" control. It is **not a disclosure**: nothing is hidden and
  then revealed; the chart is always rendered and its box grows to fill the
  screen. It is a size change on a figure, and the figure renderers stay in-house
  (ADR-0055 decision 6). Converting it would put a disclosure's semantics on a
  layout change.
- `src/components/review/review-check-results.tsx:84-90` already carries
  `aria-expanded`, so it has no defect; its evidence `<pre>` moved to the kit's
  `CodeBlock` (row 5), and its toggle stays as it is.
- `src/components/review/revision-diff-review.tsx:186-295` (`TableDiffCard`) is a
  disclosure whose toggle carries counts, paging and focus plumbing the v3 scan
  says stays ours; it is a larger change than this batch and is left for the
  change that next touches that screen.
- `src/components/notebook/block-editor.tsx:2986` and the two in
  `src/components/sheet/**` are excluded by owner decision (Part A owns notebook
  blocks and their chrome; ADR-0048 owns the sheet), and the two in
  `src/components/viz/chart-renderer.tsx` are figure renderers.

### Limits of this row

- The fixed checklist has no disclosure item, so "opens from the keyboard" is not
  one of its 18 questions; it is measured by the component's own test and by the
  browser run instead, and the checklist was not extended (a pair may not narrow
  it, and adding to it is the checklist owner's decision).
- Chromium only; no Firefox, WebKit or real device.

## Row 5 — Code and raw-payload block (`payload-block`)

### What we use now

Five renderings of one job:

- `v3/pipelines/pipeline-code.tsx:55-116` — the app's one deliberate payload
  renderer: a language chip, a focusable scroll region (`tabIndex={0}`,
  `role="group"`, aria-label), an empty-statement state, and a documented decision
  that highlighting is deferred.
- `v3/pipelines/agents/agent-surface.tsx:117-126` — the before/after JSON pair of a
  proposed diff, `max-h-40`, `whitespace-pre-wrap break-all`.
- `v3/integrations/run-history.tsx:201-208` — the run's technical result payload,
  inside a `<details>`, `max-h-40`.
- `v3/settings/parser-settings.tsx:242-246` — parser validation evidence,
  `max-h-[240px]`, wrapping.
- `review/review-check-results.tsx:124` — a frozen check's evidence, `max-h-48`.
- `audit/object-history-timeline.tsx:130-151` — `RawPayload`, a native `<details>`
  over a `<pre>`.

Four class strings, four max-heights, and three of them with no label, no empty
state and no way to copy — and the two JSON payloads are exactly what a person
pastes into a bug report or a support thread.

### What the registry offers, and why it was declined

`@reui/code-block` is a **ReUI-native** item (not stock shadcn), so unlike rows
2–4 there was a real registry candidate. It was read from the pinned registry and
measured:

| Measurement           | Value                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy-and-own source   | 3,402 lines across 2 files (`code-block.tsx` 2,235, `code-block-highlight.tsx` 1,167)                                                                          |
| Registry dependencies | `button` (bare name → `#/components/ui`, the legacy Radix kit, §11.3.1), `@reui/code-block-highlight`                                                          |
| npm dependencies      | `shiki` — **13.1 MB installed across 1,062 files**, 9.0 MB of it language grammars (`@shikijs/langs`), measured by installing `shiki@4` in a scratch directory |
| What it adds          | Shiki syntax highlighting, streaming, diff view, code folding, per-line actions, search, download                                                              |

**Decline.** Decision 4 asks for a _named missing behaviour_ in the hand-rolled
version. The behaviours this job needs are a label, a bound and a copy control —
none of which requires a highlighter, and all of which the in-house component
provides. The rest of the item's surface (streaming, diffs, per-line actions) is
for an AI-chat code surface this app does not have, and would be maintained
without a consumer. `pipeline-code.tsx`'s standing decision — "adding a
highlighter for its own sake would be new weight, not new information" — is the
same judgement, and §11.3 asks that it be revisited deliberately rather than
side-stepped, which this row does.

**What would reverse it:** a screen that shows streamed or diffed code with
per-line actions — an agent transcript, an editor, a review diff — where the
item's 3,400 lines replace a component we would otherwise write. At that point
the Shiki weight buys a named behaviour, and this row should be re-measured
rather than inherited.

### What was adopted instead

`src/components/v3/ui/code-block.tsx` — the pipeline `CodeBlock` promoted to the
kit, plus `maxHeight` bounds matching the three heights the hand-rolled blocks
had chosen for themselves, and a copy control. `src/components/v3/ui/copy-button.tsx`
holds the behaviour once: `copyText(value, {copiedMessage, failedMessage})` and the
`CopyButton` control over it, used by the payload block and by the five
single-value copy sites (`v3/ui/secret.tsx`, `v3/projects/projects-page.tsx`, the
experiments record's Share, `settings/diagnostics.tsx`, and the sheet route's
Share).

### Checklist result

This pair declares no control classes; 14 of the 18 items are not applicable.

| Check                                                     | Ours                                                                                                 | Theirs                                                              | How it was measured                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | **Fails** — 1 focusable control in the column; the four ad-hoc `<pre>`s scroll with no keyboard path | Pass — a `Copy` control and a focusable payload region on every row | Chromium, counted in the live DOM           |
| Empty (0 rows), loading, error, permission-restricted     | Pass — the harness owns the states; the pipeline block ships its own empty state                     | Pass — and an empty payload states so and offers no copy            | jsdom and Chromium, both columns            |
| Dark theme                                                | Pass                                                                                                 | Pass — token-bound colour only                                      | axe in Chromium **with colour contrast on** |
| Density and overflow at 1440x900 and 390x844              | Pass — payload scrolls inside its own region; no page overflow                                       | Pass                                                                | Chromium at both widths                     |
| axe, in a real engine                                     | **`scrollable-region-focusable` (serious)**                                                          | Zero violations                                                     | axe in Chromium, both themes                |

The `scrollable-region-focusable` violation is the row's sharpest evidence and it
was invisible until now: jsdom does not lay out, so the repository's existing axe
gates never saw it. Three of the four ad-hoc `<pre>`s scroll (by `max-h`) with no
way for a keyboard user to scroll them; the kit's block is a focusable region by
construction.

### Automated evidence

| Evidence                                                                                                    | Result                                                                         | Command                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures x 2 sides + 3 states x 2 sides                                                | 18 cases, zero violations (jsdom cannot measure `scrollable-region-focusable`) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| axe in Chromium, colour contrast on, both themes                                                            | ours: `scrollable-region-focusable` (serious); theirs: zero                    | manual run on `/component-compare`, axe injected into the page                          |
| `CodeBlock` contract (text never interpreted, language chip, empty state, bounds, copy success and refusal) | 10 cases, pass                                                                 | `pnpm exec vitest run src/components/v3/ui/code-block.test.tsx`                         |
| Copy control at the five single-value sites                                                                 | pass — including "a refused clipboard says so instead of confirming one"       | `pnpm test` (full suite)                                                                |

### Decision and reason

**Decline the registry item; adopt the in-house block.** The evidence is the
dependency and the source count on one side, and on the other a job whose missing
behaviours (a label, a bound, a copy control, a keyboard path into a scrolling
region) the in-house component supplies in one file. Decision 4's bar is not
cleared by the item: nothing the job needs is missing from ours, and 3,400 lines
of copy-and-own source would become ours to maintain.

The copy control is one component, not nine: the two failure messages and the
success message that each site wrote by hand now live in `copyText`, and the
honesty rule (a refused or absent clipboard means no copy happened, and the user
is told that rather than congratulated) is the component's, not each caller's.

**Left alone, and why:** the sheet's inspector and grid clipboard (ADR-0048);
the figure renderers (ADR-0055 decision 6, which include `viz/analysis-panel.tsx`'s
method export and `lib/visualisation-export.ts`'s SVG copy); the notebook block
chrome (`block-editor.tsx`, `block-preview.tsx`, `rich-text-editor.tsx`,
`conflict-banner.tsx`), which is Part A's; and
`notebook/notebook-viewer-actions.tsx`, whose copy is of the reader's _text
selection_ — there is no value to hand over, so it is an action rather than a
value's affordance and stays with the surface that owns the selection.

### Limits of this row

- The registry item was read from the pinned registry and measured as source and
  as an install (dependency weight, file count). It was **not rendered**, because
  a column was not worth building for a candidate declined before it could ship:
  the measurement that decides this row is the dependency and the job, not the
  item's appearance.
- Chromium only; no Firefox, WebKit or real device.
- The 5,000-row fixture is rendered in the column but not swept by axe, for the
  reason in the runbook.
- One payload site (`v3/settings/parser-settings.tsx`) previously wrapped long
  lines and now scrolls horizontally, which is the kit's documented decision for
  every payload; the change is stated here because it is visible.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
