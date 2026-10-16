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

| #   | Component (generic UI job)                               | What we use now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | What ReUI offers                                                                                                                                                                                                                                                         | Checklist result                                                                                                                                                                                                                                                                                                                                                                                         | Decision                                                                                                                                                                                                                                                            | Measured    |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard  | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                                                                                                                                                                                           | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                               | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                       | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                    | 16 Oct 2026 |
| 2   | Avatar and initials — one person, one reading            | Six render sites in four files, three initials algorithms, two hand-rolled stacks and one unused prop: `record/record-header.tsx` (a local component _named_ `Avatar`, exported as `RecordHeaderAvatar`), `record/inspector-sections.tsx` (`ActivityFeed`, `CommentList`, `ContributorAvatars`), `comments/comment-thread.tsx` (`authorInitials`), `collaboration/presence-avatars.tsx` (`initialsFor`; the only site composing the v3 Avatar); `audit/audit-trail.tsx` carried an `initials?` prop that was never rendered | **No item.** `reui.io/r/base-nova/avatar.json` 404s, and the catalogue lists `avatar` as a stock shadcn component installed by bare name: a Radix `Avatar`/`AvatarImage`/`AvatarFallback` with a fixed `size-8` box, no derivation, no size scale, no tones and no group | Ours: 8 of 8 applicable items pass (10 are not applicable — no reorder, sort, filter, select, resize or pagination control). Theirs: **not run as a like-for-like candidate** — an install would not have replaced the hand-rolled spellings, because the candidate has no derivation to converge on; see the detail table for what was measured instead                                                 | **Decline the install; componentise onto the v3 `Avatar`.** Six sites migrated onto one `initialsFromName` rule and one `AvatarStack`; the local `Avatar`, its export and the dead prop are deleted                                                                 | 16 Oct 2026 |
| 3   | Notice and banner chrome — inline message and page strip | Six hand-rolled alert/banner chromes in five files: `comments/comment-panel.tsx` (load failure and action failure), `audit/record-history-timeline.tsx` (error + retry), `audit/object-history-timeline.tsx` (error), `offline/offline-banner.tsx` (a page strip), `notebook/conflict-banner.tsx` (the block conflict) — all on the app-3 bridge vocabulary (`border-destructive`, `border-danger/40`, `bg-destructive/10`) while sixteen files already compose the v3 pair                                                 | `@reui/alert` (base-nova pin, ReUI-native, one file, `cva` + `cn`): a grid box with `has-[>svg]` icon column, `AlertTitle`, `AlertDescription`, `AlertAction`, and variants `default / destructive / info / success / warning / invert`                                  | Ours: 8 of 8 applicable items pass (10 not applicable). Theirs: the same 7 universal items pass **after two behavioural changes** — the page-strip anatomy has to be built outside the item, and its `role="alert"` on every variant is a behaviour our tone-derived `role` exists to avoid. Neither change is available from the item's own API                                                         | **Decline.** The v3 pair already owns the job and sixteen files compose it; a second alert vocabulary is the second design language ADR-0055 decision 1 exists to prevent. The six hand-rolls move onto the v3 pair instead                                         | 16 Oct 2026 |
| 4   | File type — resolve a name or MIME type to an icon       | Three icon resolvers and a duplicate size formatter: `record/inspector-sections.tsx` (`fileTypeIcon`, MIME-first, four Lucide-family glyphs), `notebook/block-preview.tsx` (`fileIconForType`/`FileIcon`/`FileMetaLine`), `notebook/block-editor.tsx` (`fileGlyphFor`); `formatBytes` existed twice (`src/lib/file-attach.ts` as an alias, and again locally in `src/routes/records/$recordId/notebook.tsx`)                                                                                                                | `@reui/file-type` (base-nova pin, ReUI-native, one file, `class-variance-authority` + `cn`): 171 extensions across 13 families, `getFileType` / `getFileTypeCategory`, variants `outline / solid / light / mono`, sizes down to an 18px row                              | Ours (before): 7 of 8 applicable items pass — the icon carries no type in words, so the type's accessible name is absent (`aria-hidden`), and a generic stored MIME type resolves an `.xlsx` name to the neutral glyph. Theirs (after): 8 of 8 pass — every icon is `role="img"` with a named type, name-first resolution replaces the MIME-first fall-through, and long names still truncate in the row | **Adopt, scoped.** `src/components/reui/file-type.tsx`, restyled to app tokens, replaces the inspector's resolver; the two block-resident resolvers stay (Part A owns notebook blocks) and are recorded as an explicit exclusion. `formatBytes` is one helper again | 16 Oct 2026 |

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

