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

| #   | Component (generic UI job)                                                                        | What we use now                                                                                                                                                                                                                                                                                           | What ReUI offers                                                                                                                                                                                                                                                                                                                                                            | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                              | Measured    |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard                                           | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                         | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                                                                                                  | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                           | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                                                                                      | 16 Oct 2026 |
| 2   | Credential panel — one panel for both Settings credential screens (in-house)                      | Two identical components: `settings-api-tokens.tsx` (314 lines) and `settings-service-credentials.tsx` (313), differing only in the function name, the wire types and the copy; the scan's item 2 measured the structural diff as one line                                                                | **No registry counterpart.** No ReUI or stock shadcn item covers a credential panel (scopes, prefix, reveal-once secret, revoke/rotate); adopting a generic table or dialog for it would replace no duplication and lose the domain contract                                                                                                                                | Not applicable — the harness checklist compares two implementations of one generic UI job, and this consolidation has no candidate column. Evidence instead: the two panels' tests merged and run once per copy preset (12 cases, every headline string asserted literally), and a pixel comparison of the rendered `/settings/api` before and after (`magick compare -metric AE` = **0** at both scroll positions)                                                          | **Consolidate.** One panel + a `CredentialPanelCopy` prop + the route's two presets; both files and both test files deleted                                                                                                                                                                                                                                                           | 16 Oct 2026 |
| 3   | Chip / toggle pill — a removable value, a pressed filter or scope, a phone nav section (in-house) | Five renderers, three class strings: `v3/projects/chip.tsx` (removable, 2 consumers), the record picker's inline `Chip`, the search palette's inline pill (a copy of the picker's string), `routes/settings.tsx` phone nav pills, `routes/client-portal.tsx` pill row                                     | **No registry item.** ReUI's `Toggle Group` and `Button Group` are groups of controls, not a chip — the scan's candidate 8 says not to adopt them for this job, and ADR-0055 decision 4's "serves a generic UI job" bar is not met by a group primitive standing in for one pill                                                                                            | Not applicable — no candidate column. Evidence instead: the `UI/Chip` story (three variants), the five migrated call sites typechecked and rendered, the filter chip and both nav rails inspected in the app, and the phone palette's pill measured in the browser at 390px (34×36 CSS px, 36px after the touch treatment below)                                                                                                                                             | **Consolidate into a new forward-kit `Chip`** (`src/components/v3/ui/chip.tsx`, Base UI `useRender`), with `remove` / `toggle` / `nav` variants; `v3/projects/chip.tsx` and the two inline renderings deleted. `badge.tsx` and `choice.tsx` were checked first and are different jobs (see the detail section)                                                                        | 16 Oct 2026 |
| 4   | Command and listbox — one grouped, keyboard-driven option list (in-house reconciliation)          | Three implementations: the forward kit's `v3/ui/command.tsx` (465 lines, 4 consumers), the search palette's own combobox + listbox inside the screen (664 lines, ~200 of them list and keyboard logic), and the legacy cmdk palette (`components/ui/command.tsx`, 158, plus `searchable-select.tsx`, 142) | The stock shadcn `Command` **is** the cmdk item — i.e. what the legacy kit already was. Swapping the forward kit's contract for it re-imports the dependency this change removes and re-opens §11.3.1 (a plain install re-introduces the deprecated kit); a like-for-like replacement would be its own comparison row and this row's conclusion is that it is not worth one | Not applicable — no candidate column. Evidence instead: the palette's 13 tests unchanged and green through the migration (⌘↵ new tab, `aria-controls` only naming a mounted listbox, relevance-ordered groups, result labels, focus return), plus in-situ Chromium checks at 1440 and 390 (active option and its ↵ hint, `aria-activedescendant` resolving, ⌘↵ opening the record in a tab while the palette stays open, the no-match state dropping the listbox attributes) | **Reconcile into the forward kit's Command** and delete the rest: the palette's own list, keyboard handling and combobox wiring are gone (−200/+144), the legacy palette and its unreferenced `searchable-select` are deleted, `extension-slots`' group composes the v3 parts, and `cmdk` leaves the dependency list. The kit gained the five props the palette needed (detail below) | 16 Oct 2026 |

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

## Row 2 — Credential panel (`settings-credentials`)

### What we use now

Two components that were the same component. `SettingsApiTokens`
(`src/components/v3/settings/settings-api-tokens.tsx`, 314 lines) and
`SettingsServiceCredentials` (`settings-service-credentials.tsx`, 313) rendered
the same section — intro, reveal-once `Notice` + `Secret`, create form with the
scope checkboxes, the eight-column table
(Name/Prefix/Scopes/Created/Last used/Expires/Status/Actions) and the
revoke/rotate `ConfirmDialog` — from the same `SCOPE_GROUPS`. A structural diff
after normalising the function name returned one line, as the scan's item 2
recorded; the real differences were the copy, the two wire types
(`PersonalTokenWire` has no `kind`) and one stray `className="gap-6"` on the
personal panel's `Section`.

Both are mounted on one route, `/settings/api`: the personal panel for every
member, the owner-gated service panel below it
(`src/routes/settings/api.tsx:158,178`).

### What the registry offers

Nothing. This row records an **in-house consolidation with no registry
counterpart**: no ReUI or stock shadcn item covers a credential panel, and
adopting a generic table or dialog would replace no duplication while giving up
the domain contract (scopes, prefix, one-time secret, revoke/rotate). Naming the
supplier, as the catalogue requires: the panel is ours, built from the v3 kit
(`Section`, `Table`, `ConfirmDialog`, `Secret`, `Checkbox`, `Field`).

### What changed

`src/components/v3/settings/settings-credentials.tsx` (445 lines) holds one
`SettingsCredentials` and the two copy presets, `personalTokensCopy` and
`serviceCredentialsCopy`, exported beside it. The panel takes the copy, the rows
(structurally, so both wire shapes satisfy it), the revealed secret and the three
callbacks; the route passes the preset that belongs to each section. The
personal panel keeps its `className="gap-6"` through the component's own
`className`, so the two sections render exactly as before. Both old files and
both old test files are deleted; one test file runs the union of their cases once
per preset.

### Checklist result

The harness's fixed checklist (keyboard, mouse, states, density) compares two
implementations of one generic UI job on identical fixtures. There is no
candidate column here, so the items are not applicable rather than passed, and
the evidence is different in kind:

| Evidence                                                             | Result                                                                                  | How it was measured                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Every headline string of both screens, asserted literally per preset | Pass — 12 cases (revoke, rotate, scope-required create, section heading, copy, refusal) | `pnpm exec vitest run src/components/v3/settings/settings-credentials.test.tsx`          |
| The rendered screen, before and after, same server and session       | Pass — **0 differing pixels** at both scroll positions                                  | `/settings/api` at 1440×2600 DPR 2, `magick compare -metric AE` on the before/after pair |
| Both wire shapes still accepted by the panel                         | Pass — `PersonalTokenWire[]` and `CredentialWire[]` both satisfy the row contract       | `pnpm typecheck`; the route's two call sites are unchanged but for the preset            |
| Empty states                                                         | Pass — "You have no personal tokens." / "No service credentials." render as before      | Rendered in the running app and inspected                                                |

### Decision and reason

**Consolidate.** The scan's own bar — "a named behaviour is missing, or the
maintenance burden is demonstrably ours" — is met on the second clause in the
plainest way available: two files that differ only in their words, and a
divergence that had already started (the `gap-6`). One component with a copy
prop deletes ~180 lines of product code and ~80 of test, and removes the reason
to edit twice.

### Limits of this row

- No axe run and no Playwright suite in this orb (its browsers are not
  installed); the accessibility evidence is the component tests plus the
  rendered screen.
- The pixel comparison holds data constant (the same seeded workspace, the same
  session), so it proves the refactor renders identically on this data, not on
  every data shape; the row types are pinned by `typecheck` instead.
- The 24px section rhythm of the personal panel and the default of the service
  panel are both preserved; that they differ at all is recorded here as a
  pre-existing inconsistency, not repaired by this change.

## Row 3 — Chip / toggle pill (`chip`)

### What we use now

Five renderers of one visual idea, with three class strings between them:

| Renderer                   | Before                                              | Shape                                                                                          |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Removable filter chip      | `src/components/v3/projects/chip.tsx` (2 consumers) | `h-6`, `border-border`, an 18px named `x` button                                               |
| Toggle chip (filter/scope) | inline in `v3/record-picker/record-picker.tsx`      | `h-7` / `max-md:h-9`, `aria-pressed`, optional icon and count, selected = the selection tokens |
| Toggle pill (search scope) | inline in `v3/search/search-palette.tsx`            | the record-picker's string copied, with `max-md:px-2` instead of the phone height              |
| Nav pill (settings, phone) | `routes/settings.tsx`                               | `h-8` / `max-md:h-9`, `aria-current="page"`, no surface background                             |
| Nav pill (client portal)   | `routes/client-portal.tsx`                          | `h-9`, `text-body`, two full class branches instead of a conditional                           |

### The two existing components checked first

The owner's instruction was to check `badge.tsx` and `choice.tsx` before adding a
fourth vocabulary, and neither is the twin:

- `Badge`/`Tag` (`v3/ui/badge.tsx`) is documented as a **diff marker or kind
  label** — "Tags mark changes in a diff (add / chg / del). Kind labels a record
  type. Never use either for status." It has no pressed/current state and no
  interaction, so a chip built on it would be a new component wearing its name.
- `Choice`/`ChoiceCheckbox` (`v3/ui/choice.tsx`) is a **labelled form option** —
  a radio or checkbox with a title and one line of consequence, inside a
  `RadioGroup`. It owns a labelable control; the chip owns a pressed or current
  state and no input.

So the pill is a new forward-kit component, not an extension of either.
A legacy `Chip` also exists (`components/ui/chip.tsx`, removable only) — that is
the legacy kit, which ADR-0055 decision 1 does not extend.

### What ReUI offers

Nothing for this job. ReUI's `Toggle Group` and `Button Group` are groups of
controls; the scan's candidate 8 records that they are "not this job; do not
adopt them for it". A single pill is not served by a group primitive, so
ADR-0055 decision 4's first condition is not met and no adoption is proposed.

### What changed

`src/components/v3/ui/chip.tsx` (115 lines) exports one `Chip` on
`@base-ui/react`'s `useRender` — the same render-prop idiom the kit's `Button`,
`DialogClose` and menu triggers use — with `remove`, `toggle` and `nav`
variants, a `nav` size axis (`sm` for the settings rail, `md` for the portal
rail), and one selected token pair (`border-selection-border` on `bg-selection`)
for the pressed and current states. `v3/projects/chip.tsx` and both inline
renderings are deleted; the two nav rails compose it (the settings rail through
`render={<Link … />}`, so `aria-current="page"` and the router link survive).

**One deliberate visual change.** The palette's phone pill was the only renderer
that stayed 28px on phones (`max-md:px-2`) where the record picker's grew to the
36px touch target (`max-md:h-9`). The consolidation gives the palette the touch
treatment too; it is measured at 34×36 CSS px in the phone palette, and its
label is already screen-reader-only at that width. Everything else is
class-for-class what it replaced.

### Checklist result

No candidate column, so the harness items are not applicable. Evidence:

| Evidence                                                  | Result                                                                                                | How it was measured                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Chip story: removable, toggle (pressed, icon, count), nav | Pass                                                                                                  | `UI/Chip` story, rendered and inspected in the built Storybook  |
| Removable filter chip in place                            | Pass — pill and its named `x` render under the experiments toolbar                                    | `/experiments`, inspected                                       |
| Settings phone rail in place                              | Pass — pills render in the scrolling rail, current section (off-screen right) keeps the selected pair | `/settings/api` at 390px, inspected                             |
| Palette scope pill in place                               | Pass — 36px icon-only pill, aligned with the scope select and Cancel, no overlap or clipping          | `/` with the palette open at 390px; box measured in the DOM     |
| Pressed and current states announce themselves            | Pass — `aria-pressed` on toggle, `aria-current="page"` on nav (the Link keeps it through `render`)    | Palette snapshot in the running app; the settings rail's markup |

### Decision and reason

**Consolidate into one in-house `Chip`.** Three class strings for one visual
idea, one of the five a character-for-character copy of another, and two mobile
treatments for the same control: the maintenance burden is ours, and no registry
item claims the job. The user-facing result is one pill vocabulary, and the next
filter row, scope toggle or phone section rail composes rather than re-spells.

### Limits of this row

- Chromium only, and the phone captures are viewport-based in headless Chromium
  (`(pointer: coarse)` was not matched) — they show the narrow layout, not a
  real phone.
- The settings and portal rails stay owned by the tabs/segmented family
  reconciliation (`reui-opportunity-scan-routes.md` §2-A/§2-F): this row
  consolidates the pill those rails render, not the rail-and-rail-nav
  composition. `routes/settings.tsx` and `routes/client-portal.tsx` are the two
  files where that workstream and this one touch the same lines.
- The selected-state contrast was not measured with axe; it is the same token
  pair the chips already shipped with.

## Row 4 — Command and listbox (`command`)

### What we use now

Three implementations of one job — a grouped, keyboard-driven option list:

- **The forward kit's `Command`** (`src/components/v3/ui/command.tsx`, 465
  lines before this change), composed by four files: `v3/record-picker`,
  `scientific/record-picker`, `sheet/sheet-record-picker` and the notebook's
  add-block menu. It owns the keyboard model (↑ ↓, Home/End, ↵, pointer
  follow), the ARIA wiring (`combobox` → `listbox` → `option`, with
  `aria-activedescendant`), group headings that hide themselves when empty, and
  the dialog/popover shells.
