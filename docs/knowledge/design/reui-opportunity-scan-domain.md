---
title: ReUI opportunity scan — domain components (beyond the planned set)
status: discovery — evaluated, nothing adopted
last_reviewed: 2026-10-16
---

# ReUI opportunity scan — domain components

A discovery pass, not an implementation. It walks the domain components
(`src/components/**` outside `src/components/v3/**` and outside the legacy
`src/components/ui/**` kit) and records every place the app hand-rolls a generic
UI job that the ReUI index ships, plus every job that several hand-rolled
versions share even where no ReUI item exists.

It exists because the adoption list in
[`plans/notebook-editor-and-reui.html`](../../../plans/notebook-editor-and-reui.html)
§4.5 was built from one inventory pass over the notebook and the tables. This
pass covers the other twenty-two directories, and two of its findings (the
avatar/initials work and the row-chrome consolidation) are large enough to
change the shape of the sweep.

**Authority.** The bar in §4.4 (five items) and the exclusions in §11.6 still
govern. The owner's instruction of 2026-10-16 changes the _ranking_: candidates
are ranked by what an adoption buys, not by the Tier 1/2/3 gate. Exclusions are
held only where an ADR or an explicit owner decision says so — the sheet grid
(ADR-0048), the figure renderers, the scientific status vocabulary (ADR-0011),
anything `sheetbase-advanced-search` owns, notebook blocks and their chrome, and
empty states. A story is now part of a candidate's deliverable, so each entry
names the story that exists or the one it needs.

**Scope counted.** 23 directories, ≈120 non-test files, ≈31,400 lines. Every
claim below is a source read at `35423ec2b2b498da9773c2c39152ab37d8524fbf` on
`scan/domain-opportunities`. ReUI items were confirmed against the registry
itself (`reui.io/r/base-nova/<name>.json`), which also answers which items are
ReUI-native and which are stock shadcn on the same index — a distinction §11.3.4
requires and §4.5 records for only some rows.

Legend for the verdict column: **componentise** = one in-house component owns the
job (the target is usually the v3 twin, not a ReUI install); **adopt** = the ReUI
item is the better owner; **no** = leave it. "Story:" names what exists and what
a change would owe.

## 1. Ranked candidates where ReUI ships an item for the job