## Row 2 — Avatar and initials (`avatar-initials`)

### What we use now — before this change

Six render sites in four files, and one prop that was never rendered:

- `src/components/record/record-header.tsx` — a local component **named**
  `Avatar` (shadowing the v3 one), exported as `RecordHeaderAvatar`, spelling
  initials `(initials ?? name.slice(0, 2)).toUpperCase()`; used for the owner and
  for the contributors, whose stack and `+5` chip were hand-rolled beside it.
- `src/components/record/inspector-sections.tsx` — `ActivityFeed`
  (`name.slice(0, 2)`), `CommentList` (`name.slice(0, 2)`) and
  `ContributorAvatars` (a third stack, with its own border-instead-of-ring
  overlap and its own `+N`).
- `src/components/comments/comment-thread.tsx` — `authorInitials(label)`, which
  sliced the **display label**, not the name, and special-cased `Deleted user`
  to `??`.
- `src/components/collaboration/presence-avatars.tsx` — `initialsFor(name)` (the
  first letter of up to two words), the only site composing the v3 `Avatar`, with
  its own `+N` chip and a styled tooltip per avatar.
- `src/components/audit/audit-trail.tsx` — `AuditActor.initials?`, never rendered
  and never passed by any caller.

The visible consequence: one person read as `GP` in the presence stack, `GA` in
the record header and inspector, and `RE` (for `Reviewer`) in a comment thread —
three answers to one question, from three spellings of one rule.

### What ReUI offers

**Nothing.** `https://reui.io/r/base-nova/avatar.json` returns 404, and the
catalogue lists `avatar` as a stock shadcn component installed by bare name.
What such an install brings is the Radix `Avatar` / `AvatarImage` /
`AvatarFallback` family this repository already vendors in the legacy kit: a
fixed `size-8` box, `bg-muted text-xs font-medium` on the fallback, no
derivation from a name, no size scale, no tone vocabulary and no group or
overflow composition. The candidate column in the harness reproduces exactly
that, since there is no registry item to vendor.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Ten items need
a reorder, sort, filter, select, resize or pagination control that neither side
of this pair has, and are recorded as not applicable. The eight universal items:

| Check                                                      | Ours (after)                                                                                        | Theirs (stock shadcn)                                                                           | How it was measured                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator  | Pass — the pair has no control; the columns' own chrome is reached in DOM order                     | Pass — same                                                                                     | Browser, both columns                                                 |
| Empty (0 rows), loading, error, permission-restricted      | Pass — the harness owns the 0-row, loading and error states; the restricted state is the pair's own | Pass                                                                                            | Browser (both columns) and jsdom                                      |
| Dark theme                                                 | Pass — token-bound tones only (`bg-selection`, `bg-review-wash`, sleeps on `ring-surface`)          | Pass in jsdom; **no dark-theme vocabulary at all**, so an adoption would have had to invent one | axe in Chromium with colour contrast on, both columns and both themes |
| Density and overflow at 1440x900                           | Pass — no horizontal overflow, no clipped row                                                       | Pass                                                                                            | Browser, both columns                                                 |
| Density and overflow at 390x844                            | Pass — no horizontal overflow, no clipped row                                                       | Pass                                                                                            | Browser, both columns                                                 |
| Keyboard/mouse reorder, sort, filter, select, resize, page | Not applicable — no such control on either side                                                     | Not applicable                                                                                  | —                                                                     |

