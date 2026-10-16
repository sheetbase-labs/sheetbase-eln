---
title: Row chrome migration — Row, RowList and the property row
status: living record — the change, its decision, and every remaining site
last_reviewed: 2026-10-16
---

# Row chrome migration

The largest finding in
[`reui-opportunity-scan-domain.md`](reui-opportunity-scan-domain.md) §JH-1 was row
chrome: ≈30 row renderers across 21 files, in six families, with `RecordLink`
(92 lines) and `LinkedRecordList` (47) as competing twin implementations of the
same entity row. This file records the set that was built to own the job, the
files migrated in the first tranche, and — for every site not yet migrated —
what it renders, which primitive it should consume, and what must stay bespoke.

It exists because the rest of the work is deliberately a follow-on: a tranche
that leaves a written map is reviewable, and a map without a decision is not.

## The set

| Primitive         | File                              | Owns                                                                                                    |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Row`             | `src/components/v3/ui/row.tsx`    | One row: leading slot, optional eyebrow, title, optional meta, trailing slot — and its interaction form |
| `RowList`         | `src/components/v3/ui/row.tsx`    | The list: `<ul>`, spacing, hairline or gap, per-row density, empty slot, window (`limit`)               |
| `DescriptionList` | `src/components/v3/ui/layout.tsx` | Property and metadata rows: a label column and a value, in a `<dl>` (the design's own `.dl`)            |

Three, not one: a single god-row would have to carry the diff card, the
checklist row and the step row, which share nothing but `flex`. Two, not three:
the entity row and the "plain" row are the same frame, and the third is the
property row, whose anatomy is a `<dl>` label/value pair rather than
leading/title/meta/trailing. `DescriptionList` already existed as the v3 twin
(`docs/knowledge/design/ui-system-v3/design-system/components/bundle.css:221`,
`.dl { grid-template-columns: 104px 1fr }`); the family's job is to converge on
it, not to grow a fourth spelling.

### What was rejected, and why

- **A separate "link form" component.** The scan's API list implied one, and it
  is where the duplication actually lives: every hand-rolled row branched
  between a link and a static element and spelled its chrome twice. `Row` takes
  `to` (router link), `href` (anything the router does not own), `onClick` (an
  action) or none of them (read-only), following `TreeItem`, the kit's existing
  answer to the same question. Splitting the frame from the link would recreate
  the drift it is meant to remove.
- **A `render` prop.** Base UI's idiom for element polymorphism, and one the
  vendored ReUI item uses. Rejected because the row's forms are known and
  closed; a `render` prop would let a caller re-spell the chrome that this
  component exists to own.
- **An icon tile (`IconTile`, §JH-6).** It is its own planned row and its own
  finding. `Row` takes `leading` as a node, and the entity family's tile now
  exists once, inside `RecordLink`.
- **Adopting a registry `Item`.** See the row in
  [`component-comparison-record.md`](component-comparison-record.md): `@reui/item`
  and `@reui/row` do not exist (`{"error":"Registry item not found", … "item is
part of shadcn/ui, not a ReUI item"}`), and stock shadcn's compound `Item` has
  no link form, no state vocabulary, and brings the `cn` package. There was
  nothing to compare against, so no harness pair was added.
- **A `window`/`+N` prop on `Row` itself.** Windowing is a list behaviour:
  `RowList` takes `limit` and renders "Show all N", which is where
  `relationship-panel.tsx` hand-rolled it (the other three `+N` sites in the
  scan are avatar stacks and belong to §1 rank 1).

### The behaviour the primitives own

- **One chrome, four forms.** A link row, an anchor row, a button row and a
  read-only row share one class string. Hover fill, focus ring and cursor come
  from being interactive, not from which element was chosen.
- **A row in a list is a list item.** `RowList` publishes itself through
  context, so `Row` renders `<li>` inside one and a plain element outside it (a
  bare `li` outside a list is not valid). The row's hover detail (`detail`)
  becomes the item's `title`, so the whole item behaves as one row.
- **A list with no rows says what it has** (`empty`) rather than rendering an
  empty `<ul>`, the same contract `TableBody` already has for `loading`/`empty`.
- **Density is the list's, not the row's**: `card` (bordered, `p-3`, 14px title)
  and `list` (compact, 12px title). `RowList` passes it down; a row that stands
  alone defaults to `list`.

## Migrated in this change

| File                                                  | What changed                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/components/v3/ui/row.tsx` (new)                  | `Row`, `RowList`                                                                                                   |
| `src/components/scientific/record-link.tsx`           | `RecordLink` is now the v3 `Row` plus its five honest states; gains `density` and `detail`; uses the v3 icon set   |
| `src/components/record/inspector-sections.tsx`        | `LinkedRecordList` **deleted** (the competing twin); `FileList` and `CheckList` are `RowList` of `Row`             |
| `src/components/knowledge/relationship-panel.tsx`     | Rows are `RowList limit={RELATIONSHIP_RENDER_LIMIT}` of `RecordLink`; the bespoke window and `<li title>` are gone |
| `src/components/related-work/related-work-panel.tsx`  | Entity rows are `RecordLink density="list"` in a `RowList`; the `LinkedRecordItem` mapping is gone                 |
| `src/components/knowledge/record-lineage-section.tsx` | Lineage rows are `Row` (`href` when a destination resolves, read-only when it does not) in a `RowList`             |
| `src/components/offline/unsynced-changes.tsx`         | Unsynced rows are `Row` (time leading, title, detail); `data-unsynced-edit` passes through                         |
| `src/components/collaboration/notifications-bell.tsx` | Notification rows are `RowList divided` of `Row` (unread dot leading, title, body)                                 |
| `src/routes/foundations.tsx`                          | The Links tab renders the entity row the product renders, not the deleted twin                                     |

Nine renderers now consume the primitives, and one implementation of the entity
row remains. Stories: `src/stories/Row.stories.tsx` (forms, densities, divided,
windowed, empty) and `Scientific/Record link` gained the compact list.

**Interaction change to know about:** lineage rows are now whole-row links
(previously only the identifier was a link); `RowList limit` renders the same
"Show all N" control with a focus ring.

### Design-set impact, and the row that owes the update

The compact `list` density is deliberately borderless, and that is a real
appearance change to the inspector lists (`Related work`, `Lineage`, `Files`,
`CheckList`): a bordered row became a compact row with a hover fill. The
relationship panel's `RecordLink` rows keep their card density, so the
inspector's cards are unchanged.

It is also the design's own anatomy, which is why it is kept rather than
reconciled away:

- the design's referenced-record rows are compact table rows, not cards —
  `docs/knowledge/design/ui-system-v3/canvas/Notebook.dc.html`, `<table
class="ref">`: mono identifier link, title, muted kind, right-aligned
  quantity, status, one row per record;
- the design system's list row is a hairline, not a bordered box —
  `design-system/components/bundle.css:367` `.row-l { border-bottom: 1px solid
var(--border-subtle) }`;
- the carded spelling was ours, and two of the six families each invented it
  separately.

**The rows that owe the update**, both because the inspector's lists render
inside the notebook surface:

| Parity row                                | State       | Why it owes the update                                                                                                                                                                                |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecordDetail-light`, `RecordDetail-dark` | mapped      | `/records/CB-0012` renders the notebook surface, inspector included. Measured `0.03 (33055 px)` / `0.03 (32310 px)` against the 0.001 gate, cause 3 (seeded content) — already red before this change |
| `Notebook-light`, `Notebook-dark`         | **pending** | listed in `DESIGN_PENDING` — "Needs design-seed data the seed does not create yet (list rows, models, templates, …)" — so these comparisons do not run at all                                         |

**They cannot be updated today, and no expected image was re-rendered.** The
parity board is red by construction: the coverage test requires zero pending
screens — `tests/visual/parity.spec.ts:126-131`, `expect([...pending.keys()],
'DSYS-06 is incomplete while any design screen is pending').toEqual([])` and
`expect(mappedCount, …).toBe(total)` — while 45 of the 126 boards are mapped
and 81 (162 comparisons) are still pending. The expected images are the DSYS-01
renders produced from the design canvas by `scripts/design-reference.mts`, not
our app's output; re-baselining them from our render would invert the gate. So
the record of the change lives here instead, with the evidence below.

**What the update is, when the rows can be compared:** keep the compact rows.
The design's inspector (the `Notebook` board's `aside.insp`) renders the cell
inspector, not our seeded `Related work` / `Lineage` / `Files` panels, so the
inspector will still differ from the reference for seeded-content reasons after
this change; the density is not the difference to reconcile. Whoever clears
cause 3 for `RecordDetail` (or maps the `Notebook` board) owns re-measuring
these rows and saying whether the difference moved.

