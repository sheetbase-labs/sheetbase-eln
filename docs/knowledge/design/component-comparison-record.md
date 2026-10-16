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

| #   | Component (generic UI job)                                  | What we use now                                                                                                                                                                                                                                                                                                                                            | What ReUI offers                                                                                                                                               | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                              | Decision                                                                                                                                                                                                                     | Measured    |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard     | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                          | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                     | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                            | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                             | 16 Oct 2026 |
| 2   | Numeric quantity field — enter a number that carries a unit | No shared numeric component: the kit's `Input` with `type="number"`/`inputMode="decimal"`, labelled by `Field`, with a per-screen check (`materials.tsx:783-790` is the pattern the other ~20 numeric call sites repeat)                                                                                                                                   | `@reui/number-field` (base-nova pin), a Base UI `NumberField` wrapper — group, decrement, input, increment, scrub area: `src/components/reui/number-field.tsx` | Ours: the 8 applicable items pass, including density at 390x844 (see the detail table). Theirs: 7 of 8 pass — axe is clean and the states hold, but the field **displays a formatter's value rather than the value**: `1e-21`, `1.602176634e-19` and `Number.EPSILON` all read `0`, and typing `1e-21` yields `1`. 10 items are not applicable — this pair has no sort, filter, select, resize, pagination or reorder control | **Decline.** Our implementation is not materially worse: it keeps the digits the scientist entered, and the candidate at its defaults loses them on screen and on entry. See the detail below                                | 16 Oct 2026 |
| 3   | Signature pad — capture a signature as ink                  | **Nothing draws.** The surface the plan names, `src/components/notebook/e-sign-dialog.tsx` (261 lines), is the credential attestation form: signing-as, meaning, revision, content hash, server-time statement, re-authentication password, type-your-name confirmation. No canvas, no pointer capture, no export exists anywhere in `src` for a signature | `@reui/signature-pad` (base-nova pin), 1,382 lines, `cn` only: pressure- and speed-sized ink, touch and stylus input, undo/redo, PNG/JPEG/SVG/JSON export      | Not applicable: the harness compares two implementations of one job, and only one of these does the job. There is no side to put in the second column                                                                                                                                                                                                                                                                         | **Decline — a different job.** An ink pad answers "what did the mark look like"; electronic signature here is an attestation under an audit chain (REV-03), which ReUI neither carries nor may replace. See the detail below | 16 Oct 2026 |

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

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`):
`notebook-sortable-{ours,theirs}-{light,dark}.png` — one per pair per column per
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

## Row 2 — Numeric quantity field (`quantity-field`)

### What we use now

There is **no shared numeric component**. A quantity, a volume or a parameter
value is the kit's `Input` (`src/components/v3/ui/input.tsx`, 15 lines) carrying
`type="number"` or `inputMode="decimal"`, labelled by `Field` (which renders the
label, the hint and the error), with a check written inline on the screen:

| Surface                                                    | Field                                                                                                       | Numeric behaviour                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `materials.tsx`                                            | replacement and received quantity, `:661-805`                                                               | `Number()`, finite-and-positive test on submit, `Field` error                   |
| `samples.tsx`                                              | sample quantity, `:406-497`                                                                                 | `type="number"`, no client check                                                |
| `withdraw-dialog.tsx`                                      | withdraw and reserve volume, `:359-417`, `:579-642`                                                         | `parseQuantityInput` + `validateQuantity`, `inputMode="decimal"`, mobile keypad |
| `block-editor.tsx`                                         | metric value, material quantities, plate well volume, plate min/max, `:934-964`, `:1650-1808`, `:2878-3062` | `parseFloat \|\| 0`, `parseInt`, no visual validation                           |
| `model-field-input.tsx`, `record-model-version-editor.tsx` | parameter values and their min/max/default, `:175-230`                                                      | `Number()`, browser `required` only                                             |
| `chart-configurator.tsx`, `agent-surface.tsx`              | chart bounds and agent limits                                                                               | `Number()` with clamping, no errors                                             |

The job is one job — type a number — and the repository does it eight times with
four parsers and three error presentations, which is why the plan named it. What
this row measures is the _function_ of that job on a hostile value, because that
is where the two sides differ.

### What ReUI offers

`src/components/reui/number-field.tsx` (258 lines), installed from
`@reui/number-field` at the pinned base-nova registry with the shadcn CLI into a
scratch directory and placed by hand. Edits to the copy: the `cn` import
re-pointed at `#/lib/utils`; the legacy-kit `Label` import dropped (the app's
`Field` labels the field, and `src/components/ui/label.tsx` is the deprecated
kit); classes restyled to the v3 vocabulary (`border-input` → `border-border`,
`bg-accent` → `bg-surface-hover`, `text-muted-foreground` → `text-fg-muted`,
`ring-ring`/`ring-3` → `outline-focus`, `rounded-lg` → `rounded-md`, the size
ladder onto the kit's `h-[30px]`/`text-body` rung); the cursor's
`drop-shadow-[…_#0008]` literal removed, which the colour check bans; and the
input's `outline-none` dropped in favour of `focus-visible:outline-2
outline-offset-1 outline-focus`, so the focused control draws the kit's ring
rather than only the group around it.

It wraps Base UI's `NumberField`: a group holding a decrement button, the input
and an increment button, plus a scrub area whose label the pointer can drag. It
renders **two inputs per field** — a visible `type="text"` one
(`inputmode="numeric"`) and a `tabindex="-1"` `type="number"` carrier that holds
the parsed value.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The 8
applicable items are the ones requiring no control class and the 3 states the
harness owns; the other 10 need reorder, sort, filter, select, resize or
pagination controls that neither side of this pair has, and are recorded as not
applicable rather than skipped.

| Check                                                     | Ours                                                                             | Theirs                                                                        | How it was measured                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — one tab stop per row, the input                                           | Pass — one tab stop per row (the two step buttons are `tabindex="-1"`)        | Browser, both columns; `quantity-field.test.tsx` pins the count                                     |
| Empty (0 rows), loading, error, permission-restricted     | Pass                                                                             | Pass                                                                          | Browser (both columns) and jsdom; the `Field` error and `aria-invalid` were compared as well        |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                               | Pass                                                                          | axe in Chromium with colour contrast on, both columns and both themes                               |
| Density and overflow at 1440x900                          | Pass                                                                             | Pass                                                                          | Browser, both columns                                                                               |
| Density and overflow at 390x844                           | Pass                                                                             | Pass                                                                          | Browser, both columns                                                                               |
| **A quantity the formatter cannot round**                 | Pass — `1e-21`, `1.602176634e-19` and `Number.EPSILON` are displayed as entered  | **Fails** — the same values display as `0`, and `1/3` as `0.333`              | Chromium, both columns, `high-precision` fixture; `quantity-field.test.tsx` pins the rounded result |
| **Entering a small quantity**                             | Pass — typing `2.5e-8` yields `2.5e-8`                                           | **Fails** — typing `1e-21` yields `1`: the `e` is refused and the rest parses | Chromium, both columns, real keystrokes                                                             |
| A value that is not a number                              | Refused at the DOM — the field goes empty, and the screen's own check states why | Refused at the typed boundary — the value is `null` and the field goes empty  | jsdom and Chromium, `mixed-types` fixture                                                           |

Sort, filter, select, resize, pagination and reorder: not applicable to this pair
(10 items).

### Automated evidence

| Evidence                                                                                                       | Result                                                                            | Command                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                                   | 16 cases, **zero violations** (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| axe in Chromium, colour contrast **on**                                                                        | 4 cases (2 columns × 2 themes), **zero violations**                               | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`   |
| The browser checklist, for this pair: Tab order, appearance, the three states, density at 1440x900 and 390x844 | 13 tests, pass — 33 pass in the file, both pairs                                  | same command; the generic checks run for every pair in the spec's `PAIRS` list          |
| The pair's load-bearing measurements, pinned                                                                   | 6 tests, pass                                                                     | `pnpm exec vitest run src/components/component-compare/pairs/quantity-field.test.tsx`   |
| Harness contracts (one scenario object to both columns, frozen fixtures, states)                               | 12 tests, pass                                                                    | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`      |

Appearance evidence: `quantity-field-{ours,theirs}-{light,dark}.png` from the
browser run (`COMPONENT_COMPARE_SHOTS=<dir>`), on the `long-labels` fixture, and
the story `src/stories/NumberField.stories.tsx`.

### Decision and reason

**Decline.** The bar has two halves, and the candidate fails the first: our
implementation is _not_ materially worse — on the one axis this product cares
about it is materially better.

- **The named behaviour is missing on the candidate's side, not ours.** At its
  published defaults the field shows the value through the browser's number
  formatter: `1.602176634e-19`, `1e-21` and `Number.EPSILON` all read **`0`**,
  `1/3` reads `0.333`, `1234567.8901234567` reads `1,234,567.89`. The exact
  value survives in a second, non-tabbable input, so nothing is corrupted — but
  what the scientist reads and types is wrong by up to 21 orders of magnitude.
  A quantities field that displays a real measurement as `0` is worse than a
  field with no stepper.
- **Entry is worse for the same reason.** Typing `1e-21` into the candidate
  produces `1`. Our `type="number"` holds `2.5e-8` verbatim. Scientific notation
  is how these values are written down.
- **The plan's stated gains are thinner than they look.** The steppers are
  `tabindex="-1"`: a pointer affordance, not a keyboard one, and the keyboard
  path is the input's own arrow keys, which `type="number"` already gives.
  "Consistent validation display" is not something the component supplies — the
  `Field` error plus `aria-invalid` already does that, and the inconsistency the
  plan names is the per-screen checks, which survive an adoption of the field
  either way.
- **The cost is real.** An adoption replaces roughly twenty call sites across
  materials, plate maps, parameters and charts, plus one vendored file to
  maintain, to gain a scrub area.

**What would change the answer.** Two conditions, either of which makes this a
re-measurement rather than an inheritance of the row:

- **N1 — set `format` (and `locale`) on every field.** The rounding is the
  item's default presentation, not Base UI's only option; an adoption that
  configures the format and the number of digits, and that can hold `1e-21` in
  the visible input, removes the reason for this decline.
- **N2 — the scrub area becomes a product requirement.** Drag-to-change is the
  one behaviour here that we have no equivalent of. If a design asks for it, the
  trade inverts and the row must be re-measured against a configured candidate.

### Limits of this row

- Desktop Chromium only (the harness browser check); no Firefox, WebKit, real
  device or real stylus was run.
- The exact strings the formatter produces are the engine's and its ICU data, so
  the pinned test asserts the semantic loss (`Number(visible.value) !== the
value`) rather than `"0.333"`.
- The mixed-type and high-precision rows are fixtures, not a screen: this row
  measures one field per fixture row, which is the shape a materials table or a
  plate map has, not the whole screen's form.
- The 5,000-row fixture is measured for rendering and overflow, not by axe.
- This row records one pair. It is not a verdict on `@base-ui/react`, on ReUI as
  a registry, or on any other ReUI item — and it does not authorise, or forbid,
  changing the eight screens' numeric call sites.

## Row 3 — Signature pad (`signature-pad`)

### What we use now

**Nothing draws.** The plan's §4.5 row reads "Signature Pad — Drawing surface in
`e-sign-dialog.tsx` (261)". The file that is 261 lines —
`src/components/notebook/e-sign-dialog.tsx` — contains no drawing surface, and
neither does any other file. This row exists because the premise needed checking
before the registry item did.

What that dialog is: the single electronic-signature dialog over the REV-03
contract. It shows signing-as, the meaning, the revision id, the content digest
and a statement that the time is server time; it collects the signer's
re-authentication password, the meaning when more than one is offered, and a
typed-name confirmation. Its own header records the decisions behind that: the
password field is exactly the re-authentication the server performs and the
dialog never verifies a credential itself; `signedAt` is always the database's
`clock_timestamp()`; and the step-up request and the write stay with each flow
because their `SignatureStepUpInput` payloads differ.

Checked, rather than assumed:

| Search                                                  | Result                                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getContext(`, `toDataURL`, `toBlob`, `Path2D` in `src` | three files, none a signature: `scan/jsqr-code-decoder.ts` (QR decode), `lib/visualisation-export.ts` (chart export), `scientific/data-table.tsx` (TanStack `getContext`)                                  |
| `pointerdown`, `setPointerCapture` in `src`             | one file, `sheet/formula-reference-editor.tsx` — not a signature                                                                                                                                           |
| files named `*sign*`                                    | `e-sign-dialog.tsx`, `sign-notebook-dialog.tsx`, `review/sign-dialogs.tsx`, `review/signatures-table.tsx`, `lib/signatures.ts`, `lib/signature-certification.ts` — attestations, chains and tables, no ink |
| `SignaturePad` as a component, ours or vendored         | not present                                                                                                                                                                                                |

So the plan's row is stale in the way §11.1's corrections table describes for
nine other claims: it sizes a file correctly and describes what is not in it.
Revision 5 re-verified Part B against the tree; this one claim was not among the
nine it corrected.

### What ReUI offers

`@reui/signature-pad` at the pinned base-nova registry: one file, 1,382 lines,
`cn` as its only dependency and a `button` registry dependency.
`SignaturePad`, `SignaturePadArea`, `SignaturePadGuide`, `SignaturePadPlaceholder`,
`SignaturePadControls`, `SignaturePadClear` — a canvas pad with pressure- and
speed-sized ink, touch and stylus input, undo and redo, native form fields, and
PNG, JPEG, SVG or JSON export.

It is read from its own published registry item, not vendored: see the decision
below for why no copy was placed.

### Why there is no harness pair

The harness compares **two implementations of one job** on one fixture, and this
item has one implementation. A pair here would need a second column that does the
same job, and the honest second column is empty — a column that draws nothing is
not a comparison, it is a demonstration. Registering one would put a row in this
record whose columns answer different questions, which is the failure mode the
fixed checklist exists to prevent.

That is a deliberate departure from "a pair per row", recorded here so it is a
decision rather than an omission, and it is the finding: the item is declined
because it is a different job, not because it lost a comparison.

### Decision and reason

**Decline — the item is a different job.** ADR-0055 decision 4's first test is
"it serves a generic UI job"; an ink pad serves a job this product does not have.

- **Electronic signature here is an attestation, not a drawing.** What makes a
  signature meaningful in this product is the meaning selected, the revision id
  and content digest it was taken against, the server-recorded time, the
  re-authentication that proves who acted, and the audit chain and certification
  that follow. None of that is in an ink pad, and the mark itself would sit
  beside the attestation as decoration — a picture a reviewer must trust rather
  than a record the server can verify.
- **Nothing would be replaced.** ADR-0055 decision 4 requires the old component
  to be deleted in the same change. There is no old component; the dialog that
  would host a pad stays exactly as it is either way, so an adoption would add
  1,382 lines to maintain and remove none.
- **The plan already fences the job.** Its own row reads "**UI only** — signing
  authority, step-up and the audit chain stay exactly where they are". With
  those three fenced off, what remains is a drawing surface that nothing in the
  signature path asks for.

**What would change the answer.** Two conditions:

- **S1 — a wet-ink requirement appears.** A regulated flow that must retain the
  appearance of a handwritten mark — a client-facing or witnessed signature, or
  a partner that requires a rasterised signature image in a submission packet —
  makes the pad's export formats the point rather than the ink. Then the job
  exists and the item is measured against what that flow uses instead.
- **S2 — a drawing job appears somewhere else.** If a scientist needs to sketch
  a plate map, annotate a gel or mark a figure, that is a generic drawing job and
  this item is a candidate for it — evaluated on the screen that needs it, not
  retro-fitted to the signature dialog.

### Limits of this row

- The finding is a source read of the current tree, not a run: no pad was
  rendered, because rendering the candidate alone would demonstrate the item, not
  compare it.
- The candidate's own behaviour (ink, pressure, undo, export) is taken from its
  published registry item and its documentation; it was not exercised.
- This row is not a verdict on `@reui/signature-pad` as a component, on
  canvas-based signing in general, or on signature pads in products that do
  collect a mark. It says this repository has no drawing surface and no job for
  one.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