The behaviour that mattered is not on the checklist and is measured directly:
`initialsFromName` gives one answer per name wherever it is called, and the
harness renders the same people through a bare avatar, a stack and a
comment-style chip.

### Automated evidence

| Evidence                                                                                                                                     | Result                                                                                                  | Command                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The one initials rule: two words, one word, longer names, stray whitespace, empty; and that a bare avatar and a stack render the same string | 6 tests, pass                                                                                           | `pnpm exec vitest run src/components/v3/ui/avatar.test.tsx`                                                         |
| axe, both columns: every fixture except the 5,000-row one, plus the three states                                                             | 14 cases, **zero violations** (colour contrast disabled in jsdom)                                       | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                             |
| axe in Chromium, colour contrast **on**, both columns, both themes, plus a column screenshot per theme                                       | 6 cases (both columns x both themes), **zero violations**; 12 screenshots for the three converted pairs | `COMPONENT_COMPARE_SHOTS=<dir> pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser` |
| The 0-row fixture, phone-width containment and the Tab order, per pair                                                                       | pass — the `converted domain jobs` block, 9 tests                                                       | same command                                                                                                        |
| The six sites, end to end: record header, inspector rows, comment thread, presence stack                                                     | 76 tests in the four components' own suites, pass                                                       | `pnpm exec vitest run src/components/record src/components/comments src/components/collaboration`                   |

### Decision and reason

**Decline any install; componentise onto the v3 `Avatar`.** The registry has no
item for this job, so the alternative to the v3 component is a second avatar
family on the legacy Radix base — a second design language for a job where the
forward kit already has the component, and one that would leave the three
spellings exactly where they are, because a component with no derivation leaves
the rule to its callers.

The reason is the acceptance criterion the change was made against: the same
person must render identically everywhere. That is now checked in three places —
the helper's unit test, the component's own story (`UI/v3 Avatar`, sizes, initials
and stacks) and this pair's two columns — and the six sites it replaced are
deleted in the same change (`RecordHeaderAvatar` and the dead `initials?` prop
included).

### Limits of this row

- There is no registry item to run the checklist against. The candidate column is
  a restyled reproduction of the stock shadcn family, not a vendored copy, and
  the comparison is therefore weaker than row 1's.
- Equally, "theirs" is not an adopter's best possible use of the candidate: a
  team that installed it could still write one shared helper. The finding is not
  that the candidate cannot do the job — it is that installing it would not do
  the job this change needed, while adding a parallel avatar.
- Rows 1 and 2 draw the same 6-fixture set with scientific sample names standing
  in for people; the harness's one fixture set is the reason, and the pair's
  header states the mapping.
- 20px and 24px avatars on two inspector surfaces converge on the kit's 22px
  (`sm`). That is a visible size change, and it is deliberate: one scale is the
  point of the change.

## Row 3 — Notice and banner chrome (`notice-banner`)

### What we use now — before this change

Six hand-rolled chromes in five files, all writing the app-3 bridge vocabulary
(`border-destructive/40 bg-destructive/10 text-danger-text`,
`border-danger/40 bg-danger-wash`, `border-warning-border bg-warning-wash`):

- `src/components/comments/comment-panel.tsx` — the load failure and the action
  failure, each a `<p role="alert">` box.
- `src/components/audit/record-history-timeline.tsx` — an error box with its own
  retry button beneath the message.
- `src/components/audit/object-history-timeline.tsx` — an error box.
- `src/components/offline/offline-banner.tsx` — a page strip (`border-b … px-4
py-2 md:px-6`) that re-implements `Banner`'s anatomy, including its padding
  scale, with a `WifiOff` glyph from Lucide.
- `src/components/notebook/conflict-banner.tsx` — the block-conflict choice: a
  message, a server preview and two actions.

Sixteen files outside the kit already composed `Notice`/`Banner`
(`import-flow.tsx` alone composes it nine times), so this was drift, not a
separate design.