Evidence, captured 16 Oct 2026 at 1440×900, actor the auth-free demo owner,
route `/records/00000000-0000-4000-8000-000000000101/notebook`, Chromium
headless 149, both themes, the devtools launcher cropped out:

| Light                                                                        | Dark                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`row-chrome/inspector-rows-light.png`](row-chrome/inspector-rows-light.png) | [`row-chrome/inspector-rows-dark.png`](row-chrome/inspector-rows-dark.png) |

What the pair is not: it is not a parity comparison. It records what the app
renders, not what the design expects.

## Remaining sites

### Entity, file, check and plain rows

| File · renderer                                                                | What it renders                                                        | Target                                               | Note                                                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `overview/overview-view.tsx:119` `ReadinessRow`                                | Title, detail paragraph, trailing action link                          | `Row` (`meta` = detail, `trailing` = the link)       | Readiness severity colouring stays on the title node, per ADR-0011                                        |
| `overview/overview-view.tsx:159` `LinkedExperimentRow`                         | A 64px label column with a link, title and status in the value column  | `DescriptionList`                                    | It is a property row, not an entity row                                                                   |
| `scientific-record-summary.tsx:110-118` linked counts                          | Label + count per row                                                  | `Row` (title, `trailing` count) or `DescriptionList` | Small; pick whichever the surrounding section uses                                                        |
| `record/inspector-sections.tsx:204` `ActivityFeed`                             | Avatar, actor, action, target, time                                    | `Row` once the avatar work lands (§1 rank 1)         | The avatar and relative-time defects are that finding's; the row frame is this one's                      |
| `review/review-check-results.tsx:79` `CheckResultItem`                         | Status icon, label, severity badge, disclosure chevron, evidence panel | `Row` for the trigger row; the evidence panel stays  | Depends on the disclosure finding (§1 rank 5); the expanded `<pre>` is a separate raw-payload row         |
| `assist/guide-panel.tsx:44-107`                                                | Ordered steps with a state chip                                        | The stepper finding's row (§JH-7)                    | The v3 `Stepper` already exists; the missing half is the state vocabulary                                 |
| `overview/overview-view.tsx:267-299` protocol steps                            | Numbered step rows with a `Status` tone                                | As above                                             | Same finding                                                                                              |
| `import/import-flow.tsx:806`                                                   | An inline `name · size · SHA-256` line                                 | `Row`                                                | Owned by the import-flow thread right now                                                                 |
| `notebook/block-preview.tsx:875-906`, `block-editor.tsx:1874-1975`             | File rows inside notebook blocks                                       | —                                                    | Part A owns notebook blocks and their chrome (owner decision)                                             |
| `v3/settings/settings-page.tsx:64` `CheckRow`                                  | Checkbox + label + one muted line, inside a `<label>`                  | Stays as is                                          | A field row whose control wraps the label; `Row` would have to drop its own semantics                     |
| `scientific/record-picker.tsx:187` `RecordPickerItem`                          | A `CommandItem` with identifier, title and status badge                | Stays bespoke                                        | Selection, `aria-selected` and keyboard movement come from `Command`; it is a picker item, not a list row |
| `record/record-header.tsx:167`, `presence-avatars.tsx:90` `+N`                 | Avatar stacks with overflow                                            | The avatar finding                                   | Not row chrome                                                                                            |
| `notebook/notebook-outline-panel.tsx:107`                                      | Outline entries that jump to a block                                   | Stays bespoke (the v3 `Tree`/nav idiom)              | Navigation, not a content row                                                                             |
| `audit/audit-trail.tsx`, `object-history-timeline.tsx`, `approval-stepper.tsx` | Event and step rows                                                    | The audit-timeline and stepper findings' rows        | Owned by other threads right now; they consume `Row` when their findings land                             |