- **The ⌘K search palette** (`src/components/v3/search/search-palette.tsx`, 664
  lines), which hand-rolled the same job inside the screen: its own
  `role="combobox"` input, its own `role="listbox"`/`role="option"` list, its
  own `activeIndex`, its own ↑/↓ and ↵ handling, its own footer chrome.
- **The legacy cmdk palette** (`src/components/ui/command.tsx`, 158 lines, and
  its only app consumer `ui/searchable-select.tsx`, 142 lines, itself
  unreferenced by any route).

### What the registry offers

The stock shadcn `Command` **is** the cmdk item. ADR-0055 decision 2 pins the
registry to the Base UI build, and the scan's §7 already concluded this job is
"reconciliation, not a ReUI swap — unless the reconciliation concludes the kit's
`Command` should be replaced by the stock item, which would be a one-for-one
replacement and a comparison row of its own". The reconciliation does not
conclude that: replacing the forward kit's contract with the stock item would
re-introduce the dependency this change deletes and repeat §11.3.1's finding
that a plain install writes primitives into the legacy kit. Recorded here so the
next reader knows the swap was considered, not missed.

### What changed

The palette now composes the kit: `Command` for query/active/keyboard state,
`CommandInput` for the combobox, `CommandList`, `CommandGroup` (heading plus its
count as the group's `action`), `CommandItem` for each row and each contextual
action, `CommandFooter` for the footer chrome, and `CommandDialog` for the
shell. What stays in the screen is what is a screen's: the search itself, the
debounce and the generation guard, the scope select and archived chip in the
input's row, the error panel with its retry, the scope-miss and did-you-mean
panels, and "See all". Its own list, keyboard handling and combobox wiring are
deleted: −200/+144 lines.

The kit grew the five things the palette needed, each of them a behaviour a
second consumer can now use:

- `loading` on the root (marks the list busy and holds `CommandEmpty` back, for
  callers that own their own progress row);
- `onSelect(value, newTab)` — ⌘/Ctrl+↵ reports the request instead of being
  indistinguishable from ↵;
- `trailing` on `CommandInput`, for controls in the same row as the input;
- `rowClassName` on `CommandInput`, because a screen's header may not be the
  kit's 44px (the palette's is 48px, per the design's `SearchPalette` canvas);
- list-presence-aware `aria-controls`/`aria-expanded`: `CommandList` registers
  itself, so the input stops naming a listbox that is not in the document —
  which is the QA3-palette-2 behaviour the palette used to implement by hand.

The loser is deleted rather than excepted. The task asked for that check
explicitly: the legacy command is not rendered by `/foundations` or any other
legacy-only surface — the adoption guard's allow-list recorded its only app
importer as `searchable-select`, and that file had no route consumer — so
`ui/command.tsx`, `ui/searchable-select.tsx`, their barrel exports, their
allow-list entries and the legacy `Command` story are all removed, and
`extension-slots`' `ExtensionCommandGroup` composes `v3/ui/command` instead.
`cmdk` is no longer a dependency (`package.json` and `pnpm-lock.yaml`).
`src/stories/Command.stories.tsx` is now the v3 story (default, empty, loading,
picker, dialog).

### Checklist result

No candidate column, so the harness items are not applicable. Evidence:

| Evidence                                                           | Result                                                                                                                                                             | How it was measured                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| The palette's own test suite, unchanged through the migration      | Pass — 13 tests: ⌘↵ new tab, `aria-controls` only with a mounted listbox, relevance-ordered groups, sheet labels, focus restore, archived scope, failure and retry | `pnpm exec vitest run src/components/v3/search/search-palette.test.tsx`      |
| Keyboard: the active option moves and is announced                 | Pass — ArrowDown moved the active option to the second result; `aria-activedescendant` resolved; the ↵ hint renders on the active row only, as the design draws it | `/` with the palette open at 1440px, DOM assertions and an inspected capture |
| ⌘/Ctrl+↵ opens the record in a new tab and leaves the palette open | Pass — the new tab landed on `/records/<id>/notebook`; the palette's tab kept its query and its open dialog                                                        | Same session, `tab list` and per-tab DOM checks                              |
| The listbox's absence is honest                                    | Pass — the no-match state renders "No matches for …" and the input drops `aria-controls` and `aria-activedescendant`                                               | Same session, DOM assertions and an inspected capture                        |
| The other four consumers still compose the same kit                | Pass — `record-picker`, `scientific/record-picker`, `sheet-record-picker` and `add-block-menu` unchanged, their tests green                                        | `pnpm test` (481 files, 4830 tests)                                          |

A short recording of the palette (open, type, pointer across rows, toggle the
archived scope) was taken while making this change; the captures kept beside
this record are the 1440px results and no-match states and the 390px phone
header.

### Decision and reason

**Reconcile into the forward kit and delete the rest.** Two implementations of
one job in one tree — one of them inside a screen, and a third of them in the
kit the app migrated away from: the maintenance burden is demonstrably ours, and
the palette's fixes could never reach the kit's other four consumers (or the
reverse). The user-facing result is one behaviour, including the ⌘↵ contract the
screen had and the kit now carries.

### Limits of this row

- No axe run over the palette in this orb and no Playwright suite (its browsers
  are not installed); the accessibility evidence is the unit tests, the DOM
  assertions in Chromium and the rendered captures.
- The palette's screen states (error, scope-miss, did-you-mean, archived
  toggle) are covered by its tests and were not each captured.
- The kit's `trailing`/`rowClassName` additions are used by one consumer today
  (the palette); they are recorded as kit surface, and the second consumer may
  yet show that one of them should have stayed screen-local.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
