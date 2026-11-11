import { Spreadsheet } from '@sheetbase-labs/sheetbase-table'
import type { SpreadsheetHandle } from '@sheetbase-labs/sheetbase-table'
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentProps, ReactNode } from 'react'

import { useGridAnnotations } from './grid-client-annotations'
import { gridClipboard } from './grid-client-clipboard'
import { useGridEditors } from './grid-client-editors'
import { useGridHandle } from './grid-client-handle'
import { buildCellMap, useGridLayout } from './grid-client-layout'
import {
  captureGridFilters,
  gridMenuActions,
  gridQuery,
  gridSelection,
} from './grid-client-presentation'
import { gridWrites } from './grid-client-writes'
import { t } from '#/copy'
import { sanitizeSvg } from '#/lib/extensions/screens'
import type {
  CellDisplays,
  CellDisplaySpec,
} from '#/lib/extensions/cell-display'
import type { SheetbaseGridColumn, SheetbaseGridProps } from './sheetbase-grid'

/** The engine's own cell-display map, which its props accept. */
type EngineCellDisplays = NonNullable<
  ComponentProps<typeof Spreadsheet>['cellDisplays']
>

type EngineCellDisplay = EngineCellDisplays[string]

/**
 * The engine wants a tone for every value a display lists; a plugin's decoded
 * display may list a value without one, which the engine reads as "no tone".
 * Keeping only the stated tones makes the two contracts equal.
 */
function engineCellDisplay(spec: CellDisplaySpec): EngineCellDisplay {
  if (spec.kind !== 'badge') return spec

  const tones: Extract<EngineCellDisplay, { kind: 'badge' }>['tones'] = {}

  for (const value of Object.keys(spec.tones)) {
    const tone = spec.tones[value]

    if (tone !== undefined) tones[value] = tone
  }

  return { ...spec, tones }
}

function engineCellDisplays(displays: CellDisplays | undefined) {
  if (!displays) return undefined

  const out: Record<string, EngineCellDisplay> = {}

  for (const [columnId, spec] of Object.entries(displays))
    out[columnId] = engineCellDisplay(spec)

  return out
}

/** Phone-width grids: the width below which columns narrow and one pins. */
const NARROW_GRID_QUERY = '(max-width: 640px)'

/** A phone column fits three across beside the row numbers. */
const NARROW_COLUMN_WIDTH = 116

function isNarrowGrid(): boolean {
  if (typeof window === 'undefined' || !('matchMedia' in window)) return false

  return window.matchMedia(NARROW_GRID_QUERY).matches
}

/**
 * On a phone, columns the sheet has not sized fit three across, and the first
 * column stays in view while the rest scroll under it.
 */
function narrowGridLayout(
  widths: readonly number[] | undefined,
  columnCount: number,
  frozenColumns: number | undefined,
) {
  if (!isNarrowGrid()) return { widths, frozenColumns }

  return {
    widths: Array.from(
      { length: columnCount },
      (_, index) => widths?.[index] ?? NARROW_COLUMN_WIDTH,
    ),
    frozenColumns: frozenColumns || (columnCount > 1 ? 1 : 0),
  }
}

function resolvedGridTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'

  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

type CellRenderContext = Parameters<
  NonNullable<ComponentProps<typeof Spreadsheet>['renderCell']>
>[0]

/** A unit after a number ("9.8 NTU"); an exponent ("× 10¹¹") is not one. */
const TRAILING_UNIT = /^(.*\d.*?)\s+([^\s\d×.+\-⁰¹²³⁴⁵⁶⁷⁸⁹][^\s]*)$/u

/**
 * A number reads right-aligned, its unit smaller and muted after it, so the
 * digits line up down the column.
 */
function numberCell(display: string): ReactNode {
  if (display === '') return undefined

  return <span className="sheet-cell-number">{numberParts(display)}</span>
}

/** The digits, then the unit smaller and muted. */
function numberParts(display: string): ReactNode {
  const match = TRAILING_UNIT.exec(display)

  if (!match) return display

  return (
    <>
      {match[1]}
      <span className="sheet-cell-unit">{match[2]}</span>
    </>
  )
}

/** "8.9 NTU" before "12.8 NTU" reads "8.9": the unit is said once. */
function withoutSharedUnit(before: string, after: string): string {
  const was = TRAILING_UNIT.exec(before)
  const now = TRAILING_UNIT.exec(after)

  return was && now && was[2] === now[2] ? was[1] : before
}

