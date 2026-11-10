import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GridOperationCoordinator } from '#/lib/grid-operation-coordinator'
import type { SaveStatus } from '#/lib/grid-operation-coordinator'
import {
  scientificDataClient,
  scientificQueryKeys,
} from '#/lib/scientific-sheet-data'
import type {
  FormulaDefinitionWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificWorkbook,
  WorkbookCellAddress,
} from '#/lib/scientific-workbook'
import type { SheetbaseGridCellValue } from './sheetbase-grid'
import { cachePersistedFormula } from './scientific-sheet-formulas'

export interface ScientificDraftCell {
  rowIndex: number
  rowId: string | null
  columnId: string
  fieldName: string
  raw: SheetbaseGridCellValue
  generation: number
}

/** Stable write callbacks see committed state, never a speculative render. */
export function useScientificEditCoordinator({
  tableId,
  table,
  readOnly,
  formulaByCell,
  workbook,
  onCalculate,
  setSelected,
  setDrafts,
  setIssues,
  setSaveStatus,
}: {
  tableId: string
  table: ScientificTableWire | null | undefined
  readOnly: boolean
  formulaByCell: Map<string, FormulaDefinitionWire>
  workbook: ScientificWorkbook | null
  onCalculate: (reconcileRows: boolean) => Promise<void>
  setSelected: Dispatch<SetStateAction<WorkbookCellAddress | null>>
  setDrafts: Dispatch<SetStateAction<Record<string, ScientificDraftCell>>>
  setIssues: (issues: Array<{ key: string; message: string }>) => void
  setSaveStatus: (status: SaveStatus) => void
}) {
  const queryClient = useQueryClient()

  const latest = useRef({
    table,
    readOnly,
    formulaByCell,
    workbook,
    onCalculate,
  })

  useLayoutEffect(() => {
    latest.current = { table, readOnly, formulaByCell, workbook, onCalculate }
  })

  const allRowsKey = useMemo(
    () => scientificQueryKeys.allRows(tableId),
    [tableId],
  )

  const recalculate = useCallback(
    (reconcileRows: boolean) => latest.current.onCalculate(reconcileRows),
    [],
  )

  const cacheFormula = useCallback(
    (target: WorkbookCellAddress, source: string | null) => {
      const state = latest.current

      // Construct the artifact before the cache updater: workbook writes are
      // event-time commands, not side effects of a replayable React updater.
      const next = cachePersistedFormula({
        previous:
          queryClient.getQueryData<FormulaDefinitionWire[]>(
            scientificQueryKeys.formulas(tableId),
          ) ?? [],
        target,
        source,
        table: state.table ?? null,
        rows: queryClient.getQueryData<ScientificRowWire[]>(allRowsKey) ?? [],
        workbook: state.workbook,
      })

      queryClient.setQueryData(scientificQueryKeys.formulas(tableId), next)
    },
    [queryClient, tableId, allRowsKey],
  )

  const coordinator = useMemo(() => {
    const replacedRows = new Map<string, string>()

    return new GridOperationCoordinator({
      client: scientificDataClient,
      coalesceMs: 300,
      getCanonicalRows: () =>
        queryClient.getQueryData<ScientificRowWire[]>(allRowsKey) ?? [],
      getFormulaByCell: () => latest.current.formulaByCell,
      getTable: () => latest.current.table ?? null,
      isReadOnly: () => latest.current.readOnly,
      onRowsUpdated: (rows) =>
        queryClient.setQueryData<ScientificRowWire[]>(
          allRowsKey,
          (old = []) => {
            const map = new Map(old.map((row) => [row.id, row]))

            for (const row of rows) map.set(row.id, row)

            return [...map.values()]
          },
        ),
      onProvisionalRowReplaced: (provisionalId, realId) => {
        replacedRows.set(provisionalId, realId)
        queryClient.setQueryData<ScientificRowWire[]>(allRowsKey, (old = []) =>
          old.map((row) =>
            row.id === provisionalId ? { ...row, id: realId, version: 1 } : row,
          ),
        )
        setSelected((current) =>
          current?.rowId === provisionalId
            ? { ...current, rowId: realId }
            : current,
        )
        setDrafts((current) => {
          const prefix = `${provisionalId}:`
          let changed = false
          const next: typeof current = {}

          for (const [key, value] of Object.entries(current)) {
            if (key.startsWith(prefix)) {
              // Both the dictionary key and draft identity follow the real row.
              next[`${realId}:${key.slice(prefix.length)}`] = {
                ...value,
                rowId: realId,
              }
              changed = true
            } else {
              next[key] = value
            }
          }

          return changed ? next : current
        })
      },
      onDraftsCleared: (cells) =>
        setDrafts((current) => {
          const next = { ...current }

          for (const cell of cells) {
            const rowId = cell.rowId
              ? (replacedRows.get(cell.rowId) ?? cell.rowId)
              : `new:${cell.rowIndex}`

            const key = `${rowId}:${cell.columnId}`

            if (
              Object.hasOwn(next, key) &&
              next[key].generation === cell.generation
            )
              delete next[key]
          }

          return next
        }),
      onIssues: setIssues,
      onStatusChange: setSaveStatus,
      onCalculationNeeded: (reconcileRows) => void recalculate(reconcileRows),
      onRefetchRows: () =>
        void queryClient.invalidateQueries({ queryKey: allRowsKey }),
      onFormulaPersisted: cacheFormula,
    })
  }, [
    queryClient,
    allRowsKey,
    setSelected,
    setDrafts,
    setIssues,
    setSaveStatus,
    recalculate,
    cacheFormula,
  ])

  useEffect(() => () => coordinator.destroy(), [coordinator])
  useEffect(() => {
    if (readOnly) return

    const handler = (event: BeforeUnloadEvent) => {
      if (!coordinator.hasPendingEdits()) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handler)

    return () => window.removeEventListener('beforeunload', handler)
  }, [coordinator, readOnly])

  return { coordinator, cacheFormula, recalculate }
}
