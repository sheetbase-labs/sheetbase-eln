/**
 * Label, header-span and DOM-id helpers of the ReUI data grid, moved out of
 * `data-grid.tsx` by the strict-lint migration (ADR-0057): a component module
 * may export only components and hooks, and `data-grid.tsx` re-exports these
 * so every existing import path keeps working.
 */

import type { Column, RowData } from '@tanstack/react-table'
import type {
  DataGridFeatures,
  DataGridTableInstance,
} from '#/components/reui/data-grid/data-grid-features'

/** Label for headers / column visibility: `meta.headerTitle`, string `columnDef.header`, or `column.id`. */
export function getColumnHeaderLabel<TData extends RowData, TValue>(
  column: Column<DataGridFeatures, TData, TValue>,
): string {
  const metaTitle = column.columnDef.meta?.headerTitle

  if (metaTitle !== undefined) return metaTitle
  const defHeader = column.columnDef.header

  // A header renderer draws its own content; only a static string names the
  // column, so anything callable falls through to the id.
  if (defHeader !== undefined && !(defHeader instanceof Function)) {
    return defHeader
  }

  return String(column.id)
}

/**
 * meta.headerColSpan: the sibling leaves each owning leaf's header covers,
 * by owner id. Each must render right after the last in its pin family, or
 * the span ends there; the header rows, the resize indicator and the move
 * and drop targets all read spans from here.
 */
export function getDataGridHeaderSpans<TData extends object>(
  table: DataGridTableInstance<TData>,
) {
  const spans = new Map<string, Column<DataGridFeatures, TData, unknown>[]>()

  const families: Column<DataGridFeatures, TData, unknown>[][] = [
    table.getStartVisibleLeafColumns(),
    table.getCenterVisibleLeafColumns(),
    table.getEndVisibleLeafColumns(),
  ]

  for (const family of families) {
    for (let index = 0; index < family.length; index++) {
      const owner = family[index]
      const span = Math.floor(owner.columnDef.meta?.headerColSpan ?? 1)

      if (span < 2) continue

      // The next span - 1 siblings in definition order, so a span never
      // leaves its parent group; a hidden one is skipped, not a gap.
      const siblings = owner.parent?.columns ?? table.getAllColumns()
      const at = siblings.findIndex((sibling) => sibling.id === owner.id)

      const intended =
        at < 0
          ? []
          : siblings
              .slice(at + 1, at + span)
              .filter((sibling) => sibling.getIsVisible())

      const covered: Column<DataGridFeatures, TData, unknown>[] = []

      for (const sibling of intended) {
        const next = family.at(index + 1 + covered.length)

        if (next?.id !== sibling.id) break
        covered.push(next)
      }

      if (!covered.length) continue

      spans.set(owner.id, covered)
      index += covered.length
    }
  }

  return spans
}

/**
 * Row and column ids are consumer strings; DOM ids cannot carry spaces or
 * quotes. One shared sanitizer so `aria-activedescendant` writers and the id
 * renderers always agree on the same encoding.
 */
export function toDataGridDomId(value: string): string {
  return value.replace(/[^\w-]/g, '_')
}
