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

| #   | Component (generic UI job)                                     | What we use now                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | What ReUI offers                                                                                                                                                                                                                                                                                                                                                                                                    | Checklist result                                                                                                                                                                                                                                                                                                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Measured                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Reorderable list — reorder rows by pointer and keyboard        | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                                                                                                                                                           | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                                                                                                                                          | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 16 Oct 2026                                                                                                                                                                                                                                                                                                                                                        |
| 2   | Empty state — explain what is absent and offer one next action | The forward kit's 37-line `EmptyState` (`src/components/v3/ui/empty-state.tsx` at `35423ec2`): `icon`, `title`, `body`, and a `children` slot nothing documents as the action slot. 92 product sites use it; 70 are self-closing, and the plan's §11.2 count puts 73 that cannot satisfy `DESIGN.md:383`. The legacy kit's `ui/empty.tsx` (a compound `Empty`/`EmptyIcon`/`EmptyTitle`/`EmptyDescription`/`EmptyActions` family with **zero** product call sites) is the second predecessor | The catalogue lists Empty, but the ReUI registry serves no such item: `https://reui.io/r/base-nova/empty.json` answers **404** — "empty is part of shadcn/ui, not a ReUI item. Install it with: `npx shadcn@latest add empty`". The candidate is therefore the **stock shadcn `empty` item, by bare name** (`ui.shadcn.com/r/styles/new-york-v4/empty.json`): `Empty`, `EmptyHeader`, `EmptyMedia` (`variant="icon" | "default"`), `EmptyTitle`, `EmptyDescription`, `EmptyContent`                                                                                                                                                                                                                                                      | Ours: the two applicable behavioural items pass — the action is reachable and works from `children`, and the states hold — but the _product_ fails the rule the item exists to satisfy: 70 of 92 sites close the component with nothing in `children`, and the plan's §11.2 count puts 73 of 92 that cannot satisfy `DESIGN.md:383` (see the detail table). Theirs: all applicable items pass, with three measured costs — the title and description are `<div>`s (no heading, no paragraph), the dashed border draws nothing on its own, and the presentation is centred, which the design system's EmptyState rule contradicts. 10 items are not applicable — this pair has no reorder, sort, filter, select, resize or pagination control | **Adopt in part, in this change**: the item's documented action slot and its title/description/media vocabulary are taken; the compound exports, the `div` semantics and the centred borderless-empty presentation are declined. The single component that results is `src/components/v3/ui/empty-state.tsx`, and both predecessors are deleted in the same change | 16 Oct 2026 |

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

## Row 2 — Empty state (`empty-state`)

### What we use now

Two components existed, and this change deletes both.

`src/components/v3/ui/empty-state.tsx` at `35423ec2` was 37 lines: an optional
`icon` (20px, `text-fg-muted`), a required `title` in an `h2.text-section`, an
optional `body` paragraph, and a `children` row. It is the forward kit's
component and 92 product sites render it. Two facts about it decide this row:

- **70 of the 92 sites are self-closing**, and 67 of those have no action at
  all. `children` is the only place an action _can_ go and nothing documents it
  as the action slot, so a screen that writes
  `<EmptyState title … body … />` cannot offer a next step.
  `DESIGN.md` §Application states asks for one: "Empty states explain what is
  absent and offer one relevant next action."
- **22 sites are not self-closing**, and the plan's count puts 19 of the 92 as
  offering an action through `children` — the same slot under an undocumented
  name. The two spellings are what the consolidation removes.

`src/components/ui/empty.tsx` is the legacy kit's compound family — `Empty`,
`EmptyIcon`, `EmptyTitle`, `EmptyDescription`, `EmptyActions` — with **zero**
product call sites: only a story used it. It is deleted with its barrel export.

### What ReUI offers

Nothing, as an item. The catalogue index lists Empty
(`reui.io/components/empty`, "empty state components for zero-data screens"),
but the registry behind the pinned alias does not serve it:

```text
$ curl -sSL https://reui.io/r/base-nova/empty.json
404 {"error":"Registry item not found","message":"empty is part of shadcn/ui,
not a ReUI item. Install it with: npx shadcn@latest add empty"}
```