/** A changed cell's save mark; a failed one retries when clicked. */
function WriteMark({
  mark,
}: {
  mark: { state: 'saved' | 'saving' | 'failed'; retry?: () => void }
}) {
  const label = {
    saved: t('notebook.sheetChanges.markSaved'),
    saving: t('notebook.sheetChanges.markSaving'),
    failed: t('notebook.sheetChanges.markFailed'),
  }[mark.state]

  if (mark.state === 'failed' && mark.retry) {
    const { retry } = mark

    return (
      <button
        type="button"
        className="sheet-write-mark"
        data-write-mark="failed"
        aria-label={label}
        title={label}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          retry()
        }}
      />
    )
  }

  return (
    <span
      className="sheet-write-mark"
      data-write-mark={mark.state}
      role="img"
      aria-label={label}
      title={label}
    />
  )
}

/** The spreadsheet's column letter for a position: 0 → A, 26 → AA. */
function columnLetter(index: number): string {
  let letters = ''

  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCodePoint(65 + ((n - 1) % 26)) + letters

  return letters
}

/**
 * Per-column looks the engine has no hook for: number headers sit right,
 * over their digits, and calculated columns carry the derived tint and an
 * ƒx mark. Cells are found by their column index, headers by their column
 * letter.
 */
function columnLookCss(
  scope: string,
  columns: readonly SheetbaseGridColumn[],
): string {
  const root = `[data-grid-columns="${scope}"]`

  return columns
    .flatMap((column, index) => {
      const rules: string[] = []
      const header = `${root} [role="columnheader"][aria-label^="${columnLetter(index)} "]`
      const cells = `${root} [role="gridcell"][aria-colindex="${index + 1}"]`

      if (column.type === 'number')
        rules.push(
          `${header} .column-heading{margin-left:auto;text-align:right}`,
        )

      // The board's ƒx mark: a calculated column says so in its header. With
      // source badges on, the engine's own ƒx badge already does.
      if (column.source === 'calculated' && column.showSource === false)
        rules.push(
          `${header} .column-heading::after{content:"ƒx";margin-left:6px;font-size:11px;font-style:italic;font-weight:400;color:var(--color-fg-muted)}`,
        )

      if (column.source === 'calculated')
        rules.push(
          `${cells}:not(.selected):not(.cell-flagged){background:var(--surface-derived);color:var(--color-fg-muted)}`,
        )

      return rules
    })
    .join('\n')
}

/**
 * Bound engine composition. The host owns record identity and persistence;
 * local sorting/filtering changes display coordinates, never stored rows.
 */
