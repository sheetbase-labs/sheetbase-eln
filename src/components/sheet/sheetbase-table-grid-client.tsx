import { Spreadsheet } from '@sheetbase-labs/sheetbase-table'
import type { SpreadsheetHandle } from '@sheetbase-labs/sheetbase-table'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

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
import type { SheetbaseGridProps } from './sheetbase-grid'

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

  const layoutRef = useRef(layout)
  useLayoutEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const annotations = useGridAnnotations(props.annotations, layout, handleRef)
  const handleReady = useGridHandle(handleRef, props.onReady)
  const customEditors = useGridEditors(props.onOpenRecordPicker, layout)
  const clipboard = useMemo(() => gridClipboard(props), [props])
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
      frozenColumns={props.frozenColumns}
      initialColumnWidths={widths}
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
      cellDisplays={props.cellDisplays}
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