### What ReUI offers

`@reui/alert` (base-nova pin, ReUI-native, one file): a
`grid-cols-[0_1fr]` box with a `has-[>svg]` icon column, `AlertTitle`,
`AlertDescription` and an `AlertAction` cell, and six variants
(`default / destructive / info / success / warning / invert`) on classes such as
`bg-card text-card-foreground` and `border-destructive/30 bg-destructive/4`. It
puts `role="alert"` on every instance, unconditionally.

### Checklist result

Ten items are not applicable (no reorder, sort, filter, select, resize or
pagination control). Of the eight universal items:

| Check                                                     | Ours                                                                                     | Theirs — `@reui/alert`                                                                                                                                                 | How it was measured                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the retry inside a `Notice` is the only control, reached with a visible indicator | Pass — same retry, in `AlertAction`                                                                                                                                    | Browser, both columns                                                 |
| Empty, loading, error, permission-restricted              | Pass                                                                                     | Pass, with the caveat below                                                                                                                                            | Browser (both columns) and jsdom                                      |
| Dark theme                                                | Pass — the pair's washes and borders are the app-3 tokens, measured in both themes       | Pass after restyling; the item's own classes are the ELN vocabulary (`bg-card`, `text-muted-foreground`), which renders and looks _nearly_ right beside a v3 neighbour | axe in Chromium with colour contrast on, both columns and both themes |
| Density at 1440x900 and 390x844                           | Pass — no overflow, no clipped control                                                   | Pass                                                                                                                                                                   | Browser, both columns                                                 |

Two behaviour differences are not checklist items and both were resolved against
the item:

- **`role` is fixed, not derived.** The item announces an informational strip as
  an alert on every render. Our `Notice`/`Banner` derive it from the tone
  (`alert` for `bad`, `status` otherwise), which is what the offline strip and
  the conflict choice need. Adopting the item would mean keeping the role logic
  outside it, or accepting the announcement change.
- **There is no page-strip anatomy.** The offline banner is a full-bleed strip
  under the header (`border-b`, its own padding); every variant of the item is a
  card-shaped box. The column shows that the strip has to be built outside the
  item — a wrapper, not a variant — which is exactly the hand-rolling this row
  exists to remove.

### Automated evidence

| Evidence                                                                                                                  | Result                                                                     | Command                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| axe, both columns: every fixture except the 5,000-row one, plus the three states                                          | 14 cases, **zero violations**                                              | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                             |
| axe in Chromium, colour contrast on, both columns, both themes, plus screenshots                                          | 6 cases, **zero violations;** 12 screenshots for the three converted pairs | `COMPONENT_COMPARE_SHOTS=<dir> pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser` |
| The 0-row fixture, phone-width containment and the Tab order, per pair                                                    | pass — the `converted domain jobs` block, 9 tests                          | same command                                                                                                        |
| The six migrated sites and the other suites that render them (offline mode, comments, audit timelines, notebook conflict) | pass                                                                       | `pnpm exec vitest run src/components/comments src/components/audit src/components/offline src/components/record`    |

The conflict strip keeps its `data-conflict-banner`, `data-conflict-use-server`
and `data-conflict-keep-local` hooks, so
`tests/browser/note-01-authoring.test.ts` still finds the choice it drives.

### Decision and reason

**Decline the item.** The v3 pair already owns this job and sixteen files
compose it; adopting `@reui/alert` would put two vocabularies for the same job
side by side, which is the second design language ADR-0055 decision 1 exists to
prevent — and it would buy nothing the pair lacks, since the two differences that
remain (a derived `role`, a page strip) are exactly what the pair has and the
item does not.

The six hand-rolls move onto the pair in the same change: `Notice tone="bad"` for
the three error boxes, `Banner tone="warn"` for the offline strip (its
tone-derived `role="status"` is the same announcement the strip had) and
`Notice tone="bad"` with an action slot for the block conflict. One visual
change is deliberate and recorded: the strip loses its `WifiOff` glyph for the
kit's `warn` icon, because `Banner` takes an `IconName` from the v3 set and the
set has no offline glyph.

