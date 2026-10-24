# ReUI opportunity catalogue

Index for the component-adoption programme in
[`docs/knowledge/design/notebook-editor-and-reui.html`](notebook-editor-and-reui.html)
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

All lanes named below are merged into `GWP/notebook-document-surface` (the merge
queue landed as `66df2782`), each with its record row and its story:

- `work/b2-notebook-sortable` — ReUI Sortable replaces the notebook's hand-rolled
  drag; the pair is re-pointed at the shipped integration (rows 1 and 1a).
- `work/stepper` — `@reui/stepper` declined on measurement; the two in-house
  steppers consolidated to one.
- `work/b5-timeline` — one shared history surface on `@reui/timeline`.
- `work/b5-file-upload` — `@reui/use-file-upload` behind one pick-and-drop field.
- `work/empty-states` — empty states back in scope; one component, twelve sites
  migrated, the rest inventoried.
- `work/convert-a` — spinner, progress, collapsible and payload block, each
  measured and componentised; `@reui/code-block` declined on dependency weight.
- `work/convert-b` — avatar/initials, notice/banner and `@reui/file-type`.
- `work/convert-c` — one row vocabulary (`Row`, `RowList`, `DescriptionList`)
  replacing ~30 renderers; the inspector density change is recorded against the
  design set.
- `work/convert-d` — pager, load-more, list header, breadcrumb semantics and the
  settle-delay debounce; the stock pagination and breadcrumb items declined.
- `work/convert-e` — one tab contract (state and URL modes) after fixing the
  `analysis/new.tsx` keyboard defect; the tab and toggle-group items declined.
- `work/convert-f` — one native select over 25 sites; the popup listbox declined.
- `work/convert-g` — settings twins, chip and the command/listbox reconciliation
  (cmdk removed).
- `work/b3-b4-grid` — TanStack v9, then the one registry grid on every registry
  list screen (protocols, datasets, experiments, samples, materials,
  instruments, models, templates, pipelines), rendered flush with the app's own
  header band, row height and widths. The registry's `Frame` is declined: its
  card restyles the list chrome.
- `work/tier2-small` — number field, signature pad and shortcut cap declined on
  measurement, with the plan's premise about the signature pad corrected.
- `work/stories-domain-a` — 98 story files, 303 stories, for the domain
  components.

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
