import * as React from 'react'

import { Icon } from '#/components/v3/icons'
import {
  NotebookBlockHandle,
  NotebookBlockList,
  NotebookBlockRow,
  moveTargetIndex,
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
 * The comparison that decided this adoption ran the notebook's hand-rolled
 * HTML5 drag-and-drop against ReUI's sortable item and is recorded, with its
 * measurements and its conditions C1–C4, in
 * `docs/knowledge/design/component-comparison-record.md` row 1. The notebook
 * then adopted the item (workstream B2 of
 * `docs/knowledge/design/notebook-editor-and-reui.html`), so the two columns no longer differ in
 * *mechanism*; what they differ in is *integration*.
 *
 * Ours: the notebook's list as it now ships —
 * `NotebookBlockList`/`NotebookBlockRow`/`NotebookBlockHandle`, the same
 * modules `notebook-document.tsx` renders, in the notebook's own row frame.
 * The row is a labelled group whose single drag control is the grip handle, and
 * the handle is rendered at every width so that a touchscreen has a route to a
 * reorder. This column is what keeps the adoption honest: it measures the
 * shipped integration against the item as published.
 *
 * Theirs: the registry item as published, with the one integration fix-up the
 * adoption's condition C1 requires — the item puts `@dnd-kit`'s widget role and
 * tab stop on the row container while the drag listeners sit on the handle
 * inside it, and rendering the handle as a real button (which the keyboard
 * sensor needs) turns every row into a widget containing a control, which axe
 * reports as `nested-interactive` (serious). The reference column hands the
 * container the list's own semantics and keeps the handle as the single
 * control. Both halves of that measurement are pinned against the vendored item
 * unchanged by `component-compare.a11y.test.tsx`, "the candidate rules or not on
 * how its handle is rendered (C1)".
 *
 * Neither column reproduces the original HTML5 implementation: that revision is
 * `35423ec2` of this branch, and its reproduction is its own pair and its own
 * row in the record.
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
 * own optimistic-then-persist path belongs to the route. Everything else — the
 * list, the row's semantics, the handle and the keyboard path — is the shipped
 * module.
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

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div
      // The notebook's grip handle lives in the row's negative left margin
      // (`-left-8`), so the list carries the gutter the document page would
      // give it on a wide viewport; without it the handle is clipped and cannot
      // be grabbed. Below `lg` the row supplies that space itself.
      className="flex flex-col lg:pl-9"
      data-comparison-list="ours"
      data-reorder-mechanism="dnd-kit"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      <NotebookBlockList
        ids={order}
        onMove={(id, targetIndex) => {
          setOrder((current) => moveTo(current, id, targetIndex))
        }}
      >
        {order.map((id) => {
          const row = rowById.get(id)
          if (!row) return null
          return (
            <NotebookBlockRow
              key={id}
              itemId={id}
              enabled={canReorder}
              handle={canReorder ? <NotebookBlockHandle /> : undefined}
              row={{
                'data-row-id': id,
                role: canReorder ? 'group' : undefined,
                tabIndex: canReorder ? 0 : undefined,
                'aria-label': canReorder
                  ? `${row.name} — Alt+Arrow keys move this row`
                  : row.name,
                onKeyDown: (event) => {
                  if (!event.altKey || !canReorder) return
                  const direction =
                    event.key === 'ArrowUp'
                      ? 'up'
                      : event.key === 'ArrowDown'
                        ? 'down'
                        : null
                  if (!direction) return
                  event.preventDefault()
                  const target = moveTargetIndex(order, id, direction)
                  if (target !== null) {
                    setOrder((current) => moveTo(current, id, target))
                  }
                },
              }}
              frame={{
                label: row.kind ?? 'Row',
                state: canReorder ? 'default' : 'read-only',
                ariaLabel: `${row.name} row`,
              }}
            >
              <div className="flex items-center gap-3 px-1 py-1.5">
                <RowContent row={row} />
              </div>
            </NotebookBlockRow>
          )
        })}
      </NotebookBlockList>
    </div>
  )
}

/**
 * Theirs. The item as published, with the C1 semantics fix-up described above:
 * `Sortable` owns the order through `onValueChange` — the candidate's own
 * reordering contract — and `SortableItemHandle` carries the `@dnd-kit`
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
            // `SortableItem` puts `@dnd-kit`'s `role="button"` and
            // `tabindex="0"` on the row container while the drag listeners sit
            // on the handle inside it. With the handle a real button — which it
            // has to be for the keyboard sensor to be reachable at all — that
            // is a widget containing a control, and axe reports
            // `nested-interactive` (serious) for every row. Handing the
            // container the list's own semantics and leaving the handle as the
            // single control is the integration fix-up; it is measured in
            // component-compare.a11y.test.tsx and recorded as condition C1 in
            // docs/knowledge/design/component-comparison-record.md.
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
  job: 'Reorder a list of rows by pointer, touch and keyboard — the notebook’s shipped integration of the registry item against the item as published',
  controls: ['reorder'],
  ours: {
    id: 'ours',
    label: 'Ours — notebook list (ReUI sortable adopted)',
    source: 'src/components/notebook/notebook-block-reorder.tsx',
    Column: NotebookReorderColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Reference — ReUI sortable with the C1 semantics fix-up',
    source: 'src/components/reui/sortable.tsx (registry: @reui/sortable)',
    Column: ReuiSortableColumn,
  },
}
