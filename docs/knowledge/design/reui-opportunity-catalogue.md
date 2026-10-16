# ReUI opportunity catalogue

Index for the component-adoption programme in
[`plans/notebook-editor-and-reui.html`](../../../plans/notebook-editor-and-reui.html)
(revision 5) and for the three discovery scans that widened it.

The owner's instruction on 16 October 2026: convert everything the scans find,
componentise wherever several hand-rolled versions of one job exist — even where
the registry has no counterpart — give every component a Storybook story, and
put empty states back in scope. The aim is one consistent component layer, so
the next feature composes rather than reinvents.

Every adoption still needs what ADR-0055 requires: a recorded, behaviour-level
comparison in
[`component-comparison-record.md`](component-comparison-record.md), the old
implementation deleted in the same change, restyling to the app-3 token
vocabulary, axe clean, and a story that stands in where the screen is not in the
design-parity set.

## The scans

| Scan           | Scope                                                  | File                                                                 |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Domain         | `src/components/**` outside `v3/**` and the legacy kit | [`reui-opportunity-scan-domain.md`](reui-opportunity-scan-domain.md) |
| Route surfaces | `src/routes/**`                                        | [`reui-opportunity-scan-routes.md`](reui-opportunity-scan-routes.md) |
| v3 surfaces    | `src/components/v3/**`                                 | [`reui-opportunity-scan-v3.md`](reui-opportunity-scan-v3.md)         |

Each ranks by worth-doing rather than by the old tiers, carries file:line
evidence, records the jobs it checked and found nothing for, names the in-house
jobs worth one component, and says which candidates already have a story.

## Landed

| Workstream     | Head       | Decision and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `work/stepper` | `5204d087` | **Declined** `@reui/stepper`. It is a wizard navigation primitive — a `<nav>` of `<div>` items holding a `role="tablist"` of tabs, with no `aria-current` and no failed state — so it cannot carry the shipped contract (`<ol aria-label="Steps">`, one `<li>` per step, `aria-current="step"`), and measured on the flow's own steps it reports three critical axe violations, two of which survive the consumer's fixes. The legacy Radix stepper is deleted instead, and the forward row at `src/components/v3/ui/stepper.tsx` is the single implementation. Record row 2; the comparison is pinned in `component-compare.a11y.test.tsx` rather than registered as a route pair, because an axe-failing column must not turn the harness suite red. |

## Workstreams in flight

| Workstream                  | Covers                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `work/b2-notebook-sortable` | ReUI Sortable replaces the notebook's 114 lines of HTML5 drag; touch and keyboard sensors                     |
| `work/b3-b4-grid`           | TanStack Table v9 on `scientific/data-table.tsx`, then Frame + Data Grid on the inventory list                |
| `work/b5-file-upload`       | ReUI file upload in the import flow; transport stays ours                                                     |
| `work/b5-timeline`          | ReUI Timeline consolidates the audit/history rows                                                             |
| `work/empty-states`         | One Empty component; empty states are back in scope; remaining sites inventoried                              |
| `work/convert-a`            | Spinner, progress, collapsible, code/payload block and the hand-rolled copy controls                          |
| `work/convert-b`            | Avatar/initials unification, notice/banner onto the v3 pair, `@reui/file-type`                                |
| `work/convert-c`            | Row chrome: ~30 renderers in six families, incl. the `RecordLink`/`LinkedRecordList` twins                    |
| `work/convert-d`            | Pagination and load-more, list header, breadcrumb semantics, the copied settle-delay debounce                 |
| `work/convert-e`            | Tab/segment family reconciliation (after the `analysis/new.tsx` keyboard defect fix)                          |
| `work/convert-f`            | One select primitive over the 22 native `<select>` sites; the row targets the native item                     |
| `work/convert-g`            | Settings twins (~300 lines), chip/toggle pill, Command/listbox reconciliation                                 |
| `work/tier2-small`          | Number field, signature pad, icon tile/marker/trace/kbd                                                       |
| `work/stories-kit`          | Stories for the forward kit, registry and icons; a structural coverage guard; `build-storybook` in `validate` |
| `work/stories-domain-a/b`   | Stories for every domain and screen component                                                                 |

## Still to take

- **Inventory list/table chrome** — the largest in-house consolidation
  (`inventory/list.tsx`, 12 exports, 28 importing files, 8 outside the area).
  Deliberately held back until the Frame + Data Grid workstream lands, because
  it rewrites that file.
- **Remaining empty-state tranches** — the sites and their feasibility are
  inventoried in `empty-state-migration.md` as the first tranche lands.
- **Tier-2 heavy items** — event calendar, date/time selectors, combobox family,
  tree, and the remaining small pieces, each as its screen is next touched.
- **Kanban** — not an adoption: the product parks a Board view
  (`inventory/list.tsx`, "Later"). If Board is built, ReUI Kanban is the
  candidate.

## Exclusions still in force

The sheet grid ([ADR-0048](../decisions/0048-sheet-grid-on-sheetbase-table.md)),
the figure renderers, the scientific status vocabulary
([ADR-0011](../decisions/0011-scientific-status-and-relationship-components.md)),
anything the `@sheetbase-labs/sheetbase-advanced-search` filter builder owns,
and notebook blocks and their chrome. Empty states were excluded by the owner on
15 October and brought back into scope on 16 October; that reversal is recorded
here rather than by editing the plan's history.

## Registry correction

Several candidates are stock shadcn components on the same index, not ReUI
items — the registry 404s them: avatar, spinner, item, accordion, collapsible,
toggle group, progress, pagination, tabs, select, breadcrumb, empty, table,
card and alert. Record rows must name the actual supplier, and an in-house
primitive built on `@base-ui/react` must say so rather than citing a registry.
