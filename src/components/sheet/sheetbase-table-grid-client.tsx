import { Spreadsheet } from '@sheetbase-labs/sheetbase-table'
import type { SpreadsheetHandle } from '@sheetbase-labs/sheetbase-table'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentProps } from 'react'

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
import { sanitizeSvg } from '#/lib/extensions/screens'
import type {
  CellDisplays,
  CellDisplaySpec,
} from '#/lib/extensions/cell-display'
import type { SheetbaseGridProps } from './sheetbase-grid'

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

  return (
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
  )
}

export const SheetbaseTableGridClient = memo(SheetbaseTableGridClientBase)