The item's own page shows the same command, `npx shadcn@latest add empty`. The
candidate is therefore the **stock shadcn `empty` item, installed by bare name**
under the configured `new-york-v4` style, which is what the harness's second
column renders — restyled to the app-3 token vocabulary
(`src/styles.css:683-707`) because an adoption means restyling anyway, and
otherwise unchanged:

| Part               | What it is                                                                                                      | Restyle the app-3 vocabulary forces                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Empty`            | `flex flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12` | `border-dashed` keeps drawing nothing: Tailwind v4 sets border _style_ with no width, so the published item has no visible outline |
| `EmptyHeader`      | `max-w-sm` centred column, `gap-2`                                                                              | —                                                                                                                                  |
| `EmptyMedia`       | `variant="default"` transparent, or `variant="icon"`: `size-10 rounded-lg bg-muted`                             | `bg-muted` → `bg-surface-muted`, `text-foreground` → `text-fg`                                                                     |
| `EmptyTitle`       | a **`div`**, `text-lg font-medium`                                                                              | `text-lg` → `text-section`                                                                                                         |
| `EmptyDescription` | a **`div`**, `text-sm/relaxed text-muted-foreground`                                                            | `text-sm` → `text-body`, `text-muted-foreground` → `text-fg-muted`                                                                 |
| `EmptyContent`     | the action/content slot: full-width column, `gap-4`                                                             | —                                                                                                                                  |

`EmptyContent` is the part the product does not have, and it is the part the
rule needs: an action slot that is part of the component's contract rather than
a `children` slot that happens to hold a button.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Ten of its 18
items need reorder, sort, filter, select, resize or pagination controls and are
recorded as not applicable; the eight that apply are below.

| Check                                                           | Ours                                                                                                                                 | Theirs         | How it was measured                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator       | Pass — the action is the only control and it takes focus with the kit's ring                                                         | Pass — same    | Browser, both columns (`the next action is reachable by keyboard and clears the filter`) |
| Empty (0 rows), loading, error and permission-restricted states | Pass — each column renders its own copy for the state; the 0-row fixture is the nothing-yet case, `restricted` is the no-access case | Pass           | jsdom axe over 6 fixtures × 3 states per column; browser run on `long-labels`            |
| Dark theme                                                      | Pass — token-bound colours only                                                                                                      | Pass           | axe in Chromium with colour contrast on, both columns, both themes                       |
| Density and overflow at 1440x900 and 390x844                    | Pass — the 200-character scientific name wraps; the action stays on screen and ≥20px tall                                            | Pass           | Browser, both columns, asserted per column                                               |
| Reorder by keyboard / pointer                                   | Not applicable                                                                                                                       | Not applicable | —                                                                                        |
| Sort / filter / select, by keyboard or pointer                  | Not applicable                                                                                                                       | Not applicable | —                                                                                        |
| Resize / pagination                                             | Not applicable                                                                                                                       | Not applicable | —                                                                                        |

The two columns render the same scenario and the same copy, derived from the
fixture's own hostile content: the `long-labels` fixture puts the 200-character
scientific name in the title and its unit in the description. The action is real
in both columns — pressing it clears the "filter" and the empty state becomes
the nothing-yet copy — so the keyboard item is answered by doing it.

### Automated evidence

| Evidence                                                                                                                                                                       | Result                                                                                                                                                     | Command                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                                                                                                   | 18 cases for this pair, **zero violations**; the file's 38 tests are these, row 1's 18, and two for C1 (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`            |
| Harness contracts, including this pair's registration                                                                                                                          | 12 tests, pass                                                                                                                                             | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                 |
| axe in Chromium, colour contrast **on**, both columns, both themes                                                                                                             | 4 cases, **zero violations**                                                                                                                               | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep empty` |
| Keyboard: Tab to the action, its focus ring, Enter, and the state it claims to change — plus C1 (ours announces the new copy as a heading; the item's `EmptyTitle` is a `div`) | 1 test, pass, both columns                                                                                                                                 | same file                                                                                          |
| Density at 1440x900 and 390x844, with the 200-character name; the action stays visible and ≥20px                                                                               | 2 tests, pass, both columns                                                                                                                                | same file                                                                                          |
| Screenshots (appearance evidence)                                                                                                                                              | `empty-ours-light.png`, `empty-ours-dark.png`, `empty-theirs-light.png`, `empty-theirs-dark.png`, written and inspected                                    | same file, `COMPONENT_COMPARE_SHOTS=<dir>`                                                         |
| The whole spec, both pairs                                                                                                                                                     | 29 tests, pass (18 for row 1, 11 for this pair)                                                                                                            | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`              |

