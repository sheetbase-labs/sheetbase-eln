/**
 * ReUI `data-grid`, installed from the pinned Base UI registry (ADR-0055):
 *
 *   pnpm dlx shadcn@latest add @reui/data-grid
 *   @reui -> https://reui.io/r/base-nova/{name}.json
 *
 * Copy-and-own source, placed by hand from a scratch install (a plain install
 * resolves the item's bare registry dependencies into the legacy Radix kit at
 * `#/components/ui`, which ADR-0055 decision 1 says is not extended). See
 * `docs/development/component-compare.md`.
 *
 * Changes from the registry file, and nothing else:
 * - `cn` re-pointed from the `cn` package to `#/lib/utils`, the helper that
 *   teaches tailwind-merge the Sheetbase type scale.
 * - Restyled to the app-3 token vocabulary the v3 kit writes
 *   (`src/styles.css:683-707`), with row states on the v3 table's own
 *   `bg-row-hover` / `bg-selection` tokens.
 * - Imports wired to the v3 twins that exist (badge, button, checkbox, dropdown-menu, input, popover, select, separator, skeleton, spinner).
 * - `tableLabel` added to the labels and applied to the table element: the
 *   item renders an unnamed `<table>`, and the v3 table it replaces carried an
 *   accessible name. Recorded as an integration fix-up in
 *   docs/knowledge/design/component-comparison-record.md (row 2, C5).
 */
export interface DataGridI18nLabels {
  /* The table element's accessible name. The registry item sets none; the v3
     table this grid replaces always carried one, so the copy adds the slot. */
  tableLabel: string
  /* The column header menu. */
  sortAscending: string
  sortDescending: string
  pinColumnStart: string
  pinColumnEnd: string
  moveColumnStart: string
  moveColumnEnd: string
  columnsMenu: string
  unpinColumn: (title: string) => string
  toggleColumns: string
  /* Row and cell affordances. */
  rowCreate: string
  pinRow: string
  unpinRow: string
  selectRow: string
  selectAll: string
  expandRow: string
  collapseRow: string
  dragToReorder: string
  dragToReorderRow: string
  reorderingUnavailable: string
  /* Grid states. */
  loading: string
  empty: string
  allRowsLoaded: string
  /* Pagination. */
  rowsPerPage: string
  paginationInfo: (info: { from: number; to: number; count: number }) => string
  previousPage: string
  nextPage: string
  goToPage: (page: number) => string
  paginationEllipsis: string
  /* The faceted column filter. */
  filterSelectedCount: (count: number) => string
  filterNoResults: string
  filterClear: string
}

export interface DataGridI18nConfig {
  labels: DataGridI18nLabels
}

export type DataGridI18nOverrides = {
  labels?: Partial<DataGridI18nLabels>
}

const DEFAULT_DATA_GRID_LABELS: DataGridI18nLabels = {
  tableLabel: 'Data table',
  sortAscending: 'Asc',
  sortDescending: 'Desc',
  pinColumnStart: 'Pin to left',
  pinColumnEnd: 'Pin to right',
  moveColumnStart: 'Move to left',
  moveColumnEnd: 'Move to right',
  columnsMenu: 'Columns',
  unpinColumn: (title) => `Unpin ${title} column`,
  toggleColumns: 'Toggle Columns',
  rowCreate: 'Add row',
  pinRow: 'Pin row',
  unpinRow: 'Unpin row',
  selectRow: 'Select row',
  selectAll: 'Select all',
  expandRow: 'Expand row',
  collapseRow: 'Collapse row',
  dragToReorder: 'Drag to reorder',
  dragToReorderRow: 'Drag to reorder row',
  reorderingUnavailable: 'Reordering unavailable',
  loading: 'Loading...',
  empty: 'No data available',
  allRowsLoaded: 'All records loaded',
  rowsPerPage: 'Rows per page',
  paginationInfo: ({ from, to, count }) => `${from} - ${to} of ${count}`,
  previousPage: 'Go to previous page',
  nextPage: 'Go to next page',
  goToPage: (page) => `Go to page ${page}`,
  paginationEllipsis: '...',
  filterSelectedCount: (count) => `${count} selected`,
  filterNoResults: 'No results found.',
  filterClear: 'Clear filters',
}

const DEFAULT_DATA_GRID_I18N: DataGridI18nConfig = Object.freeze({
  labels: Object.freeze(DEFAULT_DATA_GRID_LABELS),
})

/**
 * A shallow merge per section, deliberately: a deep merge would leak a
 * default back into a function-valued label the consumer replaced. With no
 * overrides the frozen default is returned as-is, so the merge is free to
 * run on every render without producing a new identity.
 */
export function mergeDataGridI18n(
  overrides?: DataGridI18nOverrides,
): DataGridI18nConfig {
  if (!overrides?.labels) return DEFAULT_DATA_GRID_I18N
  return {
    labels: { ...DEFAULT_DATA_GRID_LABELS, ...overrides.labels },
  }
}
