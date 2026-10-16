import * as React from 'react'

import { Icon } from '#/components/v3/icons'
import { NotebookBlock } from '#/components/notebook/notebook-block'
import {
  DropIndicatorLine,
  dropIndicatorFor,
  useNotebookBlockReorder,
} from '#/components/notebook/notebook-block-reorder'
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from '#/components/reui/sortable'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair 1 — the reorderable list.
 *
 * Ours: the notebook's hand-rolled HTML5 drag-and-drop, which until now lived
 * inline in `src/components/notebook/notebook-document.tsx` and now lives in
 * `notebook-block-reorder.tsx`, consumed here through the same hook the
 * document uses. The row frame is the notebook's own `NotebookBlock`, so the
 * column shows the affordance scientists actually meet: a grip handle in the
 * left margin that also opens the block menu, an insertion line above the gap
 * the drop would land in, and alt+arrow from the focused row.
 *
 * Theirs: ReUI's `Sortable`/`SortableItem`/`SortableItemHandle` from the pinned
 * base-nova registry (`@reui/sortable`), installed with the shadcn CLI and
 * placed under `src/components/reui/`. It is a `@dnd-kit` wrapper: pointer,
 * touch and keyboard sensors, a drag overlay, and a movement transform instead
 * of an insertion line. The row chrome around it is ours — an adoption means
 * restyling to Sheetbase tokens anyway — so what the column adds is the item,
 * the handle, the overlay and whatever `@dnd-kit` does with them.
 */

/** Move `id` to `targetIndex` in a fresh array; the caller clamps. */
function moveTo(ids: readonly string[], id: string, targetIndex: number) {
  const without = ids.filter((current) => current !== id)
  const clamped = Math.max(0, Math.min(targetIndex, without.length))
  const next = [...without]
  next.splice(clamped, 0, id)
  return next
}

const kindTone: Record<NonNullable<ComparisonRow['kind']>, string> = {
  Sample: 'text-fg',
  Control: 'text-fg-muted',
  Standard: 'text-fg-muted',
}

/** What one fixture row says: the same content in both columns. */
function RowContent({ row }: { row: ComparisonRow }) {
  return (
    <>
      <span
        className="w-2/5 min-w-0 truncate text-body"
        data-slot="comparison-row-name"
        title={row.name}
      >
        {row.name}
      </span>
      <span
        className="w-1/4 min-w-0 truncate text-label text-fg-muted"
        title={row.unit}
      >
        {row.unit}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-label">
        {typeof row.value === 'number' ? String(row.value) : (row.value ?? '—')}
      </span>
      <span className="w-20 shrink-0 truncate text-label text-fg-muted">
        {row.note ?? '—'}
      </span>
      <span
        className={`w-16 shrink-0 truncate text-label ${row.kind ? kindTone[row.kind] : 'text-fg-muted'}`}
      >
        {row.kind ?? '—'}
      </span>
    </>
  )
}

/**
 * Ours. Order is local state: the harness has no persistence, and the notebook's
 * own optimistic-then-persist path belongs to the route.
 */
function NotebookReorderColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [order, setOrder] = React.useState<readonly string[]>(() =>
    rows.map((row) => row.id),
  )
  const rowById = React.useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  )
  // Reordering is refused for a single row, in a read-only state, and while the
  // fixture is not ready — the same conditions the notebook applies.
  const canReorder = scenario.state === 'ready' && rows.length > 1
  const reorder = useNotebookBlockReorder({
    ids: order,
    enabled: canReorder,
    onMove: (id, targetIndex) => {
      setOrder((current) => moveTo(current, id, targetIndex))
    },
  })

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div
      // The notebook's grip handle lives in the row's negative left margin
      // (`-left-8`), so the list carries the gutter the document page would
      // give it; without it the handle is clipped and cannot be grabbed.
      className="flex flex-col pl-9"
      data-comparison-list="ours"
      data-reorder-mechanism="html5-drag-and-drop"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {order.map((id) => {
        const row = rowById.get(id)
        if (!row) return null
        const drag = reorder.handleProps(id)
        const indicator = dropIndicatorFor(reorder.dropTarget, id)
        return (
          <React.Fragment key={id}>
            {indicator === 'above' ? (
              <DropIndicatorLine position="above" />
            ) : null}
            <div
              role="group"
              tabIndex={canReorder ? 0 : undefined}
              aria-label={
                canReorder
                  ? `${row.name} — Alt+Arrow keys move this row`
                  : row.name
              }
              className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-row-id={row.id}
              data-state={reorder.draggingId === id ? 'dragging' : undefined}
              onKeyDown={(event) => {
                if (!event.altKey || !canReorder) return
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  reorder.moveByOne(id, 'up')
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  reorder.moveByOne(id, 'down')
                }
              }}
              {...reorder.rowProps(id)}
            >
              <NotebookBlock
                label={row.kind ?? 'Row'}
                state={canReorder ? 'default' : 'read-only'}
                ariaLabel={`${row.name} row`}
                draggable={drag.draggable}
                onDragStart={drag.onDragStart}
                onDragEnd={drag.onDragEnd}
                className={reorder.draggingId === id ? 'opacity-60' : undefined}
              >
                <div className="flex items-center gap-3 px-1 py-1.5">
                  <RowContent row={row} />
                </div>
              </NotebookBlock>
            </div>
            {indicator === 'below' ? (
              <DropIndicatorLine position="below" />
            ) : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/**
 * Theirs. `Sortable` owns the order through `onValueChange` — the candidate's
 * own reordering contract — and `SortableItemHandle` carries the `@dnd-kit`
 * listeners that start a pointer, touch or keyboard drag.
 */
function ReuiSortableColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [order, setOrder] = React.useState<readonly ComparisonRow[]>(rows)
  const canReorder = scenario.state === 'ready' && rows.length > 1

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div
      className="flex flex-col"
      data-comparison-list="theirs"
      data-reorder-mechanism="dnd-kit"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      <Sortable
        value={[...order]}
        onValueChange={(next) => setOrder(next)}
        getItemValue={(row) => row.id}
        strategy="vertical"
        render={<ul />}
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {order.map((row) => (
          <SortableItem
            key={row.id}
            value={row.id}
            disabled={!canReorder}
            render={<li />}
            role="listitem"
            tabIndex={-1}
            data-row-id={row.id}
            className="rounded-lg border border-transparent bg-surface outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-3 px-3 py-2">
              <SortableItemHandle
                render={<button type="button" />}
                aria-label={`Reorder ${row.name}`}
                className="shrink-0 rounded p-0.5 text-fg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon name="move" size={14} />
              </SortableItemHandle>
              <RowContent row={row} />
            </div>
          </SortableItem>
        ))}
      </Sortable>
    </div>
  )
}

export const notebookSortablePair: ComparisonPair = {
  id: 'notebook-sortable',
  title: 'Reorderable block list',
  job: 'Reorder a list of rows by pointer and by keyboard',
  controls: ['reorder'],
  ours: {
    id: 'ours',
    label: 'Ours — notebook HTML5 drag-and-drop',
    source: 'src/components/notebook/notebook-block-reorder.tsx',
    Column: NotebookReorderColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — ReUI sortable (base-nova)',
    source: 'src/components/reui/sortable.tsx (registry: @reui/sortable)',
    Column: ReuiSortableColumn,
  },
}