function SheetbaseTableGridClientBase(props: SheetbaseGridProps) {
  const { columns, rows, sorts, filters } = props
  const handleRef = useRef<SpreadsheetHandle | null>(null)
  const widthsRef = useRef<readonly number[] | null>(null)

  const {
    layout,
    datasetHeader,
    widths,
    initialData,
    fieldIds,
    columnGroups,
    mountKey,
  } = useGridLayout(props)

  // Read once per mount, like the engine's own initial widths.
  const narrow = useMemo(
    () => narrowGridLayout(widths, props.columns.length, props.frozenColumns),
    [widths, props.columns.length, props.frozenColumns],
  )

  const layoutRef = useRef(layout)
  useLayoutEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const annotations = useGridAnnotations(props.annotations, layout, handleRef)
  const handleReady = useGridHandle(handleRef, props.onReady)
  const customEditors = useGridEditors(props.onOpenRecordPicker, layout)
  const clipboard = useMemo(() => gridClipboard(props), [props])

  const cellDisplays = useMemo(
    () => engineCellDisplays(props.cellDisplays),
    [props.cellDisplays],
  )

  const writes = useMemo(() => gridWrites(props, layout), [props, layout])

  const { cellBefore, cellMark } = props

  // Show changes: a changed cell shows its old value struck through and its
  // own save mark. Plain cells keep the engine's fast path.
  const renderCell = useMemo(
    () =>
      ({ point, display }: CellRenderContext) => {
        const column = layout.columns.at(point.column)
        const columnId = column?.id ?? ''
        const before = cellBefore?.(point.row, columnId)
        const mark = cellMark?.(point.row, columnId)

        const value =
          before === undefined ? (
            column?.type === 'number' ? (
              numberCell(display)
            ) : undefined
          ) : (
            // The new value comes first so a narrow cell drops the old one
            // whole instead of cutting it (the change list keeps it).
            <span
              className="sheet-cell-change"
              data-number={column?.type === 'number' || undefined}
            >
              <span>
                {column?.type === 'number' ? numberParts(display) : display}
              </span>
              <del>{withoutSharedUnit(before, display)}</del>
            </span>
          )

        if (!mark) return value

        return (
          <span className="sheet-cell-marked">
            <span
              className="sheet-cell-marked-value"
              data-number={column?.type === 'number' || undefined}
            >
              {value ?? display}
            </span>
            <WriteMark mark={mark} />
          </span>
        )
      },
    [cellBefore, cellMark, layout],
  )

  const query = useMemo(
    () => gridQuery({ columns, sorts, filters }),
    [columns, sorts, filters],
  )

  const contextMenuActions = useMemo(
    () => gridMenuActions(props.contextMenuItems, layout),
    [props.contextMenuItems, layout],
  )

  const columnMenuItems = useMemo(
    () => gridMenuActions(props.columnMenuItems, layout, true),
    [props.columnMenuItems, layout],
  )

  // initialData is mount-only in the engine. Persisted host data replaces the
  // live store after commit, never by mutating render-time refs. Metadata-only
  // rerenders must not overwrite edits waiting for the host's persistence.
  useEffect(() => {
    const current = layoutRef.current
    handleRef.current?.replaceData(buildCellMap(current.rows, current.columns))
  }, [rows, mountKey])

  const gridScope = useId().replaceAll(':', '')

  const columnLook = useMemo(
    () => columnLookCss(gridScope, layout.columns),
    [gridScope, layout],
  )

  return (
    <div className="contents" data-grid-columns={gridScope}>
      <style>{columnLook}</style>
      <Spreadsheet
        key={mountKey}
        ref={handleRef}
        initialData={initialData}
        {...annotations}
        {...writes}
        rowCount={props.rows.length + (props.spareRows ?? 0)}
        columnCount={props.columns.length}
        columnGroups={columnGroups}
        appendRow={props.appendRow}
        fieldIds={fieldIds}
        datasetHeader={datasetHeader}
        readOnly={props.readOnly ?? false}
        rowHeaders={props.rowHeaders}
        height={props.height}
        stretch={props.stretch}
        frozenColumns={narrow.frozenColumns}
        initialColumnWidths={narrow.widths}
        theme={resolvedGridTheme()}
        cellState={
          props.cellState
            ? (row, column) =>
                props.cellState?.(row, layout.columns.at(column)?.id ?? '')
            : undefined
        }
        contextMenuActions={contextMenuActions}
        columnMenuItems={columnMenuItems}
        customEditors={customEditors}
        cellDisplays={cellDisplays}
        renderCell={renderCell}
        sanitizeSvg={sanitizeSvg}
        clipboard={clipboard}
        query={query}
        onReady={(handle) => {
          widthsRef.current = handle.snapshot().columnWidths
          handleReady(handle)
        }}
        sortMode="local"
        onSortChange={(next) =>
          props.onSortsChange?.(
            next.map((sort) => ({
              columnId: sort.fieldId,
              direction: sort.direction,
            })),
          )
        }
        onFiltersChange={(next) =>
          props.onFiltersChange?.(captureGridFilters(next, props))
        }
        onSelectionChange={(selection) =>
          props.onSelectionChange?.(
            gridSelection(selection, layout, handleRef.current, query),
          )
        }
        onColumnWidthsChange={(next) => {
          const previous = widthsRef.current
          widthsRef.current = [...next]

          if (!previous) return
          next.forEach((width, index) => {
            const definition = layout.columns.at(index)

            if (definition && previous[index] !== width)
              props.onColumnResize?.(definition.id, width)
          })
        }}
        onColumnMove={(from, to) => {
          const order = layout.columns.map((column) => column.id)
          const moved = order.splice(from, 1).at(0)

          if (moved === undefined) return
          order.splice(to, 0, moved)
          props.onColumnOrderChange?.(order)
        }}
      />
    </div>
  )
}

export const SheetbaseTableGridClient = memo(SheetbaseTableGridClientBase)