### Property and metadata rows — `DescriptionList`

Four spellings of one job; all four converge on `DescriptionList`, which is the
design's `.dl`:

| File · renderer                                                | What it is                                                     | What it needs                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scientific/property-list.tsx:33-57` `Property`/`PropertyList` | Label/value with `mono`, `stacked` and right-aligned values    | Delete or re-express on `DescriptionList`; no product call sites remain (the story and one test use it) |
| `scientific-record-summary.tsx:127` `PropertyRow`              | Label left, value right, `mono` option, orphaned-field warning | `DescriptionList`; needs the _inline split_ alignment and a per-item `mono` flag                        |
| `notebook/notebook-inspector.tsx:253` `FactRow`                | `7rem` label column, "Not available" fallback                  | `DescriptionList labelWidth={112}`; the fallback is the caller's value node                             |

The extension these three need — `stacked`, an inline split alignment, per-item
`mono` — is §JH-2's work, not this change's, and it should be added to
`DescriptionList` once, against all three call sites, rather than three times in
three local spellings.

### What stays bespoke

- **Diff cards** (`review/revision-diff-review.tsx:155` `ChangeCard`, `:186`
  `TableDiffCard`): change semantics, counts, paging and focus plumbing. Only a
  later shell could be `Row` card density; the body is the product.
- **Comment rows** (`comments/comment-thread.tsx:90`, `record/inspector-sections.tsx:244`,
  `review/revision-document-review.tsx:294` and `:381`): anchored review
  discussion with resolve/reopen and evidence anchors. A bubble or generic row
  would drop those semantics (§JH-3, and the avatar finding owns the header).
- **Evidence panels** (`review-check-results.tsx`'s expanded `<pre>`, audit raw
  payloads): the raw-payload row (§1 rank 7), not row chrome.
- **Notebook blocks and their chrome**: excluded by owner decision; Part A owns
  them.
- **The sheet grid and its chrome**: ADR-0048.
- **Empty states**: the `empty` slot is a passthrough; the copy and treatment
  remain the empty-states decision (owner decision, §11.2).

## Migrating one more site

1. Decide which primitive the site is: an entity/plain row (`Row`), a list
   (`RowList`), or a property row (`DescriptionList`). If it is a comment, diff
   or step row, it is probably not this change's.
2. Put the row's identity in `title`, its explanation in `meta`, its label in
   `eyebrow`, and its count/actions in `trailing`. If an action belongs inside
   the row, it goes in `trailing` with `stopPropagation` (the nested-control
   shape `RecordLink` already has).
3. Use `to` for internal routes and `href` for everything else; leave the row
   read-only when the viewer cannot act on it — that is the honest state, not a
   disabled link.
4. Delete the old `<ul>`/`<li>`/`<a>`/`<div>` spelling in the same change. A
   second implementation left behind is how the twins appeared.
5. Run the site's own test, `src/components/v3/ui/row.test.tsx`, and look at the
   rendered surface in both themes.

## Limits

- The remaining table is a source read at the merge state of this change, not a
  re-measurement of every directory; the scan's counts (≈30 renderers, 21 files)
  were taken at `35423ec2` and both drift.
- `DescriptionList`'s extension is described, not built: it is §JH-2's job.
- The compact `list` density is borderless by design (the v3 hairlines and
  `home-quiet` rows agree), so migrating a bordered row changes its appearance
  where the caller does not override it. Each migration should say so.
- Screenshots and axe are evidence for the surfaces this change touched, not a
  verdict on screens no one has rendered yet.
