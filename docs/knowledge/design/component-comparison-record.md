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

| #   | Component (generic UI job)                                                                        | What we use now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | What ReUI offers                                                                                                                                                                                                                                                                                                                                                                                           | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                           | Measured    |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard                                           | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                                                                                                                                                                                           | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                                                                                                                                 | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                                                                                                                                                                                        | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                                                                                                                                   | 16 Oct 2026 |
| 2   | Paging a list — move between pages, and say which rows you are on                                 | Four byte-identical 26-line pager blocks, one per project tab: `routes/projects/$projectId/{experiments,datasets,samples,files}.tsx` (the arithmetic was already shared; the markup was copied)                                                                                                                                                                                                                                                                                                                             | `@reui/pagination` **is not a registry item** — the pinned base-nova registry returns `404 {"error":"Registry item not found","message":"pagination is part of shadcn/ui, not a ReUI item."}`. The nearest item is the stock shadcn `Pagination*` the repository already has in the legacy kit                                                                                                             | Ours (`src/components/v3/ui/pager.tsx`, the survivor): all 6 applicable items pass, including keyboard paging (Tab to "Next", Enter moves the page and "Previous" turns live). Theirs (`src/components/ui/pagination.tsx`, restyled): all 6 pass too — its numbered links are keyboard-reachable and it pages. The decision is not carried by the checklist: see "What is materially worse" in the detail section                                                                                                                                                                                                                         | **Adopt the in-house `Pager`; the four copies are deleted.** Decline the stock `Pagination*` item (row 18) and record that `@reui/pagination` does not exist                                                                                                                                                                                                                                                                       | 16 Oct 2026 |
| 3   | Stock shadcn `Pagination*` (the only pagination on the index)                                     | Not used anywhere in the app: `src/components/ui/pagination.tsx` has a story and **zero** call sites (it is already half-migrated — it imports `buttonVariants` from the v3 kit)                                                                                                                                                                                                                                                                                                                                            | Nothing: this is the stock shadcn item reached by bare name, not a ReUI item (`@reui/pagination` 404s, row 17)                                                                                                                                                                                                                                                                                             | Checklist passes (see row 17), so this decision is not about the checklist. It is about the model: `PaginationLink` renders an `<a href>`, so paging would leave the router and full-reload the screen; it has no range or count (the design's footer is a count line, "11 of 17 files"); and it is numbered pages where the screens are 25-row windows                                                                                                                                                                                                                                                                                   | **Decline.** ADR-0055 decision 1: the legacy kit is not extended, and this change adds no new legacy import. The anchor model and the missing range label are the named defects                                                                                                                                                                                                                                                    | 16 Oct 2026 |
| 4   | Growing-window list control — read the next page of a list                                        | Six hand-rolled controls with five labels between them and no `nav` landmark: `routes/search.tsx`, `routes/experiments.tsx`, `routes/datasets/$datasetId/{rows,compare}.tsx`, `components/v3/integrations/enterprise-source-panel.tsx`, and the audit log's tail, which had **no control at all** in its idle state                                                                                                                                                                                                         | No item: `@reui/load-more` answers `404 {"error":"Registry item not found"}` and ReUI's index has no load-more component. The job is a button and a count                                                                                                                                                                                                                                                  | Ours (`src/components/v3/ui/load-more.tsx`): all 6 applicable items pass; one label, one count format, a landmark, and a keyboard path the audit tail did not have. Theirs (the deleted spellings, kept in the pair): passes 5 of 6 — the audit tail's 5000-row case leaves older entries reachable only by scrolling                                                                                                                                                                                                                                                                                                                     | **Adopt the in-house `LoadMore`; the six controls are deleted.** No registry candidate exists to compare against. Recorded as a consolidation, not a ReUI adoption                                                                                                                                                                                                                                                                 | 16 Oct 2026 |
| 5   | List screen header — title, count, actions, views                                                 | `ListHeader` (`src/components/v3/inventory/list.tsx`) is composed by **eight** registry screens. Two more composed the identical band by hand, character for character: `routes/experiments.tsx:228-252` and `routes/inbox.tsx:406-462`                                                                                                                                                                                                                                                                                     | Nothing: `ListHeader` is in-house and ReUI has no list-header item                                                                                                                                                                                                                                                                                                                                         | Ours (`ListHeader`, with one new `subtitle` prop): all 6 pass. Theirs (the two hand-rolls): 5 of 6 — the inbox header has no count slot, so it wraps its title and subtitle in one row and puts the sentence beside the `<h1>`. Both wrap rather than clip at 390 (the 408px action measurement that produced the hand-rolled wrap is now the header's own rule)                                                                                                                                                                                                                                                                          | **Adopt the migration.** The band, the wrap rule and the count format are the shared header's; neither screen is a special case once `ListHeader` can carry a subtitle                                                                                                                                                                                                                                                             | 16 Oct 2026 |
| 6   | Page location trail — say where the page is                                                       | The trail was markup each of **24 files** composed and passed as `crumbs`: 12 of them hand-spelled the `/` separator, none produced `ol`/`li`, and none marked the crumb you are on (`help/records.tsx` was the one place that did). The two help routes hand-rolled their own nav                                                                                                                                                                                                                                          | Nothing: ReUI's index has no breadcrumb; the stock shadcn `Breadcrumb*` is the legacy kit's (`src/components/ui/breadcrumb.tsx`, zero call sites)                                                                                                                                                                                                                                                          | Ours (`src/components/v3/ui/breadcrumb.tsx`, rendered by `PageHeader trail`): all 6 pass — `ol`/`li`, a separator `aria-hidden`, `aria-current="page"` on the last unlinked crumb. Theirs (the node 24 files passed): 5 of 6 — jsdom axe flags `landmark-unique` when two hand-spelled trails sit in one column, and the separator is a text node in the accessibility tree                                                                                                                                                                                                                                                               | **Adopt the in-house `Breadcrumb`; the `crumbs` node slot is deleted** (24 files migrated, no parallel implementation). The stock shadcn item is not taken, under the standing ruling in row 18                                                                                                                                                                                                                                    | 16 Oct 2026 |
| 7   | Settle-delay search box — hold typing still, then report                                          | Three copies of one debounce: `components/v3/inventory/list.tsx` (200 ms), `routes/datasets/$datasetId/rows.tsx` (a **verbatim copy including its comment**), `routes/settings/audit.tsx` (250 ms, a different shape)                                                                                                                                                                                                                                                                                                       | Nothing: a hook, not a component — no registry item and nothing to render                                                                                                                                                                                                                                                                                                                                  | Both sides are the same input, so there is nothing for a column to compare: the difference is where the 25 lines live. Evidence is the hook's own suite instead (`src/lib/settled-value.test.ts`, 5 cases: a burst reports once, no report on mount, an external change is adopted and the queued keystroke dropped, the echo of its own report is ignored, the settled value is held with no callback)                                                                                                                                                                                                                                   | **Adopt the shared hook; the three copies are deleted.** No pair is registered, because a pair whose two columns render identical controls measures nothing                                                                                                                                                                                                                                                                        | 16 Oct 2026 |
| 8   | Registry table — a list of records with sorting, row selection and a pinned first column          | Every registry list screen hand-rolled the same `v3/ui/table` body inside the shared chrome in `src/components/v3/inventory/list.tsx` (`src/routes/samples.tsx` and its siblings): sticky first column via `stickyHead`/`stickyCell`, click-only row selection, no keyboard path, no virtualisation. Nine screens shipped this body — protocols, datasets, experiments, samples, materials, instruments, models, templates, pipelines — and each has deleted its copy                                                       | `@reui/data-grid` (base-nova pin), placed under `src/components/reui/`: virtualised rows, row and column pinning available, and a row that is itself the keyboard control for selection. The registry's `@reui/frame` is **not** used on the screen — see cost C6                                                                                                                                          | Ours: 8 of the 9 applicable items pass; **`keyboard-select` fails** — no row selection is reachable without a pointer (see the detail table). Theirs: all 9 pass. 5 items are not applicable — this pair has no reorder, filter or resize control                                                                                                                                                                                                                                                                                                                                                                                         | **Adopt** on every registry list screen: the bespoke bodies are deleted in the same change and each screen keeps its own footer and flush layout. A screen whose rows are links rather than a selection (`experiments`) takes the grid without the selection column                                                                                                                                                                | 16 Oct 2026 |
| 9   | Working indicator — show that work is in progress                                                 | Six spellings of `animate-spin` over four glyphs in five files: `live/connection-status.tsx:43,54` (`Loader2`, `RefreshCw`), `notebook/save-status.tsx:43,53` (our `clock`, our `move`), `offline/offline-banner.tsx:76` (`RefreshCw`), `dataset-schema/schema-badge.tsx:46` (`Loader2`), `routes/analysis/new.tsx:1191` (our `clock`)                                                                                                                                                                                      | **No admissible registry item.** `spinner` is stock shadcn, not ReUI: `/r/base-nova/spinner.json` 404s, and §11.3.1 records that a bare-name install resolves into the legacy Radix kit decision 1 refuses to extend. Candidate is in-house: `src/components/v3/ui/spinner.tsx`                                                                                                                            | Ours: Tab reaches no control in either column — the indicators are decorative and the states are named in text. Theirs: the same, and it adds the reduced-motion decision (`motion-reduce:animate-none`) that nothing in ours owned. Chromium axe with colour contrast **on**: 0 violations, both columns, both themes. jsdom axe: 0 violations, 6 fixtures and 3 states per side                                                                                                                                                                                                                                                         | **Adopt — the in-house component**, and delete the legacy file with it (zero product call sites; `/foundations` does not render it)                                                                                                                                                                                                                                                                                                | 16 Oct 2026 |
| 10  | Horizontal quantity bar — show one value against its maximum                                      | Four renderings: a correct `progressbar` (`v3/samples/sample-hold-meter.tsx:179-196`), two `role="img"` bars whose only accessible content is a sentence (`v3/home/home-quiet.tsx:281-300`, `v3/samples/sample-usage.tsx:58-76`), and a bare `{n}%` text (`routes/instruments/$instrumentId.tsx:533-535`), plus `routes/settings/usage.tsx:438-454`                                                                                                                                                                         | **No admissible registry item.** `progress` is stock shadcn (`/r/base-nova/progress.json` 404s) with the same bare-name trap. Candidate is in-house on Base UI: `src/components/v3/ui/progress.tsx`                                                                                                                                                                                                        | Ours: the shipped bars render correctly on every fixture — but only because each caller computed its own percentage by hand (see the detail section). Theirs: **the harness caught a critical `aria-valid-attr-value` in the candidate itself** on the high-precision fixture — `aria-valuenow="1.6e-19"` is not a valid ARIA number — fixed, and both halves pinned; the same rule also fires on an exponential `aria-valuemax`, which is recorded as a limit below. After the fix: 0 violations everywhere, both engines, both themes; the two `role="img"` renderings gain a real `progressbar` contract and the bare text gains a bar | **Adopt — the in-house component**, one per shape (single value and stacked ledger); the caller's arithmetic is no longer the contract                                                                                                                                                                                                                                                                                             | 16 Oct 2026 |
| 11  | Disclosure — reveal detail behind a control                                                       | Four in-scope `<details>` (`v3/projects/projects-page.tsx:1385`, `v3/integrations/run-history.tsx:201`, `v3/settings/parser-settings.tsx:238`, `settings/signatures.tsx:578,660`) and one expander that manages its own state with **no `aria-expanded` at all** (`v3/integrations/run-history.tsx:150-157`)                                                                                                                                                                                                                | **No admissible registry item.** `collapsible` and `accordion` are stock shadcn (`/r/base-nova/collapsible.json`, `/accordion.json` 404). Candidate is in-house on Base UI Collapsible: `src/components/v3/ui/collapsible.tsx`                                                                                                                                                                             | Measured in Chromium: ours has 7 `<summary>` elements, all focusable, **0 carrying `aria-expanded`**, plus 1 expander button that also carries none; theirs has 8 triggers, each with `aria-expanded` and `aria-controls`. Chromium axe: 0 violations both columns, both themes. jsdom axe: 0 violations, 6 fixtures and 3 states per side                                                                                                                                                                                                                                                                                                | **Adopt — the in-house component.** The expander is the one place with a real defect and it gains a stated state; `<details>` converts for consistency, not for a missing behaviour                                                                                                                                                                                                                                                | 16 Oct 2026 |
| 12  | Code and raw-payload block — show text as text                                                    | Five renderings: the pipeline `CodeBlock` (the one deliberate one) and four ad-hoc `<pre>`s — `v3/pipelines/agents/agent-surface.tsx:117-126`, `v3/integrations/run-history.tsx:201-208`, `v3/settings/parser-settings.tsx:242-246`, `review/review-check-results.tsx:124`, `audit/object-history-timeline.tsx:130-151`. None of the four is copyable; three have no label, bound or empty state                                                                                                                            | `@reui/code-block` exists and was **measured, then declined** — see the detail section. 3,402 lines of copy-and-own source across two files, and `shiki@4`: **13.1 MB installed across 1,062 files** (9.0 MB of it language grammars), for highlighting, streaming, diffs, folding and per-line interaction this job does not have. Its own registry dependencies pull the legacy Radix `button` (§11.3.1) | Ours: **Chromium axe reports `scrollable-region-focusable` (serious)** — three of the four ad-hoc `<pre>`s scroll without a keyboard path; Tab reaches 1 control in the column. Theirs: 0 violations in both engines and both themes, and Tab reaches a `Copy` control plus a focusable payload region on every row                                                                                                                                                                                                                                                                                                                       | **Decline the install; adopt the in-house `CodeBlock`** (promoted from `pipeline-code.tsx`), with one `CopyButton`/`copyText` for the single-value copy sites                                                                                                                                                                                                                                                                      | 16 Oct 2026 |
| 13  | Avatar and initials — one person, one reading                                                     | Six render sites in four files, three initials algorithms, two hand-rolled stacks and one unused prop: `record/record-header.tsx` (a local component _named_ `Avatar`, exported as `RecordHeaderAvatar`), `record/inspector-sections.tsx` (`ActivityFeed`, `CommentList`, `ContributorAvatars`), `comments/comment-thread.tsx` (`authorInitials`), `collaboration/presence-avatars.tsx` (`initialsFor`; the only site composing the v3 Avatar); `audit/audit-trail.tsx` carried an `initials?` prop that was never rendered | **No item.** `reui.io/r/base-nova/avatar.json` 404s, and the catalogue lists `avatar` as a stock shadcn component installed by bare name: a Radix `Avatar`/`AvatarImage`/`AvatarFallback` with a fixed `size-8` box, no derivation, no size scale, no tones and no group                                                                                                                                   | Ours: 8 of 8 applicable items pass (10 are not applicable — no reorder, sort, filter, select, resize or pagination control). Theirs: **not run as a like-for-like candidate** — an install would not have replaced the hand-rolled spellings, because the candidate has no derivation to converge on; see the detail table for what was measured instead                                                                                                                                                                                                                                                                                  | **Decline the install; componentise onto the v3 `Avatar`.** Six sites migrated onto one `initialsFromName` rule and one `AvatarStack`; the local `Avatar`, its export and the dead prop are deleted                                                                                                                                                                                                                                | 16 Oct 2026 |
| 14  | Notice and banner chrome — inline message and page strip                                          | Six hand-rolled alert/banner chromes in five files: `comments/comment-panel.tsx` (load failure and action failure), `audit/record-history-timeline.tsx` (error + retry), `audit/object-history-timeline.tsx` (error), `offline/offline-banner.tsx` (a page strip), `notebook/conflict-banner.tsx` (the block conflict) — all on the app-3 bridge vocabulary (`border-destructive`, `border-danger/40`, `bg-destructive/10`) while sixteen files already compose the v3 pair                                                 | `@reui/alert` (base-nova pin, ReUI-native, one file, `cva` + `cn`): a grid box with `has-[>svg]` icon column, `AlertTitle`, `AlertDescription`, `AlertAction`, and variants `default / destructive / info / success / warning / invert`                                                                                                                                                                    | Ours: 8 of 8 applicable items pass (10 not applicable). Theirs: the same 7 universal items pass **after two behavioural changes** — the page-strip anatomy has to be built outside the item, and its `role="alert"` on every variant is a behaviour our tone-derived `role` exists to avoid. Neither change is available from the item's own API                                                                                                                                                                                                                                                                                          | **Decline.** The v3 pair already owns the job and sixteen files compose it; a second alert vocabulary is the second design language ADR-0055 decision 1 exists to prevent. The six hand-rolls move onto the v3 pair instead                                                                                                                                                                                                        | 16 Oct 2026 |
| 15  | File type — resolve a name or MIME type to an icon                                                | Three icon resolvers and a duplicate size formatter: `record/inspector-sections.tsx` (`fileTypeIcon`, MIME-first, four Lucide-family glyphs), `notebook/block-preview.tsx` (`fileIconForType`/`FileIcon`/`FileMetaLine`), `notebook/block-editor.tsx` (`fileGlyphFor`); `formatBytes` existed twice (`src/lib/file-attach.ts` as an alias, and again locally in `src/routes/records/$recordId/notebook.tsx`)                                                                                                                | `@reui/file-type` (base-nova pin, ReUI-native, one file, `class-variance-authority` + `cn`): 171 extensions across 13 families, `getFileType` / `getFileTypeCategory`, variants `outline / solid / light / mono`, sizes down to an 18px row                                                                                                                                                                | Ours (before): 7 of 8 applicable items pass — the icon carries no type in words, so the type's accessible name is absent (`aria-hidden`), and a generic stored MIME type resolves an `.xlsx` name to the neutral glyph. Theirs (after): 8 of 8 pass — every icon is `role="img"` with a named type, name-first resolution replaces the MIME-first fall-through, and long names still truncate in the row                                                                                                                                                                                                                                  | **Adopt, scoped.** `src/components/reui/file-type.tsx`, restyled to app tokens, replaces the inspector's resolver; the two block-resident resolvers stay (Part A owns notebook blocks) and are recorded as an explicit exclusion. `formatBytes` is one helper again                                                                                                                                                                | 16 Oct 2026 |
| 16  | Tab family — one of N views, in place                                                             | `src/components/v3/ui/tabs.tsx` in `mode="state"`: Base UI tablist — roving focus, ArrowLeft/ArrowRight, Home/End, `aria-selected`, activation on focus. The reconciliation that produced it deleted five other implementations                                                                                                                                                                                                                                                                                             | **Nothing to compare against:** the pinned registry answers 404 for `tabs` and says it is a shadcn item. Placed from shadcn/ui (new-york) at `src/components/reui/tabs.tsx`, primitive import re-pointed to the unified `radix-ui` package                                                                                                                                                                 | Ours: 9 of the 9 applicable items pass. Theirs: the same 9 pass, with one structural difference and one cost — the tab stop sits on the `role="tablist"` container (`tabindex="0"`, inline `outline: none`) rather than on the tab, and the item as published needs `@radix-ui/react-tabs`. 10 items not applicable (no reorder, sort, filter, select, resize or pagination control)                                                                                                                                                                                                                                                      | **Decline — keep ours.** Both sides pass the same keyboard contract, so no named behaviour is missing; the item covers only the in-page half of the job (most of the strips this change migrated are URL tabs, which the item has no mode for) and would add a second primitive library beside Base UI                                                                                                                             | 16 Oct 2026 |
| 17  | Pressed-state chips — filter by several kinds at once                                             | The shipped multi-select chip row: `role="group"`, one `aria-pressed` button per kind, each chip its own tab stop (`revision-diff-review.tsx:493-534` is the reference shape)                                                                                                                                                                                                                                                                                                                                               | **Nothing to compare against:** the pinned registry answers 404 for `toggle-group` and says it is a shadcn item. Placed from shadcn/ui (new-york) at `src/components/reui/toggle-group.tsx` + `toggle.tsx`                                                                                                                                                                                                 | Ours: 8 of the 8 applicable items pass. Theirs: the same 8 pass, but it announces `role="toolbar"` where ours announces `role="group"`, puts the single tab stop on that container (`tabindex="0"`, inline `outline: none`) and forwards focus to the first chip, and as published needs `@radix-ui/react-toggle-group`. 11 items not applicable, including `keyboard-navigate`: a multi-select group has no roving focus in its pattern                                                                                                                                                                                                  | **Decline — keep ours.** No missing behaviour to buy, a role change we would have to reason about, and two more dependencies                                                                                                                                                                                                                                                                                                       | 16 Oct 2026 |
| 18  | Option picker — choose one option from a grouped list                                             | v3 `Select` (`src/components/v3/ui/select.tsx`): the **native** `<select>`, styled like `Input`. This change hoists it out of `projects/select.tsx`, makes it the single definition (a second one in `inventory/list.tsx` is deleted), and migrates 22 route sites and 3 further v3 sites onto it                                                                                                                                                                                                                           | **Stock shadcn `native-select`**, placed by hand at `src/components/reui/native-select.tsx`. **Not a ReUI item**: the pinned ReUI registry serves neither `native-select` nor `select`, so there is no base-nova build of this job to install                                                                                                                                                              | Ours: 8 of the 10 applicable items pass, 1 is a measured gap (density at 390: the 44px clause) and 1 is not measurable in either engine (the platform popup's pointer path; see the detail table). Theirs: the same 8, the same gap, the same unmeasurable item. 10 items are not applicable — this pair has no reorder, sort, filter, row-select, resize or pagination control                                                                                                                                                                                                                                                           | **Keep ours; no adoption.** The two are the same platform control, so there is no measured decline to weigh: the candidate's own additions (option/optgroup wrappers, `has-[select:disabled]:opacity-50`, a lucide chevron, 36/32px sizes) change nothing behaviourally, and our contract is the better fit — two sizes that grow on mobile, `invalid`, `Field`-awareness, the kit's tokens, no new dependency, and one definition | 16 Oct 2026 |
| 19  | Credential panel — one panel for both Settings credential screens (in-house)                      | Two identical components: `settings-api-tokens.tsx` (314 lines) and `settings-service-credentials.tsx` (313), differing only in the function name, the wire types and the copy; the scan's item 2 measured the structural diff as one line                                                                                                                                                                                                                                                                                  | **No registry counterpart.** No ReUI or stock shadcn item covers a credential panel (scopes, prefix, reveal-once secret, revoke/rotate); adopting a generic table or dialog for it would replace no duplication and lose the domain contract                                                                                                                                                               | Not applicable — the harness checklist compares two implementations of one generic UI job, and this consolidation has no candidate column. Evidence instead: the two panels' tests merged and run once per copy preset (12 cases, every headline string asserted literally), and a pixel comparison of the rendered `/settings/api` before and after (`magick compare -metric AE` = **0** at both scroll positions)                                                                                                                                                                                                                       | **Consolidate.** One panel + a `CredentialPanelCopy` prop + the route's two presets; both files and both test files deleted                                                                                                                                                                                                                                                                                                        | 16 Oct 2026 |
| 20  | Chip / toggle pill — a removable value, a pressed filter or scope, a phone nav section (in-house) | Five renderers, three class strings: `v3/projects/chip.tsx` (removable, 2 consumers), the record picker's inline `Chip`, the search palette's inline pill (a copy of the picker's string), `routes/settings.tsx` phone nav pills, `routes/client-portal.tsx` pill row                                                                                                                                                                                                                                                       | **No registry item.** ReUI's `Toggle Group` and `Button Group` are groups of controls, not a chip — the scan's candidate 8 says not to adopt them for this job, and ADR-0055 decision 4's "serves a generic UI job" bar is not met by a group primitive standing in for one pill                                                                                                                           | Not applicable — no candidate column. Evidence instead: the `UI/Chip` story (three variants), the five migrated call sites typechecked and rendered, the filter chip and both nav rails inspected in the app, and the phone palette's pill measured in the browser at 390px (34×36 CSS px, 36px after the touch treatment below)                                                                                                                                                                                                                                                                                                          | **Consolidate into a new forward-kit `Chip`** (`src/components/v3/ui/chip.tsx`, Base UI `useRender`), with `remove` / `toggle` / `nav` variants; `v3/projects/chip.tsx` and the two inline renderings deleted. `badge.tsx` and `choice.tsx` were checked first and are different jobs (see the detail section)                                                                                                                     | 16 Oct 2026 |
| 21  | Command and listbox — one grouped, keyboard-driven option list (in-house reconciliation)          | Three implementations: the forward kit's `v3/ui/command.tsx` (465 lines, 4 consumers), the search palette's own combobox + listbox inside the screen (664 lines, ~200 of them list and keyboard logic), and the legacy cmdk palette (`components/ui/command.tsx`, 158, plus `searchable-select.tsx`, 142)                                                                                                                                                                                                                   | The stock shadcn `Command` **is** the cmdk item — i.e. what the legacy kit already was. Swapping the forward kit's contract for it re-imports the dependency this change removes and re-opens §11.3.1 (a plain install re-introduces the deprecated kit); a like-for-like replacement would be its own comparison row and this row's conclusion is that it is not worth one                                | Not applicable — no candidate column. Evidence instead: the palette's 13 tests unchanged and green through the migration (⌘↵ new tab, `aria-controls` only naming a mounted listbox, relevance-ordered groups, result labels, focus return), plus in-situ Chromium checks at 1440 and 390 (active option and its ↵ hint, `aria-activedescendant` resolving, ⌘↵ opening the record in a tab while the palette stays open, the no-match state dropping the listbox attributes)                                                                                                                                                              | **Reconcile into the forward kit's Command** and delete the rest: the palette's own list, keyboard handling and combobox wiring are gone (−200/+144), the legacy palette and its unreferenced `searchable-select` are deleted, `extension-slots`' group composes the v3 parts, and `cmdk` leaves the dependency list. The kit gained the five props the palette needed (detail below)                                              | 16 Oct 2026 |

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

## Row 2 — Paging a list (`paging-a-list`)

### What we use now

Four byte-identical 26-line pager blocks, one per project tab —
`routes/projects/$projectId/{experiments,datasets,samples,files}.tsx` — each
inside the `footer` prop of `ProjectList`. The arithmetic was already shared
(`projectPageSummary`), the markup was copied: a `<span>` of "Showing {start}–{end}
of {total} {noun}", then `Previous` and `Next` as `text-link` router links that
**vanish** at the ends, so at page 1 the row moves and a reader cannot tell a
first page from a missing control. There was no `nav`, no landmark and no
`aria-label="Pagination"` anywhere in the tree.

The survivor is `src/components/v3/ui/pager.tsx`: a `nav[aria-label="Pagination"]`
carrying the same range label, with both ends always rendered and inert
(`disabled` on the router `Link`, which drops the `href` and sets
`aria-disabled="true"`; the dimmed style is the pager's own class, so a screen
that renders it outside the router still shows which end it is at). The
arithmetic stays the caller's — the page size, the parse and the range are
`project-lists.ts`'s policy.

### What ReUI offers

Nothing. `@reui/pagination` is not a registry item: the pinned base-nova
registry answers

```
GET https://reui.io/r/base-nova/pagination.json
404 {"error":"Registry item not found","message":"pagination is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add pagination"}
```

and the shadcn CLI refuses `@reui/pagination` the same way. The nearest item is
the stock shadcn `Pagination*`, which the repository already has in the legacy
kit — that is row 18.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The applicable
items are the 6 whose state or `pagination` control this pair has; the other 12
need reorder, sort, filter, select or resize controls and are recorded as not
applicable rather than skipped.

| Check                                                     | Ours                                                                                                                                | Theirs (stock `Pagination*`, restyled)              | How it was measured                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the range label, then `Previous`, then `Next`                                                                                | Pass — `Previous`, the numbered links, `Next`       | Browser, both columns                                       |
| Move to the next and previous page without a pointer      | Pass — Tab to `Next`, Enter moves to "Showing 26–50 of 5000 rows"; at page 1 `Previous` is not a tab stop and reads `aria-disabled` | Pass — Tab to a numbered link, Enter moves the page | Browser (bulk fixture), both columns                        |
| Empty (0 rows), loading, error, permission-restricted     | Pass (harness-owned states; the pager renders nothing for a 0-row fixture)                                                          | Pass                                                | jsdom axe, both columns, and the browser run                |
| Dark theme                                                | Pass — token-bound colours only                                                                                                     | Pass                                                | jsdom axe (contrast off); Chromium axe for the default pair |
| Density and overflow at 1440x900 and 390x844              | Pass — the row wraps; no horizontal overflow                                                                                        | Pass                                                | Browser, both columns                                       |

Reorder, sort, filter, select and resize: not applicable to this pair (12 items).

**What the checklist does not settle.** Both sides pass, so the decision is not
carried by it. What separates them is in row 18: the stock item's `<a href>` model
leaves the router, it has no range or count, and it is the legacy kit.

### Automated evidence

| Evidence                                                                 | Result                                   | Command                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides             | 18 cases, zero violations (contrast off) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| Harness contracts (one scenario object to both columns, frozen fixtures) | pass                                     | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`      |
| The route the copies lived on: range label, and `Previous` on page 1     | pass                                     | `pnpm exec vitest run src/routes/projects/$projectId/experiments.test.tsx`              |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`, or the harness page itself):
`.amp/in/artifacts/harness-paging-a-list-{ours,theirs}.png` from the run that
produced this row — the 5,000-row fixture, where ours reads "Showing 1–25 of 5000
rows · Previous · Next" and theirs shows "Previous · 1 · 2 · 200 · Next".

### Conditions an adoption would carry

None for ours: it replaces the four copies in the same change. A future adoption
of a registry pager would have to be a router-link pager (TanStack `Link`, not
`<a href>`), carry a range label, and be restyled to tokens — that is the bar
this row declined the stock item against.

### Limits of this row

- Desktop Chromium and jsdom only; no Firefox, WebKit or real device.
- The pair fixes the page size at 25 rows and renders the pager alone; the
  screens' footer bars (project tabs) are not in either column.
- The stock column is the repository's existing copy of the item, restyled; a
  fresh `shadcn add pagination` would be a different file.

## Row 3 — Stock shadcn `Pagination*` (declined)

### What we use now

Nothing. `src/components/ui/pagination.tsx` has a story
(`src/stories/Pagination.stories.tsx`) and **zero** call sites in the app, and it
is already half-migrated: it imports `buttonVariants` from the v3 kit. It is the
legacy kit's copy of the stock shadcn item.

### What it offers, and what is materially worse

- **It leaves the router.** `PaginationLink`, `PaginationPrevious` and
  `PaginationNext` all render a plain `<a href>`. A pager here navigates the
  same route at another `?page=`; an anchor full-reloads the screen and drops
  the client router.
- **No range and no count.** The design's footer line is a count — "11 of 17
  files · instrument exports are parsed into datasets" (ProjectFiles canvas) —
  and the four hand-rolled blocks printed "Showing 1–25 of 40 experiments". This
  item prints numbered pages and nothing else.
- **The wrong model.** It is built for numbered pages; these lists are 25-row
  windows on server-paged reads (and 50-row cursor pages elsewhere).
- **Decision 1.** It is the legacy kit, which ADR-0055 decision 1 says is not
  extended. Adopting it would also add the first legacy import to a v3 screen
  and trip `src/components/v3/ui/component-adoption.test.ts`.

### Checklist result

It passes the same 6 items as row 17 (it is keyboard-reachable and it pages), and
that is recorded rather than argued with: the decline is on the four points
above, not on the checklist.

### Decision and reason

**Decline.** `@reui/pagination` does not exist (row 17's 404 body), so there is no
ReUI candidate; the stock shadcn item fails ADR-0055 decision 1 and, on its own
merits, cannot drive this router or print this range. The in-house `Pager` keeps
the link model the screens already had, adds the landmark and the inert ends,
and deletes four copies.

**This ruling is the standing one for a stock shadcn item in the legacy kit**
(`src/components/ui/**`): leaving the router, printing no range or count, and
living in the kit decision 1 does not extend are each sufficient, and the same
three apply to the stock `Breadcrumb*` item at row 21. It is recorded once here
rather than re-argued per component.

### Limits of this row

- The item was compared as the repository's copy, restyled to tokens. Its
  upstream shadcn equivalent may differ; the item that would matter is the one
  the CLI installs, and that is the same file family.
- No browser run for this row's appearance beyond the harness screenshots.

## Row 4 — Growing-window list control (`load-more-control`)

### What we use now

Six hand-rolled controls with five labels between them — `"Loading…"`,
`"Loading more…"`, `"Load more"`, `"Load more (N left)"`, `"Scroll for older
entries"` — and no `nav` landmark on any of them:

- `routes/search.tsx` — a plain button, `Loading…` while fetching;
- `routes/experiments.tsx` — a small quiet button in the list's footer bar;
- `routes/datasets/$datasetId/rows.tsx` — count, note and a `Load more (N left)`
  button in the grid's foot;
- `routes/datasets/$datasetId/compare.tsx` — `Load more (N left)`;
- `components/v3/integrations/enterprise-source-panel.tsx` — a continuation
  token beside "List objects";
- `routes/settings/audit.tsx` — a cursor tail inside the table body whose **idle
  state offered no control at all**: older entries were reachable by scrolling
  and by no keyboard path.

The survivor is `src/components/v3/ui/load-more.tsx`: one `nav` with the screen's
own label, an optional "Showing {loaded} of {total} {noun}" line for the screens
that do not print the count themselves, one button ("Load more" / "Loading…"), a
retry for a failed read, and an optional screen-authored end line.

### What ReUI offers

No item. `GET https://reui.io/r/base-nova/load-more.json` answers
`404 {"error":"Registry item not found"}` and ReUI's index has no load-more
component; the stock shadcn catalogue has none either. There is nothing to
adopt and nothing to compare against, so this row records a consolidation.

### Checklist result

| Check                                                     | Ours                                                        | Theirs (the deleted spellings, kept in the pair)                                       | How it was measured      |
| --------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass                                                        | Pass, except the audit tail's idle state                                               | jsdom axe, both columns  |
| Move forward through the list without a pointer           | Pass — Tab to the control, Enter reads the next page        | Pass in the four button spellings; **fail** on the audit tail (text, not a control)    | Browser, both columns    |
| Empty (0 rows), loading, error, permission-restricted     | Pass — the control disappears when there is nothing to read | Pass, except that the audit tail still says "Scroll for older entries" with no control | jsdom axe, both columns  |
| Dark theme                                                | Pass — token-bound colours only                             | Pass                                                                                   | jsdom axe (contrast off) |
| Density and overflow at 1440x900 and 390x844              | Pass                                                        | Pass                                                                                   | Browser, both columns    |

The count trio is on this pair, so its count line is compared: ours reads
"Showing 4 of 12 changes" once, where the deleted spellings printed the count in
the button and again in a footer bar.

### Automated evidence

| Evidence                                                             | Result                                   | Command                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| axe, both columns, every fixture and state                           | 18 cases, zero violations (contrast off) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                          |
| Harness contracts                                                    | pass                                     | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                               |
| The three routes that owned a copy: paging, retry and the audit tail | pass                                     | `pnpm exec vitest run src/routes/datasets/$datasetId/{rows,compare}.test.tsx src/routes/settings/audit.test.tsx` |

### Decision and reason

**Adopt.** One control, one label, one count format, one retry, a landmark that
says what is being extended, and a keyboard path the audit tail lacked. Six
call sites and their five labels are deleted in the same change.

### What is still queued

- **`components/v3/datasets/dataset-history-tab.tsx`** — the sixth v3 load-more
  site — delegates its control to `ObjectHistoryTimeline`, which is the shared
  surface the audit-timeline lane has since landed. It is queued for the next
  tranche and should be a small change against that surface: hand it the
  `LoadMore` contract rather than its own button.
- The three peers outside the v3 surfaces (`components/audit/object-history-timeline.tsx`,
  `components/audit/audit-trail.tsx`, `components/sheet/canonical-sheet-workspace.tsx`)
  are the same call sites once that surface is one control.

### Limits of this row

- The audit log's tail is inside a table body (`<TableRow><TableCell>`), so the
  column renders it as a cell and not as the shipped table row; the control is
  the same.
- The connector panel's continuation token is compared without a count, because
  the panel does not know one.
- The label unification was accepted on review: "Load more" with the remaining
  count as the control's own line, rather than a count inside the button.

## Row 5 — List screen header (`list-header`)

### What we use now

`ListHeader` (`src/components/v3/inventory/list.tsx`) is composed by eight
registry screens (samples, materials, protocols, datasets, templates, pipelines,
models, instruments). Two more composed the same band by hand, with class
strings that matched `ListHeader`'s character for character — including the
`-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0` tab rail:

- `routes/experiments.tsx` — `h1`, count, a primary action that had to wrap at
  400 % zoom (QA4-zoom-experiments, the reason for its own `max-md:flex-wrap`),
  and the URL tab strip;
- `routes/inbox.tsx` — `h1`, a muted subtitle, two actions that measured 408px
  at 390 and pushed "Mark all seen" out of the viewport (WCAG 1.4.10), and a
  roving-focus `role="tablist"`.

### What one component's API had to cover

`ListHeader`'s existing `title`/`total`/`actions`/`tabs` plus one thing the
hand-rolls carried that it did not: **a line beside the title**. The inbox's
subtitle could only go in the `<h1>` otherwise, which would have made the
sentence part of the heading's accessible name. The wrap rule the experiments
header had invented is now the header's own (`flex-wrap` on the row, actions
full-width below `md`), and the unknown-count state is the existing
`total?: number` — omit it and no count renders.

### Checklist result

| Check                                                     | Ours (`ListHeader`)                                                 | Theirs (the two hand-rolls)                                            | How it was measured      |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass — actions, then the tab links                                  | Pass — actions, then the tab buttons                                   | jsdom axe, both columns  |
| Empty, loading, error, permission-restricted              | Pass (harness-owned states)                                         | Pass                                                                   | jsdom axe, both columns  |
| Dark theme                                                | Pass — token-bound colours only                                     | Pass                                                                   | jsdom axe (contrast off) |
| Density and overflow at 1440x900 and 390x844              | Pass — the row wraps and the actions take their own line below `md` | Pass — the inbox header wraps; the experiments header wraps below `md` | Browser, both columns    |

No control class applies (`controls: []`), so the sort/filter/select/reorder/
resize/pagination items are all not applicable.

### Automated evidence

| Evidence                                                     | Result                                                   | Command                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns, every fixture and state                   | 18 cases, zero violations (contrast off)                 | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| The two screens the headers were migrated on                 | pass, including the no-longer-hand-rolled wrap assertion | `pnpm exec vitest run src/routes/experiments.test.tsx src/routes/inbox.test.tsx`        |
| The story: registry, no-count, subtitle and tab-strip states | renders                                                  | `src/stories/ListHeader.stories.tsx`                                                    |

### Decision and reason

**Adopt the migration.** The band, the count format and the wrap rule are the
shared header's; the inbox is not a special case once `ListHeader` can carry a
subtitle. The two hand-rolled headers are deleted in the same change, and the
experiments header's QA4 comment moves to the header that now owns the rule.

### Limits of this row

- The column compares the **inbox** header (the harder of the two: subtitle, two
  actions, roving-focus tablist). The experiments header — count and one
  full-width action — is the same band and is covered by the story, not by the
  pair.
- The tab strips are left as they are: reconciling the six tab and segment
  components is its own task, and this pair does not pre-empt it.

## Row 6 — Page location trail (`breadcrumb-trail`)

### What we use now

24 files composed the crumb line and passed it to `PageHeader crumbs`, 57 times
between them. The trail was markup: a `Link`, a `{' '}`, a hand-spelled `/`, and
an identifier wrapped by hand at each site (`<span className="mono">`). Twelve
route files spelled the separator themselves; none produced `ol`/`li`; none
marked the crumb you are on, so the "you are here" half of a breadcrumb was
missing everywhere. The two help routes hand-rolled their own: `help/records.tsx`
had the `ol`/`li` and `aria-current` (the one place in the app that did), and
`help/shortcuts.tsx` had a text separator and no list at all.

The survivor is `src/components/v3/ui/breadcrumb.tsx`: the trail as data
(`{ label, link?, mono? }[]`), rendered by `PageHeader trail` and used directly by
the two help articles, which keep their own header bands (they are full-bleed
document surfaces; the design canvas gives them `md:px-8`, not the header's
`md:px-6`).

### What ReUI offers

Nothing: ReUI's index has no breadcrumb item, and the stock shadcn
`Breadcrumb*` is the legacy kit's (`src/components/ui/breadcrumb.tsx`, zero call
sites) — declined under the same ruling as row 18. The shape the scan suggested
("change `PageHeader` to take a trail") is what this change does.

### Checklist result

| Check                                                     | Ours                                   | Theirs (the node 24 files passed) | How it was measured      |
| --------------------------------------------------------- | -------------------------------------- | --------------------------------- | ------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass — each linked crumb               | Pass — each linked crumb          | jsdom axe, both columns  |
| Empty, loading, error, permission-restricted              | Pass (harness-owned states)            | Pass                              | jsdom axe, both columns  |
| Dark theme                                                | Pass — token-bound colours only        | Pass                              | jsdom axe (contrast off) |
| Density and overflow at 1440x900 and 390x844              | Pass — one line, `truncate` on the nav | Pass                              | Browser, both columns    |

**Structural difference, which is the point of the row:** ours is
`nav > ol > li` with the separator `aria-hidden` and `aria-current="page"` on the
last unlinked crumb; theirs is a `nav` with a run of fragments, the separator as
content, and no current crumb. jsdom axe reports `landmark-unique` on the
hand-spelled column when two of them sit side by side — a property of the pair,
recorded as such, not a defect of the shipped code.

### Automated evidence

| Evidence                                                   | Result                                                                           | Command                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns, every fixture and state                 | 18 cases, zero violations (contrast off)                                         | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| The two help routes that hand-rolled a trail               | pass (their browser specs, `tests/visual/help-*.spec.ts`, assert axe on `#main`) | `pnpm exec vitest run src/routes/help.test.tsx`                                         |
| The story: one crumb, section-and-identifier, three levels | renders                                                                          | `src/stories/BreadcrumbTrail.stories.tsx`                                               |

### Decision and reason

**Adopt the in-house `Breadcrumb` and delete the `crumbs` node slot** — 24 files
migrated in the same change, with no parallel way to pass a trail left behind.
The win is the semantics: list structure, a separator the accessibility tree does
not read, and a marked current crumb, on every screen rather than in one help
article.

### Limits of this row

- The pair compares one trail per column. A single-crumb trail (the loading and
  not-found states) is covered by the story, not by the pair.
- Crumb **content** is unchanged: `crumbs="Home"` on `/analysis` still says
  "Home". This row is about how a trail is rendered, not about what each screen
  claims its location is.

## Row 7 — Settle-delay search box (`useSettledValue`, no pair)

### What we use now

Three copies of one debounce, and the second was a verbatim copy of the first
including its comment:

- `src/components/v3/inventory/list.tsx` (`ListToolbar`, 200 ms) — the rule the
  comments describe: hold what was typed, report a settled value, and adopt a
  value that changed somewhere else (a tab, "Clear search") without clobbering
  pending typing;
- `routes/datasets/$datasetId/rows.tsx` (200 ms) — the same code, character for
  character, with `navigate` in place of `onSearch`;
- `routes/settings/audit.tsx` (250 ms) — a different shape (`useSettledSearch`),
  because a server read does not need the two-nature half.

The survivor is `src/lib/settled-value.ts`: `useSettledValue(value, ms,
onSettle?)` returning `{ value, setValue, settled }`, with the `sent` ref and the
cleanup. The two route-navigation sites share `SEARCH_SETTLE_MS` (200 ms); the
audit read keeps 250 ms and says why in its own comment.

### Why there is no pair

A comparison harness compares two rendered columns. Both columns here would be
the same input with the same behaviour — the difference is where 25 lines live,
which a column cannot show. Registering a pair would produce two identical
screenshots and no evidence. The evidence is the hook's suite instead.

### Automated evidence

| Evidence                                                                                                                                                                                  | Result                                               | Command                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Burst reports once; no report on mount; an external change is adopted and the queued keystroke dropped; the echo of its own report is ignored; the settled value is held with no callback | 5 tests, pass                                        | `pnpm exec vitest run src/lib/settled-value.test.ts`                                                   |
| The three call sites: the registry toolbar, the dataset rows grid, the audit log                                                                                                          | pass (their existing suites, unchanged in behaviour) | `pnpm exec vitest run src/routes/settings/audit.test.tsx src/routes/datasets/$datasetId/rows.test.tsx` |

### Decision and reason

**Adopt the shared hook; delete the three copies.** The behaviour is the part
worth keeping — the `sent` ref and the cleanup are what stop a settled report
clobbering typing that is still pending — and it was the part copied by hand.

### Limits of this row

- No browser evidence: the debounce is covered in jsdom with fake timers, and the
  routes that use it are covered by their own suites.
- `settled` and `onSettle` are both offered because the three call sites needed
  different halves of the same mechanism; a fourth site should use whichever it
  needs rather than adding a third shape.

## Row 8 — Registry table (`registry-grid`)

### What we use now

`src/routes/samples.tsx` (503 lines) and six sibling screens render the same
registry body by hand: a `v3/ui/table` inside the shared chrome from
`src/components/v3/inventory/list.tsx`, with `stickyHead`/`stickyCell` classes
standing in for a pinned first column, `selected={…}` on the row plus an
`onClick` for selection, and the count in `ListFooter`. Sorting belongs to the
route: the toolbar's Sort menu writes a `sort` key and the route sorts the array
with `localeCompare(value, 'en-GB', { numeric: true })` before the table sees it.
There is no keyboard path to a row selection, no virtualisation, and the sticky
column is a `position: sticky` utility that the print and phone rules have to
know about.

Nine screens shipped this body: `/protocols`, `/datasets`, `/experiments`,
`/samples`, `/materials`, `/instruments`, `/models`, `/templates`,
`/pipelines`. This change deleted every copy; the pair's ours column renders the
retired markup verbatim, which is what keeps the comparison reproducible after
the implementation is gone.

### What ReUI offers

`src/components/reui/frame.tsx` and `src/components/reui/data-grid/**`, both
installed with the shadcn CLI from the pinned base-nova registry into a scratch
directory and placed by hand (ADR-0055 decision 2, §11.3.1 of the plan: a plain
install resolves the item's bare registry dependencies into the legacy Radix kit
at `#/components/ui`). `cn` is re-pointed to `#/lib/utils`, the items are
restyled to the app-3 token vocabulary the v3 kit writes, and their imports are
wired to the v3 twins that exist.

The grid is written against TanStack Table v9, which is why B3 landed first.
The build ships virtualised rows (`DataGridTableVirtual`), column and row
pinning, cell selection (`data-grid-cell-selection.tsx`), pagination, column
controls and a drag layer; row grouping is not in the free build.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The pair
declares `sort` and `select`; the 5 items needing `reorder`, `filter` or
`resize` are recorded as not applicable.

| Check                                                     | Ours                                                                           | Theirs                                                                                     | How it was measured                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the sort picker, then each name link                                    | Pass — the sort picker, each row checkbox, then the name links                             | `tests/browser/component-compare.test.ts` (registry pair, keyboard)                                        |
| Sort without a pointer                                    | Pass — the shipped picker is a native select                                   | Pass — the same picker drives the table's sorting state                                    | same run; and `tests/browser/registry-grid.test.ts` for the screen                                         |
| Select a row without a pointer, and reach the selection   | **Fail** — rows are selected by clicking the row; nothing per row is focusable | Pass — focus the row checkbox, Space toggles it; the footer count and the inspector follow | same run; and `tests/browser/registry-grid.test.ts`                                                        |
| Sort by a column header, both directions                  | Pass — via the toolbar's Sort menu                                             | Pass — the same menu; the grid's own header is not used (see the costs)                    | `tests/browser/registry-grid.test.ts`                                                                      |
| Select a row, and select a second row                     | Pass                                                                           | Pass                                                                                       | same run                                                                                                   |
| Empty (0 rows), loading, error, permission-restricted     | Pass (see the caveat in row 1 — these are harness states, not the screen's)    | Pass                                                                                       | `src/components/component-compare/component-compare.a11y.test.tsx` (both columns, 6 fixtures and 3 states) |
| Dark theme                                                | Pass                                                                           | Pass                                                                                       | axe in Chromium with colour contrast on, both columns and both themes                                      |
| Density and overflow at 1440x900                          | Pass                                                                           | Pass                                                                                       | `tests/browser/component-compare.test.ts` (registry pair, density)                                         |
| Density and overflow at 390x844                           | Pass                                                                           | Pass                                                                                       | same run                                                                                                   |

Reorder, filter and resize: not applicable to this pair (5 items).

### Automated evidence

| Evidence                                                                                                                     | Result                                                              | Command                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                                                 | zero violations (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                            |
| Harness contracts (one scenario object to both columns, frozen fixtures, the registered pair set)                            | 12 tests, pass                                                      | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                                 |
| axe in Chromium, colour contrast on, registry pair, both columns × both themes                                               | 4 cases, zero violations                                            | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "registry table pair"` |
| Keyboard sort and keyboard selection, per column; density at 1440×900 and 390×844; four screenshots                          | 11 tests, pass                                                      | same command                                                                                                       |
| The adopted screen: flush table and no frame card, ordering under each sort key, click and keyboard selection, the name link | 1 test, pass                                                        | `pnpm exec playwright test tests/browser/registry-grid.test.ts --project=browser`                                  |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `registry-ours-light.png`,
`registry-ours-dark.png`, `registry-theirs-light.png`,
`registry-theirs-dark.png`.

### What the adoption cost

- **C1 — the sort header is not adopted.** The item's sortable header
  (`DataGridColumnHeader`) is built on four dropdown-menu parts the v3 kit does
  not have (`DropdownMenuCheckboxItem`, `DropdownMenuSub`,
  `DropdownMenuSubTrigger`, `DropdownMenuSubContent`). Adding them to the shared
  kit is a change to the forward vocabulary with its own blast radius, so the
  screen keeps its own sort control (the toolbar's Sort menu, which now writes
  the table's sorting state) and the grid renders static headers. The gain the
  item would add — per-column sort, pin and move menus — is not claimed here.
- **C2 — the collation is passed in.** The bundle's `alphanumeric` built-in
  orders `AAV9 harvest clarification` before `AAV full/empty ratio by AUC`,
  where the registry's en-GB collation does not. The columns carry the screen's
  comparator as a `sortFn`, so the order under each sort key is what the bespoke
  body produced (verified both ways: `tests/browser/tmp-b4-order` in the
  working tree during the change, and the expectations pinned in
  `tests/browser/registry-grid.test.ts`).
- **C3 — one control has no v3 twin.** The item's pagination ships a Radix
  select for "rows per page". The app's convention for a small control is a
  native select in the input's style, so that one control is re-pointed rather
  than restyled; the copy says so where it happens.
- **C5 — the table's accessible name is an addition to the copy.** The item
  renders an unnamed `<table>`; the v3 table it replaces always carried one
  (`aria-label="Protocols"`). The copy adds a `tableLabel` to the item's i18n
  labels and applies it on the table element, and the screen passes
  `"Protocols"`. It is recorded here because it is an edit beyond an import-path
  fix, and because a name is what the screen's own unit test and a screen-reader
  user both read.
- **C4 — cell selection and row pinning are available, not enabled.** The
  screen's selection model is a row that the inspector follows; a cell-range
  gesture would compete with the row click that drives it, and the item's cell
  selection is a 2.6k-line controller with its own clipboard and edit contract.
  Both stay in the item, unused by this screen.
- **C8 — the cell geometry is the component's, and that has an edge.** The
  component sets 33px rows, 10px cell padding and the first column's 24px inset
  because that is what makes the swap invisible; a column that carries its own
  padding (`instruments`' Owner column, the last cell before the swap) needs
  `pr-6!`, because a plain `pr-6` loses to the component's own cell rules. The
  grid's scroll container also has to be stretched by the screen
  (`[&>*]:flex-1`), or a short list leaves the horizontal scrollbar floating
  under its last row instead of at the list area's edge. That stretch also gave
  the rows their own vertical scroll inside the grid, which is what engages the
  item's sticky header — the tables these screens replace scrolled the header
  away with the rows, so `headerSticky` is off. Measured on `/samples`: the
  header moves 172 → -28 at scrollTop 200 in both the pre-swap build and this
  one, over the same 292px of overflow.
- **C9 — the checkbox column was dropped.** The grid's row-select column shipped
  first because the bespoke body had no keyboard path at all. It then turned out
  to duplicate the click: selection is one row for the inspector, so the column
  bought nothing but a tab stop, and its header checkbox promised a select-all
  the screen could not honour. The column is gone; a selectable row is now the
  control itself (one tab stop, Enter or Space selects, arrows walk the rows),
  which is the accessibility gain without an extra affordance. `experiments`,
  whose rows navigate, has no row tab stop.
- **C7 — the column widths, the header type and the numerals are the table's,
  not the grid's.** Measured on the migrated screens: the grid's defaults put a
  13px `text-fg` header in a 40px band over 37px rows with 12px cell padding,
  and it spends a column on the row checkbox. The shared component carries the
  v3 table's geometry instead — a 12px `text-fg-muted` header in a 31px band,
  33px rows, 10px padding with a 24px first-cell inset, `num` figures — and the
  checkbox renders in that inset rather than in a column of its own, because a
  40px column pushes a table that already fills the list area into a horizontal
  scroll (measured: `models` 940px and `templates` 945px in a 908px area; both
  back to 908 with the checkbox in the gutter). This is the same rule as C6:
  the swap is the implementation, not the look.
- **C6 — the registry `Frame` is not adopted either.** The item's frame renders
  the table as an inset card with its own footer band and a rounded border. On
  `/protocols` that is a redesign of the list chrome the rest of the app shares
  (every other registry screen is flush, with the same `ListFooter` band), and
  the screen's own footer already carries the count. The table therefore renders
  flush inside the screen's scroll area, keeps the v3 header band
  (`bg-surface-muted`), and does not enable column pinning — the pin's surface
  tint and boundary rule are a visible change at rest, which is what the
  `stickyHead`/`stickyCell` pair avoided by only sticking below `xl`. This is
  the same rule the programme applies to every adoption: swap the part, keep the
  app's look.
- Plus the standing requirements: restyled to Sheetbase tokens, colour check,
  axe and the adoption guard pass, and the old body is deleted in the same
  change.

### Decision and reason

**Adopt, on `/protocols`.** The reason is a measured missing behaviour, not a
preference: the bespoke body cannot select a row from the keyboard at all
(`keyboard-select` fails above, and the same body is copied across eight
screens), and it maintains its own pinned-column CSS, row chrome and count
footer per screen. The grid also renders rows through a virtualiser, which the
registry lists do not have today, and and it replaces the per-screen row chrome with the item's own.

The adoption is not scoped to one screen. Earlier in this change it was, on the
argument that `/protocols` is the one registry screen outside the design-parity
set and so needed no regenerated design reference; that argument was withdrawn.
Standardising the app's tables is the point of the change, and leaving eight
screens on the copied body because of a parity bookkeeping constraint leaves the
product inconsistent — two screens with different chrome and one with behaviour
the others lack. The rule the programme applies instead is the one in C6: swap
the part, keep the app's look. Every screen listed above renders the grid flush,
at the same widths and the same 33px rows as the table it replaced.

### Limits of this row

- Tables outside the registry lists are converted too, in the same change: the
  read-only detail tables — a model's versions, fields, relations, rules and
  usage; a protocol's blocks, links and version history; an evidence revision's
  content; a record's linked records and revisions; the client portal's
  milestones, records and reports; the saved-analyses list; the settings,
  integration, signature and usage tables; the home dashboard — render through
  the same grid with `selectable={false}`, each keeping its own container, so
  no checkbox column appears where nothing is selected. Two stay bespoke, with
  reasons: `settings/audit`'s span-carrying load-more tail and `analysis/new`'s
  chart preview, whose row click drives a chart rather than a selection. A
  third exception is `models/$modelId/edit.tsx`, an editable form whose tables
  are inputs rather than a grid.
- `/experiments` takes the grid without the selection column: its rows navigate
  to the experiment, so a checkbox would be a control with nothing to select.
  Its group bands are drawn by the grid's own band rows (`bandRow`), which is a
  cell-per-column strip rather than a spanning cell — the visual result is the
  same and it is the one grouped list in the app.
- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run. The phone width is measured at 390x844 with the desktop
  engine, and the screen's phone path is still `MobileList`, not the grid.
- The 5,000-row fixture is rendered in the harness (the a11y suite skips it for
  axe, per the runbook); virtualisation on a real 5,000-row registry screen was
  not measured.
- The item's own header, filter, drag and cell-selection layers were read but
  not adopted, so this row is not a verdict on them.

## Row 9 — Working indicator (`spinner`)

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

## Row 10 — Horizontal quantity bar (`progress`)

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

## Row 11 — Disclosure (`collapsible`)

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

## Row 12 — Code and raw-payload block (`payload-block`)

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

## Row 13 — Avatar and initials (`avatar-initials`)

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

## Row 14 — Notice and banner chrome (`notice-banner`)

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

## Row 15 — File type (`file-type`)

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

## Row 16 — Tab family (`tab-family`)

### What we use now

`src/components/v3/ui/tabs.tsx`, `mode="state"`: Base UI's tablist — one tab
stop, ArrowLeft/ArrowRight, Home/End, `aria-selected`, activation that follows
focus, and `aria-controls` only where a `TabsPanel` is rendered (a dangling
one is an axe violation). It is the outcome of this change's reconciliation: the
two `SearchTabs`, the unused `RouteTabs`, `LinkTabs` and `SegmentLinks` were
deleted, and nine hand-rolled strips and two chip rows moved onto this contract
in `mode="url"` where the tabs are URLs.

The job this pair compares is the in-page half: _switch which view of the same
rows is shown, without leaving the page_. The other half — tabs that are links,
with `aria-current="page"` — is most of the strips this change migrated, and the candidate
has no mode for it.

### What ReUI offers

**No ReUI item.** On 16 October 2026 the pinned registry redirects and answers:

```
$ curl -s https://reui.io/r/base-nova/tabs.json
{"error":"Registry item not found","message":"tabs is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add tabs"}
```

so the candidate is the stock shadcn item (`ui.shadcn.com/r/styles/new-york/tabs.json`,
`registry:ui`, one file, dependency `@radix-ui/react-tabs`), placed at
`src/components/reui/tabs.tsx`. Three edits and nothing else, recorded in that
file's header: the primitive import re-pointed to the unified `radix-ui` package
the repository already has (as published it needs `@radix-ui/react-tabs`, which
is not a dependency), `cn` from `#/lib/utils`, and the tokens restyled
(`bg-muted` → `bg-surface-muted`, `ring-ring` → the kit's `outline-focus`), which
an adoption would have to do anyway.

### Checklist result

Applicable items are the 9 the pair has: `keyboard-tab` and
`keyboard-navigate` (`navigate` is the control class added for this pair — a
widget whose parts are moved between with the arrow keys), the five state items,
and both densities. The other 10 need reorder, sort, filter, select, resize or
pagination controls that neither side of this pair has.

| Check                                                                     | Ours                                                                                                                                                            | Theirs                                                                                                                                                    | How it was measured                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator                 | Pass — the tab stop is the current tab; the ring is drawn on it (`outline: solid 2px`)                                                                          | Pass — the tab stop is the `role="tablist"` container (`tabindex="0"`, inline `outline: none`); focusing it forwards focus to a tab, which draws the ring | Browser, both columns, `document.activeElement` + `getComputedStyle` |
| Move between the widget's parts with the arrow keys the pattern calls for | Pass — ArrowRight moved focus **and** selection from `All` to `Sample`, the roving `tabindex` followed (`[0,-1,-1,-1]` → `[-1,0,-1,-1]`), and the panel changed | Pass — the same, including wrap; `End` jumped to the last tab                                                                                             | Browser, trusted key events (`agent-browser press`), both columns    |
| Empty (0 rows), loading, error, permission-restricted                     | Pass (see the caveat below)                                                                                                                                     | Pass                                                                                                                                                      | jsdom and browser                                                    |
| Dark theme                                                                | Pass — token-bound colours only; axe clean in dark                                                                                                              | Pass                                                                                                                                                      | axe in Chromium, colour contrast on, both columns and both themes    |
| Density and overflow at 1440x900                                          | Pass — one line, no horizontal page overflow, long labels do not overlap                                                                                        | Pass                                                                                                                                                      | Browser, both columns                                                |
| Density and overflow at 390x844                                           | Pass — the rail scrolls sideways instead of wrapping, and the current tab is scrolled into view                                                                 | Pass                                                                                                                                                      | Browser, both columns, and the story's 390px state                   |

Sort, filter, select, resize and pagination: not applicable to this pair (10
items). They are listed in the harness with that verdict.

**Caveat on the empty, loading and error states.** As in row 1, these are picture
states of a whole screen and the harness owns them: both columns show the same
harness notice for a 0-row fixture, for loading and for a load failure. The
`restricted` state has nothing to disable in a view switch, so both columns show
the same notice above an unchanged strip; that is recorded rather than dressed up.

### Automated evidence

| Evidence                                                                                                                                                                   | Result                                                                            | Command                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides (this pair)                                                                                                   | 18 cases, **zero violations** (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| Harness contracts, including the registered pair set                                                                                                                       | pass                                                                              | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`      |
| The contract itself: state mode's tab stop, arrows, Home/End, counts, callback; URL mode's `aria-current`, no `aria-selected`, and the `activeOptions` it hands the router | 5 tests, pass                                                                     | `pnpm exec vitest run src/components/v3/ui/tabs.test.tsx`                               |
| Appearance                                                                                                                                                                 | one capture per column per theme on the long-labels fixture                       | the harness at `/component-compare`, pair _Tab family_                                  |

### Decision and reason

**Decline — keep ours.** ADR-0055 decision 4 asks whether the candidate is
_materially better_: a named behaviour is missing from ours, or the maintenance
burden is demonstrably ours. Neither holds. Measured in the same browser, both
sides move focus with ArrowLeft/ArrowRight and Home/End, both announce
`role="tablist"`/`role="tab"` with `aria-selected`, and both keep one tab stop —
the only structural difference is _where_ that stop lives (the tab, or the
container). What the item does not have is the half of the job most of our
strips do: `mode="url"`, where each tab is its own URL and the current one
carries `aria-current="page"`. Adopting it would therefore either leave the app
with two tab implementations — the thing this change removed — or force the URL
mode onto a list component by hand.

The costs are real and one-sided: as published it needs `@radix-ui/react-tabs`,
a second primitive library beside the Base UI kit the v3 components are built on
(ADR-0055 decision 1), and its token vocabulary is the deprecated bridge
(`bg-muted`, `text-muted-foreground`, `outline: none`) that §11.5 says renders
wrong beside every neighbour while still passing the colour check.

This row is the _comparison_, not the reconciliation: the reconciliation is the
change that produced `src/components/v3/ui/tabs.tsx`, and it needed this
comparison done first, which is why the same change carries both.

### Limits of this row

- Desktop Chromium only (Playwright's engine through `agent-browser`); no
  Firefox, WebKit or real device was run.
- The two sides were compared on the _strip_: the panel under each is one line of
  text, so the items about content are answered by the columns' own containment.
- The candidate is the item **with the three edits its header records**. Left as
  published it would not compile here (`@radix-ui/react-tabs` is not installed),
  and that is itself part of the measured cost.
- The 5,000-row fixture is rendered and measured for overflow in both columns,
  not by axe (row 1's recorded limit applies to every pair).

## Row 17 — Pressed-state chips (`pressed-chips`)

### What we use now

The shipped multi-select filter chip row: `revision-diff-review.tsx:493-534` (its
change-type and change-area filters) — a `role="group"` with an `aria-label`, one
`<button aria-pressed>` per kind, a count in the label, and **each chip its own
tab stop**. Ten other sites share the shape.

This is the second half of the domain scan's "pressed-state toggle chip group"
finding. Its first half — the _single-select_ chip rows in `schedule.tsx`,
`review/$revisionId.tsx`, `audit/experiment-history.tsx` and
`scientific/scientific-record-linker.tsx` — turned out to be the tab job: they
are the `variant="segment"` state tabs now, with the roving focus and arrow keys
the scan said they lacked. The scan's claim does not hold for what is left: a
multi-select group has no roving focus in its pattern, which is why
`keyboard-navigate` is recorded as not applicable for this pair.

### What ReUI offers

**No ReUI item.** The pinned registry answers 404 the same way:

```
$ curl -s https://reui.io/r/base-nova/toggle-group.json
{"error":"Registry item not found","message":"toggle-group is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add toggle-group"}
```

The candidate is the stock shadcn item (`toggle-group`, registry dependency
`toggle`, dependencies `@radix-ui/react-toggle-group` and `@radix-ui/react-toggle`),
placed at `src/components/reui/toggle-group.tsx` + `toggle.tsx` with the same
three edits as row 2.

### Checklist result

Applicable items are the 8 the pair has: `keyboard-tab`, the five state items and
both densities. The other 11 need controls this pair has none of — including
`keyboard-navigate`, which a multi-select group does not have a pattern for.

| Check                                                     | Ours                                                                                             | Theirs                                                                                                                                                 | How it was measured                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — each chip is a tab stop of its own, and the chip draws the ring                           | Pass — the group is the single tab stop (`tabindex="0"`, inline `outline: none`); focusing it forwards focus to the first chip, which draws a 2px ring | Browser, both columns, `document.activeElement` + `getComputedStyle` |
| Empty (0 rows), loading, error, permission-restricted     | Pass — no chips to render for a fixture with no kinds; the columns' own states are the harness's | Pass                                                                                                                                                   | jsdom and browser                                                    |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                                               | Pass                                                                                                                                                   | axe in Chromium, colour contrast on, both themes                     |
| Density and overflow at 1440x900                          | Pass — chips wrap inside the column, no page overflow                                            | Pass                                                                                                                                                   | Browser, both columns                                                |
| Density and overflow at 390x844                           | Pass — chips wrap, none clipped                                                                  | Pass                                                                                                                                                   | Browser, both columns                                                |

### Automated evidence

Same three commands as row 2, over this pair: **18 axe cases, zero
violations**, the harness contract tests, and `tabs.test.tsx` for the contract the
other half of the finding moved onto.

### Decision and reason

**Decline — keep ours.** There is no behaviour to buy. Both sides announce each
chip's pressed state as `aria-pressed`, and neither is unreachable by keyboard;
the differences the measurement found are costs, not gains: the item changes the
announced role from `group` to `toolbar` (a toolbar promises arrow-key
navigation between its controls, which a multi-select filter row does not
implement), moves the single tab stop onto that container (so Tab reaches the
row once rather than reaching the chips), and brings two dependencies
(`@radix-ui/react-toggle-group`, `@radix-ui/react-toggle`) or an import-path fix
that makes it not-as-published. Restyling it to Sheetbase tokens is ours either
way.

### Limits of this row

- Same engine, fixtures and exclusions as row 2.
- The candidate was compared `type="multiple"`, which is the mode the shipped
  sites use. A single-select row is a different job here and is the segment mode
  of the tab contract, not this item.
- The two chip rows in `revision-diff-review.tsx` are _filters_, and ADR-0055
  decision 6 holds anything the `sheetbase-advanced-search` filter builder owns
  until the filter model is reconciled. This row compares the control, not the
  filter model.

## Row 18 — Option picker (`native-select`)

### What we use now

`src/components/v3/ui/select.tsx` — `Select`: the **native** `<select>`, styled
like `Input` and wrapped in a positioning `<span>` that carries a token-coloured
chevron. It is a hoist, not a new build: the primitive existed as
`NativeSelect` in `src/components/v3/projects/select.tsx` (imported by 39
files, including the notebook block editor, the sheet block and the figure
configurator), with a second, differently-shaped definition in
`src/components/v3/inventory/list.tsx:387-404` and raw `<select>` copies in v3
screens and route files. This change makes it one definition in the kit's own
directory, re-points every importer, deletes the second definition, and migrates
the 22 native `<select>` sites in the route surfaces plus three further v3
component sites onto it.

Two facts about it that the measurements turned on:

- **Native is deliberate**, and it is the reason this row compares the native
  item and not a listbox. Keyboard handling, typeahead, `<optgroup>` grouping,
  disabled options, form participation and the platform picker (including the
  OS list on mobile) are the element's; `inventory/list.tsx` recorded the same
  reason before this change ("Native keeps keyboard and screen reader behaviour
  for free"). A JS listbox — the stock shadcn `select`, or `@base-ui/react`'s
  `Select`, whose exports were read for this row — would trade those for
  styling, and would change behaviour on 22 migrated sites that were not
  migrated to gain one.
- **The two sizes are the kit's, not the registry's.** `md` is 30px with
  `max-md:h-10` and `text-body`; `sm` is 26px with `max-md:h-8` and
  `text-label`, mirroring `Button`'s `md`/`sm` mobile growth. `className` merges
  on the wrapper, so a toolbar that is 32px tall (`record-model-records.tsx`)
  passes `size="sm" className="h-8"` and the control follows — no third size.

### What ReUI offers

**Nothing under the ReUI name.** The pinned base-nova registry serves neither
`native-select` nor `select`: both installs fail against
`https://reui.io/r/base-nova/{name}.json` with "item not found" (measured
16 Oct 2026, from a scratch directory with this repository's `components.json`).
The job is served by a **stock shadcn** item, `native-select`, installed by bare
name from the shadcn registry and placed by hand at
`src/components/reui/native-select.tsx` (the runbook's placement rule for
copy-and-own source; `cn` re-pointed to `#/lib/utils`, colours restyled to
Sheetbase tokens because an adoption means restyling anyway).

What that item is: `NativeSelect` plus `NativeSelectOption` and
`NativeSelectOptGroup` wrappers that pin option colours to the OS
`Canvas`/`CanvasText` system colours; a `div` wrapper with
`has-[select:disabled]:opacity-50`; a lucide `ChevronDownIcon`;
`size="default"|"sm"` heights of 36px and 32px with no mobile growth; and
`data-slot`s. Its `select` is the same platform element as ours.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. This pair
declares the `picker` control class, added with this row; the other 10 items are
recorded as not applicable rather than skipped.

| Check                                                               | Ours                                                                                                                            | Theirs                                                                                            | How it was measured                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator           | Pass — both pickers, reached in DOM order, each drawing the kit's focus outline                                                 | Pass — both pickers, each drawing its ring                                                        | Browser, both columns (`keyboard: reaches every picker by Tab`)                                 |
| Change the option without a pointer (arrow keys, typeahead, groups) | Pass — ArrowDown moves the selection; `R` typeahead crosses into the Standard group; a disabled option is never reached         | Pass — identical, being the same element                                                          | Browser, both columns, asserted per column (`changes the chosen option…`, `typeahead crosses…`) |
| Change the option with the pointer alone                            | **Not measurable** — the popup is the platform's widget, not DOM, so neither engine can drive it                                | **Not measurable** — same platform popup                                                          | Manual; recorded as a limit (see below), not as a pass                                          |
| Empty (0 rows), loading, error, permission-restricted               | Pass — one honest "No rows in this fixture" option, and the control disables in `restricted`                                    | Pass — same, and its own disabled rendering (`opacity-50`)                                        | jsdom (axe, all fixtures and states) and the harness contract test                              |
| Dark theme                                                          | Pass — token-bound colours only; axe clean in dark                                                                              | Pass — axe clean in dark after the token restyle                                                  | axe in Chromium with colour contrast on, both columns, both themes                              |
| Density and overflow at 1440x900                                    | Pass — no page overflow; pickers 30px and 26px, inside the column                                                               | Pass — no page overflow; pickers 36px and 32px                                                    | Browser, both columns, measured per column                                                      |
| Density and overflow at 390x844                                     | **Partial** — no overflow, both pickers inside the column, but 40px and 32px tall: the checklist's 44px touch target is not met | **Partial** — 36px and 32px tall: the same clause unmet, and the item has no mobile growth at all | Browser, both columns, measured (document overflow 0)                                           |

Sort, filter, row-select, resize and pagination: not applicable to this pair (5
of the 10), and the reorder items are not either.

**The 44px clause.** Neither side meets it, and ours is the larger of the two
(40px vs 36px) because `md` grows on narrow screens and the item does not. The
kit's own vocabulary is the constraint: `Button`'s `md` is `max-md:h-10` (40px)
and `Input` does not grow at all (30px), so raising the select alone would make
it taller than the buttons beside it. Recorded here as a kit-wide decision, not
one this change should take alone.

### Automated evidence

| Evidence                                                                                                 | Result                                                                            | Command                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides, for this pair and the notebook pair        | 18 cases for this pair, **zero violations** (colour contrast off: jsdom)          | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                      |
| axe in Chromium, colour contrast **on**, both columns, both themes                                       | 4 cases, **zero violations**                                                      | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "native select"` |
| Harness contracts (both columns render the same options; the restricted state disables both)             | 14 tests pass (2 of them this pair's)                                             | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                           |
| Keyboard, density and screenshots in a real engine                                                       | 13 tests pass for this pair                                                       | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "native select"` |
| The migration itself: every `<select>` on the screens walked is the primitive and has an accessible name | 13 selects on 7 of the 14 screens walked, 0 raw, 0 unnamed (measured 16 Oct 2026) | walked with the gareth design user at 1440x900; the screens are listed in the change's report                |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `native-select-ours-light.png`,
`native-select-ours-dark.png`, `native-select-theirs-light.png`,
`native-select-theirs-dark.png` — one per column per theme. Appearance is
evidence; it is not the verdict.

### What an adoption would cost

- **There is nothing to pin.** The item is stock shadcn, so an adoption would
  track the shadcn registry rather than this repository's `@reui` pin, and the
  ADR-0055 decision-2 placement rule (`src/components/reui/**`) would be a
  filing convention rather than a registry one.
- **It would restore the duplication this change removes.** The item is a second
  definition of the same control; adopting it means re-pointing 41 files again
  and deleting the hoisted primitive, for no behavioural change.
- **Its sizes and mobile behaviour would have to be re-decided** (36/32px, no
  growth), and its lucide chevron and `div` wrapper would replace the kit's
  `Icon` and `<span>`; the restyle to our tokens is the easy part.
- **Its `NativeSelectOption`/`NativeSelectOptGroup` wrappers** are the one thing
  it has that we do not: option colours pinned to the OS system colours. Nothing
  in the product has needed them; if a dark-mode popup defect ever appears, that
  is the piece to lift, not the whole item.
- **Its focus treatment is a `ring-*`, and it ships `outline-none`.** Restyling
  to our outline means deleting that `outline-none` as well: left in, it cancels
  the outline the restyle adds, and the control then has no visible focus
  indicator at all (measured — the harness's Tab check failed on it until the
  class was removed). A restyle that only swaps colour tokens would ship that.

### Decision and reason

**Keep ours. No adoption.** The bar in ADR-0055 decision 4 is a _materially
worse_ hand-rolled version — a named behaviour missing, or a maintenance burden
that is demonstrably ours. Neither holds here: both sides are the same platform
element, so the behaviour is the same by construction, and this change already
removes the maintenance burden (one definition, 41 importers, 22 migrated sites)
without the registry item. The candidate's own additions are cosmetic or
unused. This is not a measured decline of the item; it is the row recording that
the job was already owned, and that the comparison was made against the native
item because native is the repository's deliberate choice for it.

### Limits of this row

- The pointer path could not be exercised in either engine: a native `<select>`'s
  popup is the platform's own widget, absent from the DOM and from Playwright's
  reach. `selectOption` is a DOM-API path, not a pointer path, so it is not
  evidence for that checklist item. A person can run it on the harness page.
- Desktop Chromium only (Playwright, one worker). The mobile capture is a 390px
  viewport, not a device, and no iOS or Android picker was observed.
- The 5,000-row fixture is rendered in both columns in the browser run (5,000
  `<option>`s per select) but is not an axe target in either engine — the same
  recorded exclusion as row 1.
- The migration evidence (13 selects on 7 of the 14 screens walked, all the
  primitive, all named) was gathered by walking those screens, not by a
  committed test; the committed guard is the adoption test plus the kit's own
  suites.
- This row records one pair. It is not a verdict on the shadcn registry, on
  `@base-ui/react`'s `Select`, or on any other item.

## Row 19 — Credential panel (`settings-credentials`)

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

## Row 20 — Chip / toggle pill (`chip`)

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

## Row 21 — Command and listbox (`command`)

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