### Limits of this row

- The candidate column is a restyled reproduction of the published item, not a
  vendored copy: the decision is a decline, so `src/components/reui/` gains
  nothing for it (see the runbook's conventions for converted pairs).
- The field-level error text in `scientific/model-field-input.tsx` and
  `favourites/favourite-toggle.tsx` is **not** part of this row. It is the same
  job seen from a field's side and is recorded as its own item in the domain
  scan (§JH-8); it was left alone rather than half-converted.
- The offline strip's own tests assert text and hooks, not colour; its contrast
  evidence is the browser axe pass, not a unit assertion.

## Row 4 — File type (`file-type`)

### What we use now — before this change

Three resolvers and two size formatters:

- `src/components/record/inspector-sections.tsx` — `fileTypeIcon(mediaType)`:
  MIME-first, four Lucide-family glyphs (`table`, `download`, `box`), colour from
  `text-success-text` / `text-danger-text` / `text-link` / `text-fg-muted`, and
  `aria-hidden`, so the type was never stated in words.
- `src/components/notebook/block-preview.tsx` — `fileIconForType`, `FileIcon`
  and `FileMetaLine` (a notebook block; excluded — see below).
- `src/components/notebook/block-editor.tsx` — `fileGlyphFor` and its own row
  (also a block; excluded).
- `formatBytes` existed twice: as an alias of `formatFileSize` in
  `src/lib/file-attach.ts`, and again as its own implementation in
  `src/routes/records/$recordId/notebook.tsx` with different rounding and a
  different zero case.

### What ReUI offers

`@reui/file-type` (base-nova pin, ReUI-native, one file, dependencies
`class-variance-authority` and `cn`): 171 extensions across 13 families,
`getFileType` (name, URL, bare extension or MIME type) and `getFileTypeCategory`,
variants `outline / solid / light / mono`, sizes from 56px down to an 18px row
(`mini`), a page-and-label glyph with the extension's own short label, and
container-query sizing throughout.

Two facts about adopting it here, both recorded rather than hidden:

- **The restyle is substantial.** The item's per-format brand colours are
  Tailwind palette classes (`text-blue-600`, `text-pink-600`, …), which
  `scripts/check-colours.mts` rejects in `src/**`. The vendored copy maps each
  palette hue onto the app's semantic tokens (documents and code to `text-link`,
  spreadsheets to `text-success-text`, presentations and PDFs to
  `text-danger-text`, media to `text-warning-text`, the violet families to
  `text-primary-text`, neutral families to `text-fg-muted`), and its label band
  takes `--inverse-text` instead of a fixed white.
- **The label band's contrast was measured, not eyeballed.** With
  `--inverse-text` the band clears 4.5:1 on every family in both themes (light
  4.93–6.85:1, dark 6.46–11.75:1, computed from the token values in
  `src/styles.css`); a fixed white failed on `--success` (3.18:1),
  `--destructive` (4.22:1) and `--review` (3.97:1).

### Checklist result

Ten items are not applicable (no reorder, sort, filter, select, resize or
pagination control). Of the eight universal items:

| Check                                                     | Ours — the deleted resolver (before)                                | Theirs — `@reui/file-type` in the shipped row                                                     | How it was measured                     |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — no control in the row                                        | Pass — no control in the row                                                                      | Browser, both columns                   |
| Empty, loading, error, permission-restricted              | Pass — the shipped `FileList` owns its own "No attached files" hint | Pass                                                                                              | Browser (both columns) and jsdom        |
| Dark theme                                                | Pass — token colours only                                           | Pass — the restyled families and the label band, with colour contrast measured in the browser run | axe in Chromium with colour contrast on |
| Density at 1440x900 and 390x844                           | Pass — no overflow, long names truncate                             | Pass                                                                                              | Browser, both columns                   |