| #   | Job                                        | Where we hand-roll it (paths · counts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ReUI item                                                                                                                                                                                                                                                        | What is materially worse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Verdict & caveats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Identity: avatar + initials + avatar stack | **6 render sites in 4 files, 3 initials algorithms, 2 hand-rolled stacks.** `record/record-header.tsx:55-77` (a local `Avatar`, exported as `RecordHeaderAvatar`, used at `:149` owner and `:161` contributors), `record/inspector-sections.tsx:281` (ActivityFeed), `:323` (CommentList), `:348-390` (ContributorAvatars, its own stack + `+N`), `comments/comment-thread.tsx:53-56` (`authorInitials`), `:113-124` (inline chip), `collaboration/presence-avatars.tsx:32-36` (`initialsFor`), `:85` (composes the **v3** Avatar), `:90-98` (its own `+N`). `audit/audit-trail.tsx:24` carries an `initials?` prop that is never rendered                                                     | `avatar` is **stock shadcn**, not a ReUI item (`reui.io/r/base-nova/avatar.json` 404s). A v3 twin already exists: `src/components/v3/ui/avatar.tsx` (`Avatar`, `initials`, `size`)                                                                               | Three algorithms disagree about the same person: `presence-avatars.tsx:32` takes the first letter of up to two words (`Gareth Price` → **GP**), `record-header.tsx:64` and `inspector-sections.tsx` slice the name (`Gareth Price` → **GA**), and `comment-thread.tsx:55` slices the _display label_ (`Reviewer` → **RE**). The same user is therefore drawn differently in the presence stack, the record header and the comment thread — and `record-header.tsx:55` shadows the v3 component of the same name. The stack/overflow behaviour exists three times, each with its own ring, size and spacing | **Componentise onto the v3 Avatar; no ReUI install** (a second Avatar would be a second design language for a one-file job). Extend the v3 Avatar with `name`-derived initials and a `stack`/`overflow` composition, then delete the three local spellings. ADR-0055 decision 4 bar items 3–4 apply. Story: `Avatar.stories.tsx` targets the **legacy** kit; `RecordHeader.stories.tsx` and `CommentPanel.stories.tsx` exercise the hand-rolled ones. Needs a v3 Avatar story (sizes, initials, stack) and updated RecordHeader/Comment rows; `inspector-sections` and `presence-avatars` have no story at all                          |
| 2   | Inline notice / banner state               | **6 hand-rolled alert or banner chromes, while 16 files outside the v3 kit already compose the v3 pair** (and ~25 more inside it). `comments/comment-panel.tsx:245-250` and `:324-329` (`border-destructive/40 bg-destructive/10` boxes), `audit/record-history-timeline.tsx:212-226` (error box + retry), `audit/object-history-timeline.tsx:265` (error box), `offline/offline-banner.tsx:48-79` (a page strip: `border-b … bg-warning-wash px-4 py-2 md:px-6`, the same anatomy as v3 `Banner`), `notebook/conflict-banner.tsx:45-70` (`border-danger/40 bg-danger-wash`), `scientific/model-field-input.tsx:378,397,403` and `favourites/favourite-toggle.tsx:55` (field-level error text) | `alert` **is** ReUI-native (`@reui/alert`, one file), but the v3 kit already ships the equivalent pair: `Notice` and `Banner` in `src/components/v3/ui/alert.tsx` (tone `info/warn/bad/review`, icon, title, action, `role` set from tone)                       | The hand-rolled boxes are on the **app-3 bridge vocabulary** (`border-destructive`, `bg-destructive/10`, `text-danger-text`) rather than the v3 danger tokens, so they drift from every neighbour while still passing the colour check (§11.5's trap). None carries an icon or an action slot; `role` is chosen ad hoc (`role="alert"` in four files, `role="status"` in the offline strip) where the v3 pair derives it from tone. `offline-banner.tsx` re-implements `Banner`'s anatomy including its padding scale                                                                                      | **Componentise onto the v3 `Notice`/`Banner`; no ReUI install.** `import-flow.tsx:337` already composes `Banner` (nine uses in that file) and `notebook-template-upgrade-banner.tsx` composes it too, so the pattern is established — the six sites are stragglers. `conflict-banner.tsx` is notebook _editor_ chrome (not a block), so it is in scope; its `<pre>` server preview is a separate row (see §2, JH-4). Story: `States.stories.tsx` and `Alert.stories.tsx` cover the **legacy** `ui/alert` only — a v3 Notice/Banner story is needed, and the offline/review/comment rows are unstoried                                   |
| 3   | File type icon + file metadata             | **3 icon resolvers, 3 row spellings, 2 size formatters.** `record/inspector-sections.tsx:126-159` (`fileTypeIcon`: MIME-or-extension → icon **and** colour), `:161-206` (`FileList`), `notebook/block-preview.tsx:889-897` (`fileIconForType`) + `:899-906` (`FileIcon`) + `:875-888` (`FileMetaLine`), `notebook/block-editor.tsx:1974-1990` (`fileGlyphFor`, Lucide icons) + `:1874-1895`, `import/import-flow.tsx:806` (an inline `name · size · SHA-256` line). Sizes: shared `formatFileSize` (`src/lib/format-numbers.ts:73`) reused as `formatBytes` (`src/lib/file-attach.ts:34`) plus a **second** `formatBytes` at `src/routes/records/$recordId/notebook.tsx:2501`                  | `@reui/file-type` — ReUI-native, one file, deps `class-variance-authority` + `cn` only, no Base UI part. 171 extensions, 13 families, variants `outline/solid/light/mono`, sizes down to a grid row, and `getFileType(name)` / `getFileTypeCategory()` resolvers | Three icon vocabularies for one file (`table`/`download`/`box` in the inspector, `box`/`download` in the preview, Lucide `ImageIcon`-family in the editor), two colour semantics (the inspector paints icons `success-text`/`danger-text`/`link`; the preview does not), and no surface states the _type_ as a label. Resolution is MIME-first, so a name like `stability-run07.xlsx` with a generic `application/octet-stream` falls through to a generic glyph. The duplicate `formatBytes` proves the same drift in the size half of the job                                                            | **Adopt, scoped.** `@reui/file-type` is a clean copy-and-own win for `record/inspector-sections.tsx` (the one non-block site), and `getFileType` replaces all three resolvers. **Caveat:** two of the three resolvers live in notebook blocks, which the owner's exclusion holds — so the adoption lands the component and the inspector row first, and Part A decides when the block rows follow. Bar item 4 (no parallel implementations) therefore applies per surface, not repo-wide. Story: no File Type or file-row story exists; `SchemaBadge.stories.tsx` is the nearest neighbour. Needs a File Type story + a file-list story |
| 4   | Pressed-state toggle chip group            | **5 sites, no v3 twin.** `review/revision-diff-review.tsx:493-509` and `:516-534` (`role="group"` chip rows with counts), `review/revision-document-review.tsx:740`, `audit/experiment-history.tsx:147` (category strip), `notebook/rich-text-editor.tsx:650` (editor toolbar — editor chrome, not a block), `notebook/notebook-sheet-block.tsx:256`. The legacy kit has `ui/toggle-group.tsx` and `ui/segmented.tsx`, and **neither has a product call site** — only their stories                                                                                                                                                                                                            | `toggle-group` is **stock shadcn**, not a ReUI item. No v3 twin exists (`src/components/v3/ui/` has no toggle or toggle-group)                                                                                                                                   | Each site picks its own pressed treatment (`variant={enabled ? 'primary' : 'secondary'}` in the diff review, `aria-pressed:bg-selection aria-pressed:ring-1 aria-pressed:ring-primary` in the sheet block, `bg-primary/10`-style washes elsewhere), so the same "filter on/off" affordance looks different on three screens. A `role="group"` of buttons has no roving focus and no arrow-key navigation — a named missing behaviour, not a style difference — and no site states the pressed set to assistive tech as a group                                                                             | **Componentise a v3 `ToggleGroup`** (restyle stock shadcn's item if its anatomy holds; do not install both). The two chip rows in `revision-diff-review.tsx` are the strongest first targets because they carry counts and labels. Caveat: 2 of the 5 sites are notebook editor chrome — one is a block (`notebook-sheet-block.tsx`, excluded), one is not (`rich-text-editor.tsx`). Story: `ToggleGroup.stories.tsx` and `SegmentedControl.stories.tsx` cover the legacy kit only; a v3 toggle-group story is needed, and `RevisionDiffReview.stories.tsx` should gain the chip row                                                    |
| 5   | Disclosure: expand to reveal detail        | **5 `aria-expanded` hand-rolls (3 in scope) + 1 in-scope native `<details>`.** `review/review-check-results.tsx:85-128` (button + chevron + evidence panel), `review/revision-diff-review.tsx:186-295` (`TableDiffCard`: toggle, count label, paged detail list), `scientific/scientific-record-linker.tsx:204`, `notebook/pipeline-output-block-proposal.tsx:217` (block chrome — excluded), `notebook/block-editor.tsx:345` (block chrome — excluded); `<details>` at `notebook/block-editor.tsx:2986` (block chrome — excluded) and in the sheet/viz surfaces (excluded)                                                                                                                    | `accordion` and `collapsible` are **stock shadcn**, not ReUI items. No v3 twin; the legacy `ui/accordion.tsx` has no product call site                                                                                                                           | Each hand-roll re-implements the trigger, the chevron rotation, the expanded panel's border and padding, and the open/closed announcement. The behaviour is small, so the case rests on maintenance rather than a missing feature — except that nothing enforces the same keyboard and `aria-expanded` handling, and the two review disclosures (which reviewers use to inspect evidence) are the app's most load-bearing                                                                                                                                                                                  | **Componentise a v3 `Collapsible`/`Disclosure` and adopt it in the review surfaces first.** Only the _toggle chrome_ is generic: `TableDiffCard`'s counts, paging and focus plumbing stay ours. Caveat: half the sites are Part A block chrome — excluded. Story: `Accordion.stories.tsx` targets the legacy kit; `ReviewCheckResults.stories.tsx` and `RevisionDiffReview.stories.tsx` exist and should be updated, and `scientific-record-linker.tsx` has no story                                                                                                                                                                    |
| 6   | Loading spinner                            | **5 sites in 4 files, and the repo's own spinner has no product call site.** `live/connection-status.tsx:43` (`Loader2`), `:54` (`RefreshCw`), `offline/offline-banner.tsx:76` (`RefreshCw`), `dataset-schema/schema-badge.tsx:46` (`Loader2`), `notebook/save-status.tsx:43` (`clock`), `:53` (`move`). `src/components/ui/spinner.tsx` exists and is imported only by `src/stories/Spinner.stories.tsx` — the same "zero product call sites" pattern §11.2 records for `ui/empty.tsx`                                                                                                                                                                                                        | `spinner` is **stock shadcn**, not a ReUI item (`reui.io/r/base-nova/spinner.json` 404s)                                                                                                                                                                         | The indicator is different every time, and two sites spin a _semantically different_ icon to mean "working" (a clock for saving, a movement glyph for retrying), so the same state reads differently on adjacent surfaces. Size, colour and stroke vary with the host's `size-3` class rather than a scale; nothing owns the reduced-motion decision                                                                                                                                                                                                                                                       | **Componentise a v3 `Spinner` (restyle stock shadcn's) rather than install a ReUI item**, then delete the unused legacy file. The cheapest candidate in this table and the strongest "twin exists but nobody uses it" evidence. Story: `Spinner.stories.tsx` covers the legacy file only — re-point it at the v3 component; `SaveStatus`, `ConnectionStatus` and `SchemaBadge` stories already exist and would show the swap                                                                                                                                                                                                            |
| 7   | Code / raw-payload display                 | **7 files with a single `<pre>` each in these directories:** `review/review-check-results.tsx:124` (evidence JSON, `max-h-48 overflow-auto`), `audit/object-history-timeline.tsx:130-151` (`RawPayload`: a native `<details>` over a `<pre>`), `notebook/conflict-banner.tsx` (server preview, block-adjacent editor chrome), `notebook/rich-text-editor.tsx`, `notebook/block-preview.tsx` and `notebook/block-editor.tsx` (two sites; block chrome — excluded), `review/revision-diff-review.tsx:124` (a `ChangeValue`, rendered `font-sans` — a value, not code)                                                                                                                            | `@reui/code-block` — ReUI-native, and the largest item in the catalogue: Shiki highlighting, streaming, diffs, folding, per-line interactivity                                                                                                                   | No copy button, no line numbers, no folding, no highlighting, and long payloads are truncated by ad-hoc `max-h` classes. Two of the three in-scope instances are evidential (a frozen check result's evidence, a change event's raw payload), where copy-and-preserve matters more than colour                                                                                                                                                                                                                                                                                                             | **Mostly no; adopt only if a real code surface appears.** The evidential dumps are better served by one small in-house `RawPayload` disclosure (copy button + monospace + bounded height) than by pulling Shiki into the bundle — the plan's own rule is that the free items are key-free, not dependency-free. Two of the seven sites are excluded block chrome. Story: none covers any of these dumps; a `RawPayload` story would be needed                                                                                                                                                                                           |

Not in this table: the ReUI-native items with **no** hand-rolled instance found
in these directories — see §3.

## 2. In-house jobs to componentise (no ReUI item, or our twin already exists)

These are wanted regardless of ReUI, because several hand-rolled versions of one
job exist. Each entry names the implementations, the count, and what one
component's API would have to cover.

### JH-1 Row chrome — the list-item/card job (the largest single finding)

**≈30 row renderers across 21 files in these directories, in six recurring
families.** There is no product row component; the two closest candidates are
duplicates of each other (`RecordLink` is 92 lines with state, icon, actions and
a hover arrow; `LinkedRecordList` is 47 lines doing the simpler half of the same
thing).

| Family                 | Renderers                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity / linked record | `record/inspector-sections.tsx:65` `LinkedRecordList`; `scientific/record-link.tsx:66` `RecordLink`; `scientific/record-picker.tsx:187` `RecordPickerItem`; `knowledge/record-lineage-section.tsx:64-89` (inline); `collaboration/notifications-bell.tsx:91-124` (inline, plus its own unread dot); `overview/overview-view.tsx:159` `LinkedExperimentRow`; `offline/unsynced-changes.tsx:88-102` (inline) |
| Property / metadata    | `v3/ui/layout.tsx:166` `DescriptionList` (**the v3 twin**, 4 uses in `overview-view.tsx` alone); `scientific/property-list.tsx:33-57` `Property`/`PropertyList`; `scientific/scientific-record-summary.tsx:127` `PropertyRow` (+ its own `<dl>` and a linked-counts list at `:110-118`); `notebook/notebook-inspector.tsx:253` `FactRow`                                                                   |
| File                   | `record/inspector-sections.tsx:161` `FileList`; `notebook/block-preview.tsx:875-906`; `notebook/block-editor.tsx:1874-1975` (block chrome — excluded); `import/import-flow.tsx:806` inline meta line                                                                                                                                                                                                       |
| Comment                | `comments/comment-thread.tsx:90` `CommentRow`; `record/inspector-sections.tsx:310` `CommentList`; `review/revision-document-review.tsx:294` `CommentCard`; `:381` `CommentMarker`                                                                                                                                                                                                                          |
| Check / readiness row  | `record/inspector-sections.tsx:228` `CheckList`; `review/review-check-results.tsx:79` `CheckResultItem`; `overview/overview-view.tsx:119` `ReadinessRow`; (`v3/settings/settings-page.tsx:64` `CheckRow` — v3, out of scope)                                                                                                                                                                               |
| Event / step row       | `audit/audit-trail.tsx:128`; `audit/object-history-timeline.tsx:153` `GroupRow`; `audit/approval-stepper.tsx:134-176`; `assist/guide-panel.tsx:46-105`; `overview/overview-view.tsx:267-299`                                                                                                                                                                                                               |
| Change / diff card     | `review/revision-diff-review.tsx:155` `ChangeCard`; `:186` `TableDiffCard`                                                                                                                                                                                                                                                                                                                                 |
| Outline row            | `notebook/notebook-outline-panel.tsx:107`                                                                                                                                                                                                                                                                                                                                                                  |

**What one component's API has to cover:** a leading slot (icon tile or avatar),
a title, a meta/secondary line (or two), a trailing slot (count, badge, actions,
hover affordance), an optional href with a link-vs-static state, an unavailable
state that explains itself instead of linking (`RecordLink`'s five states, which
`LinkedRecordList` cannot express), a density, and a `+N`/expand affordance for
windows (four files have their own "show all" or `+N`: `record-header.tsx:167`,
`inspector-sections.tsx`, `presence-avatars.tsx:90`,
`knowledge/relationship-panel.tsx:88`).

**Verdict:** do it as **three** primitives, not one — an entity row
(`RecordLink`, which already exists and should become the single implementation),
a property row (§JH-2), and a plain title+meta+actions row for the surfaces with
no domain state. A single god-row would have to carry the diff card, the
checklist row and the step row, which have nothing in common but `flex`.
**Caveat:** the two comment files are also the two files carrying the avatar and
relative-time defects, so JH-1 should land with §1 rank 1 and §JH-3.
**Story:** `RecordLink.stories.tsx`, `PropertyList.stories.tsx`,
`ScientificRecordSummary.stories.tsx`, `NotebookBlock.stories.tsx` exist; nothing
covers `inspector-sections`, `knowledge/*`, `related-work`, `overview`,
`collaboration/*` or `offline/*`.

### JH-2 Property / metadata list

Four spellings of one job (`DescriptionList` v3, `PropertyList`/`Property`,
`PropertyRow`, `FactRow` — paths above), each choosing its own label column
width, truncation rule, mono treatment and stacked-vs-inline layout. The v3 twin
is the target; it needs `stacked` and `mono` options that `scientific/property-list.tsx`
and `notebook/notebook-inspector.tsx` already invented locally.
**Story:** `PropertyList.stories.tsx` and `ScientificRecordSummary.stories.tsx`
exist; the v3 `DescriptionList` has no story.

### JH-3 Comment row and anchor vocabulary

Four spellings (paths above) plus a second anchor-description vocabulary:
`comments/comment-thread.tsx:31-39` `TARGET_KIND_LABEL` against
`:58-75` `describeTarget`, and `review/revision-document-review.tsx`'s own marker
labels. Comment rows are a JH-1 family, but the _anchor description_ is a
separate job worth one exported function so the panel and the review workspace
cannot describe the same anchor differently.
**Story:** `CommentPanel.stories.tsx` covers `CommentThread`; the review
workspace's comment cards have no story.

### JH-4 Relative-time formatting

Two implementations in these directories — `comments/comment-thread.tsx:77-88`
and `audit/record-history-timeline.tsx:80-93` — with different thresholds
(<60s vs <45s) and different fallbacks (none vs a calendar date past 30 days).
§11.2 records a third in the history panels. One helper with a threshold
argument and a documented fallback.
**Story:** not a component; no story.

### JH-5 Star / favourite toggle

`favourites/favourite-toggle.tsx:41-57` (stateful, RPC-backed, optimistic, error
text) and `record/record-header.tsx:116-128` (presentational, `starred` +
`onToggleStar`, its own `Star` button and its own filled style: `fill-warning
text-warning-text` vs `fill-current text-primary`). One control with a
presentational core and the RPC wrapper around it.
**Story:** `RecordHeader.stories.tsx` covers the presentational variant;
`FavouriteToggle` has no story.

### JH-6 Icon tile (cross-reference §4.5's planned Icon Tile)

Square icon containers are hand-rolled in at least five shapes:
`record/inspector-sections.tsx:73` (`size-6 rounded-md bg-selection`),
`scientific/record-link.tsx:81-90` (`size-8 rounded-md bg-primary/10`),
`review/review-check-results.tsx:50-68` (`size-16`-ish icon-only, colour by
status), `audit/object-history-timeline.tsx:170` (`size-8 rounded-full border`),
`audit/approval-stepper.tsx:147-162` (`size-7 rounded-full border` with per-state
rings). The planned Icon Tile row covers this; this scan adds the
`record/inspector-sections.tsx` tile, the `scientific/record-link.tsx` tile and
the two audit circles as concrete sites — two of the sites are in the audit
surfaces, which is also where the Timeline adoption lands.

### JH-7 Step chrome (cross-reference §4.5's planned Stepper)

Three renderers in these directories outside v3: `audit/approval-stepper.tsx`
(vertical, six states, its own connector line), `assist/guide-panel.tsx:44-107`
(ordered steps with a state chip), and `overview/overview-view.tsx:264-301`
(numbered protocol-step rows with a `Status` tone). The v3
`src/components/v3/ui/stepper.tsx` already exists (horizontal numbered strip,
`current`/`done`/`todo`/`failed`) and `import-flow.tsx:334,853` composes it, so
the in-house half of this job is the **state vocabulary**, not the chrome.
Notebook `procedure_step` block chrome (`block-editor.tsx:1564`,
`block-preview.tsx:399`) is Part A's and excluded.

### JH-8 Field-level error text

`favourites/favourite-toggle.tsx:55`, `scientific/model-field-input.tsx:378,397,403`
and the v3 `Input`'s `Field`/`FieldError` pattern: three ways to say "this field
is wrong" in eleven-pixel text. Small, but it is the same job as the `Notice`
finding (rank 2) seen from the field's side.

## 3. Checked, no opportunity

| Job the catalogue offers                                               | Why there is nothing to convert                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Progress                                                               | No hand-rolled percentage bar outside `v3/` (which is out of scope) and the sheet: `rg 'style=\{\{ *width'` finds only `v3/samples/*`, `v3/ui/command.tsx`, `v3/inventory/list.tsx`, `v3/settings/parser-versions.tsx` and sheet files. `notebook/notebook-block-reorder.tsx:106` is a one-line drop indicator and is deleted by the Sortable adoption (§4.5 Tier 1) |
| Pagination                                                             | No page controls outside `scientific/data-table.tsx` (TanStack v8, the planned Data Grid target) and the sheet. The audit surfaces use "Load more" (`audit/audit-trail.tsx:153-167`, `audit/object-history-timeline.tsx:294-303`), which is a window, not pagination                                                                                                 |
| Resizable / split panes                                                | No pointer-resize splitter anywhere in these directories; the only pointer-drag plumbing is the sheet's formula-reference picker (excluded) and the notebook's HTML5 drag (planned Sortable)                                                                                                                                                                         |
| Color Picker                                                           | No `type="color"`, swatch picker or colour model in these directories                                                                                                                                                                                                                                                                                                |
| Emoji Picker                                                           | No emoji input or shortcode handling anywhere in `src/components` outside the legacy kit                                                                                                                                                                                                                                                                             |
| Rating                                                                 | No star/numeric rating input. The two `Star` uses are a favourite toggle (§JH-5), not a rating                                                                                                                                                                                                                                                                       |
| Phone Input                                                            | No `type="tel"`, no phone field. `scan/camera-scanner.tsx` is a camera/typed-ID surface with no catalogue counterpart                                                                                                                                                                                                                                                |
| Kanban                                                                 | No board/column/swimlane surface in these directories                                                                                                                                                                                                                                                                                                                |
| Icon Stack                                                             | No layered-icon container; icon _tiles_ exist and are covered by §JH-6                                                                                                                                                                                                                                                                                               |
| Scrollspy                                                              | `notebook/notebook-outline-panel.tsx:105-141` is a jump-to-section TOC that tracks no scroll position, so it is a nav list, not a scrollspy. A scrollspy would add behaviour nothing currently claims                                                                                                                                                                |
| Message / Bubble / Message Scroller                                    | No chat surface. `collaboration/thread-panel.tsx` renders Liveblocks' own `Thread`/`Composer`, and `comments/*` is anchored review discussion with resolve/reopen and evidence anchors — a bubble primitive would drop those semantics, not extend them                                                                                                              |
| Questionnaire                                                          | No survey/questionnaire builder; `assist/submission-readiness-guide.tsx` drives a step guide (planned Stepper), not a question set                                                                                                                                                                                                                                   |
| Attachment                                                             | Folded into File Upload (planned) and the file row (§JH-1)                                                                                                                                                                                                                                                                                                           |
| Field / Input Group / Input OTP / Native Select                        | The v3 kit already owns `Field` + `Input`, and the domain surfaces compose them (`scan/camera-scanner.tsx:281-294`; `scientific/model-field-input.tsx` composes `v3/ui/checkbox`, `v3/ui/input` and `v3/projects/select`'s `NativeSelect`). No hand-rolled twins found beyond §JH-8                                                                                  |
| Separator, Skeleton, Tooltip, Tabs                                     | The v3 kit owns these and the domain surfaces compose them: one hand-rolled `role="tablist"` only (`scientific/scientific-record-linker.tsx:216-230`), which is a 14-line composition gap, not a catalogue adoption. Skeleton and Tooltip are used through v3 everywhere in scope                                                                                    |
| Context Menu / Menubar / Navigation Menu / Sidebar / Drawer / Carousel | No hand-rolled equivalents in these directories; the v3 shell owns navigation (out of scope)                                                                                                                                                                                                                                                                         |
| Command                                                                | `notebook/add-block-menu.tsx:5-12` already composes the **v3** Command; `notebook/slash-command-menu.tsx:66-110` is a bespoke listbox for the editor's inline `/` menu (editor chrome, not a block). Worth folding into the same Command when Part A next touches the editor — recorded here, not counted as a ReUI candidate                                        |

## 4. Excluded, by ADR or owner decision

Reported as excluded rather than missed, per the instruction.

| Surface                                                                                                                                                                                                                                                                 | Exclusion                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Sheet grid and its chrome (`src/components/sheet/**`) — including its `<details>` payload disclosures, its spinners and its paging                                                                                                                                      | ADR-0048; §11.6                                                                                          |
| Figure renderers (`src/components/viz/**`): `chart-renderer.tsx`, `analysis-panel.tsx`, `chart-configurator.tsx`, `plate-map.tsx`, `compare-view.tsx`                                                                                                                   | Owner decision; §4.5 "Charts … Replaced only by a deliberate product decision, never opportunistically"  |
| `viz/chart-frame.tsx` (158) and `viz/representation-frame.tsx` (133) — the near-identical twins §11.2 records                                                                                                                                                           | The planned **Frame** row owns them; the scan confirms the duplication and adds nothing                  |
| Scientific status vocabulary (`scientific/status-badge.tsx`, the `Status` tones, `review-check-results.tsx`'s severity labels, `overview/readiness.ts` severities)                                                                                                      | ADR-0011; the planned row keeps it in-house                                                              |
| `sheetbase-advanced-search` filter builder ownership — including `review/revision-diff-review.tsx`'s change-type/area chip rows to the extent they are filters                                                                                                          | §11.6: "reconcile first"; the chip rows are claimed by §JH-1/rank 4 as _controls_, not as a filter model |
| Notebook blocks and their chrome: `block-editor.tsx`, `block-preview.tsx`, `pipeline-output-block-*.tsx`, `notebook-sheet-block.tsx`, the `procedure_step` and file blocks                                                                                              | Owner decision; Part A owns them. Each finding above names which of its sites this excludes              |
| Empty states — the per-screen ad-hoc empty hints (`record/inspector-sections.tsx:336` `EmptyHint`, used by `knowledge/record-lineage-section.tsx`, against the silent-null pattern `related-work/related-work-panel.tsx:72` and `knowledge/relationship-panel.tsx:151`) | Owner decision; §11.2's 91-site inventory                                                                |

## 5. Already planned — corroboration, not new findings

Recorded so a later reader can see they were re-measured here, not missed.

| Planned item                                                          | What this pass confirms                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sortable                                                              | The 114 lines of HTML5 drag in `notebook/notebook-block-reorder.tsx` (read; unchanged) plus its 240-line module; the handle remains desktop-only in `notebook-block.tsx`                                                                                                                                                                                                                            |
| Timeline                                                              | Four history renderers (`audit/audit-trail.tsx`, `record-history-timeline.tsx`, `object-history-timeline.tsx`, `experiment-history.tsx` — the last a table), two `OPERATION_ICONS` maps (`object-history-timeline.tsx:49`, `record-history-timeline.tsx:52`) and the same loading skeleton at `audit-trail.tsx:85-90`, `record-history-timeline.tsx:197-205`, `object-history-timeline.tsx:251-255` |
| File Upload                                                           | Three `<input type="file">` sites in scope/adjacent (`import/import-flow.tsx:443`, `notebook/block-editor.tsx:1948` (block), `v3/integrations/ingest-panel.tsx:253`), and no drop handler on any of them                                                                                                                                                                                            |
| Stepper                                                               | Three hand-rolled step renderers (§JH-7) plus the v3 twin `import-flow.tsx` already uses. **The caveat worth knowing before adopting ReUI's:** a v3 Stepper exists, so this row is consolidation, not greenfield                                                                                                                                                                                    |
| Frame                                                                 | The `ChartFrame`/`RepresentationFrame` twin pair, plus the planned Data Grid pairing                                                                                                                                                                                                                                                                                                                |
| Tree, Number Field, Signature Pad, Date/Time pickers, Combobox family | Present where the plan says: `project-navigation-tree.tsx`, `scientific/model-field-input.tsx` (`inputType`/`step` presentation), `notebook/e-sign-dialog.tsx` (261 lines), `scientific/record-picker.tsx` + `v3/record-picker`                                                                                                                                                                     |
| Kbd / Marker / Trace / Icon Tile                                      | `shortcuts-dialog.tsx:64` composes the v3 `Kbd`; `Icon`-tile duplication is §JH-6                                                                                                                                                                                                                                                                                                                   |

## 6. The two questions, answered with counts

**How many hand-rolled avatar/initials implementations exist, and do they use the
v3 Avatar?** Six render sites in four files, three different initials
algorithms, two hand-rolled stacks (§1 rank 1). **One of the four files uses the
v3 Avatar** (`collaboration/presence-avatars.tsx:85`) and even it derives initials
locally (`:32-36`). The other three — `record/record-header.tsx` (which defines a
component _named_ `Avatar` that shadows the v3 one), `record/inspector-sections.tsx`
and `comments/comment-thread.tsx` — do not. The visible consequence is that one
person's initials differ per surface.

**How many hand-rolled list-item/card chromes duplicate what one product
component should own?** ≈30 row renderers across 21 files, in six families
(§JH-1), including two competing implementations of the same entity row
(`RecordLink`:92 lines, `LinkedRecordList`:47). `RecordLink`'s five honest
unavailable states are the capability the simpler twin cannot express, which is
why the duplication is drift rather than a deliberate split.

## 7. Method and limits

- **What was read:** every non-test file in the 23 named directories, in full
  where under ~600 lines and by structure plus targeted reads above that; plus
  the v3 kit's inventory, the legacy kit's inventory, the adoption guard and its
  allowlist, all 77 stories, and `plans/notebook-editor-and-reui.html` §4.4–4.5
  and §11.2–11.6 and ADR-0055.
- **What was counted, not estimated:** row renderers, avatar sites, spinners,
  `<pre>` sites, `aria-expanded` and `aria-pressed` sites, file-type resolvers,
  legacy-token files, story coverage. Counts are from the tree at the commit
  above and will drift; re-measure at the change, as §11.8 warns.
- **ReUI facts** are from the registry at the pinned `base-nova` path
  (`reui.io/r/base-nova/<name>.json`) and the component docs pages read on
  2026-10-16. The registry also settles which catalogue names are **not** ReUI
  items (stock shadcn: `avatar`, `spinner`, `item`, `accordion`, `collapsible`,
  `toggle-group`, `progress`, `pagination`, `resizable`, `bubble`, `message`,
  `questionnaire`, `attachment`, `chart`, `table`), which matters because four of
  this document's candidates are stock items and therefore have no ReUI install
  to read.
- **Nothing was built, typechecked or run.** No component was installed, no
  token was changed, no test was executed. Every statement about behaviour is a
  source read; every statement about a missing behaviour is the absence of that
  behaviour in the source.
- **Not verified here:** whether a candidate meets §4.4's checklist (that needs
  the A/B harness at `/component-compare`), and whether a story passes — the plan
  records that Storybook is absent from `pnpm validate` and CI, so "a story
  stands in" is documentation until that changes.
- **Instruments not consulted:** no ReUI MCP server call was needed for the
  names used here; the registry answered directly.