The `bulk` fixture is not an axe target here for the same reason as row 1 (the
runbook's cost note); for this pair the empty state does not render the rows at
all, so that fixture is only a mount check.

### What an adoption would cost — conditions

- **C1 — decide the semantics deliberately if the item is copied.** Its
  `EmptyTitle` and `EmptyDescription` are `<div>`s. The product's empty states
  are `h2` + `p` today, and a screen's empty state is one of the few headings a
  table-heavy page offers for navigation. Copying the item as published would
  silently remove it; the harness's own 0-row check reads `role=heading`.
- **C2 — restyle to the app-3 vocabulary, not the legacy one.** The item writes
  `bg-muted`, `text-muted-foreground`, `text-sm` and `text-lg`. Those tokens
  still resolve (they are the ELN semantic set, `src/styles.css:336`), so a
  straight copy renders, looks wrong beside its neighbours, and passes the
  colour check — the trap §11.5 of the plan records.
- **C3 — keep the design system's placement.** `Empty` centres its content and
  gives it `min-h-48` and a dashed border. The design system's EmptyState rule
  is "place it where the rows would be, left-aligned with the table, not centred
  in the window" (`docs/knowledge/design/ui-system-v3/design-system/components/EmptyState/README.md`).
  A direct copy contradicts the design set on every list screen.
- **C4 — keep the props the 92 sites use, or migrate them all.** The sites pass
  `icon`, `title` and `body`; the item's compound API has no such props.

### Decision and reason

**Adopt in part, in this change.** The item's one genuinely missing affordance—
a documented action slot — is taken, along with its `title` / `description` /
media vocabulary; the compound exports, the `div` title and description, the
centred dashed-card presentation and the legacy token vocabulary are declined.
The result is the single component `src/components/v3/ui/empty-state.tsx`:
`icon` (or a `media` node), `title`, `description`, `action`, and `children` for
anything after them, with `body` kept as a deprecated alias until the migration
in `docs/knowledge/design/empty-state-migration.md` is finished.

The reason is measured, not preferential. The job the rule names is "say what is
absent and offer one next action", and 70 of the 92 sites render nothing in
`children` and cannot do the second half with the component as it was — the
action slot did not exist (73 by the plan's §11.2 count). The item
supplies that slot. But the item as published is worse on three axes the pair
measures or reads directly: it drops the heading and paragraph semantics the
product's empty states have, it centres and dashes a block the design system
places as a row-aligned notice, and it writes the legacy token vocabulary that
the port exists to leave behind (C1–C3). Adopting it verbatim would therefore
trade one inconsistency (no action) for three.

Both predecessors are deleted in this change, so nothing is left with two
empties: the legacy kit's `ui/empty.tsx` and its barrel export, and the 37-line
implementation this row measures, are gone.

**The change does not run in the reverse direction.** This row is the record of
the comparison; the component it ships is the durable part, and the harness pair
stays registered so the same measurement can be repeated if the item changes.

### Limits of this row

- **The `ours` column renders the implementation this change replaces, not the
  code that ships after it** — the pre-change component is vendored into
  `src/components/component-compare/pairs/empty-state.tsx` because it is deleted
  by the same change. That is the runbook's "our side renders the code that
  ships" rule bent deliberately, and only for this pair: the measured "before"
  is the evidence the decision rests on. The shipped component is
  `#/components/v3/ui/empty-state`.
- The item was read from the live registries on 16 Oct 2026
  (`reui.io/r/base-nova/empty.json` → 404; `ui.shadcn.com/r/styles/new-york-v4/empty.json`
  → the file above). Registry contents change; re-read before re-deciding.
- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run.
- The restyle of the `theirs` column is the runbook's allowance, so the column
  measures the item's structure and semantics, not its published pixels.
- This row records one pair. It is not a verdict on shadcn as a registry, nor
  on the 88 sites that roll their own empty markup (listed in
  `docs/knowledge/design/empty-state-migration.md`).

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