The two capability differences this row exists for are asserted in the product
test rather than the harness:

- **The type is named.** Every icon is `role="img"` with an accessible name
  ("PDF file", "XLSX file", "Image" for a family), where the old resolver was
  `aria-hidden` and the type was implied by a glyph and a colour.
- **The name decides before the media type.** `stability-run07.xlsx` stored with
  `application/octet-stream` now resolves to the spreadsheet family instead of
  falling through to the neutral glyph; a name with no type in it still falls
  back to the stored media type.

### Automated evidence

| Evidence                                                                                     | Result                                                                                     | Command                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Name-first resolution, the named type, and the media-type fallback in the shipped `FileList` | 20 tests in `inspector.test.tsx`, pass                                                     | `pnpm exec vitest run src/components/record/inspector.test.tsx`                                                     |
| axe, both columns: every fixture except the 5,000-row one, plus the three states             | 14 cases, **zero violations**                                                              | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                             |
| axe in Chromium, colour contrast on, both columns, both themes, plus a screenshot per column | 6 cases, **zero violations** — on the long-labels fixture, i.e. with long names in the row | `COMPONENT_COMPARE_SHOTS=<dir> pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser` |
| The 0-row fixture, phone-width containment and the Tab order, per pair                       | pass — the `converted domain jobs` block, 9 tests                                          | same command                                                                                                        |
| The colour check over the vendored file                                                      | no palette class, no hex, no `rgb()`                                                       | `pnpm check:colours` (part of `pnpm check`)                                                                         |
| The adopted row on screen, in both themes, in Storybook                                      | `UI/File Type` — sizes, variants, families and a file-row board                            | `pnpm build-storybook`                                                                                              |

### Decision and reason

**Adopt, scoped.** `@reui/file-type` replaces the inspector's resolver and is
vendored at `src/components/reui/file-type.tsx` with the `cn` re-point and the
token restyle ADR-0055 decision 2 permits, and no plugin or palette class left in
it. It clears the bar: the generic UI job is naming and drawing a file's type,
and the hand-rolled version is materially worse — the type was never stated in
words, and a name the product stores with a generic MIME type resolved to a
neutral glyph.

**Scope, recorded as an exclusion.** Two of the three resolvers live in notebook
blocks (`block-preview.tsx`, `block-editor.tsx`), which Part A owns; they are
left in place, and this row claims the inspector row and the component only. The
block rows follow when Part A next touches them, and until then the repository
holds one component with three call sites rather than one vocabulary.

`formatBytes` is unified: the local implementation in the notebook route is
deleted and the alias in `src/lib/file-attach.ts` is gone, so the one helper is
`formatFileSize` in `src/lib/format-numbers.ts`. That change reaches two imports
in `block-editor.tsx`, which Part A owns — a name change in an import line, made
because leaving two names for one helper is what this row exists to remove.

### Limits of this row

- The "ours" column is the deleted implementation, kept in the pair file alone as
  the comparison's before side (the runbook states the convention). It is not
  importable by product code.
- The fixed fixture set carries scientific sample rows, not files. The pair maps
  a row to a file deterministically — the row's name, a fixed extension cycle,
  the row's unit as the media type — and states that mapping in the file and
  here, because the alternative (a second fixture set) is not the harness's
  contract.
- The item's per-extension brand colours collapse to one token per family. That
  is a visible change to how a `.pdf` and a `.docx` read side by side; it is the
  colour check's requirement, and it is recorded rather than worked around with a
  checker exemption.
- No touch/small-screen device was run; the 390px measurement is a Chromium
  viewport, not a phone.

All three rows' browser evidence came from one run of the file on the orb's own
service stack (`pnpm db:fresh`, `pnpm db:seed:design`, PostgREST on 3001), with
`COMPONENT_COMPARE_SHOTS` set: **27 tests passed**, including the 6 new
axe-with-contrast cases and the 12 column screenshots cited above. The run
covers desktop Chromium at 1440x900 and 390x844 only; no other engine and no
real device was used.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
