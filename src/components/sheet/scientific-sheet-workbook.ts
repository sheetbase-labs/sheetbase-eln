import { useMemo } from 'react'
import { t } from '#/copy'
import { useNotebookScientificWorkbook } from '#/components/notebook/scientific-workbook-provider'
import type {
  FormulaDefinitionWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import type { WorkbookCell, WorkbookTable } from '#/lib/scientific-workbook'
import type { SheetbaseGridCellValue } from './sheetbase-grid'
import { persistedFormula } from './scientific-sheet-formulas'
import { displayResult, safeWorkbookGet } from './scientific-sheet-presentation'

export interface ScientificDisplayRow {
  id?: string
  [field: string]: SheetbaseGridCellValue | undefined
}

/** Canonical data only. Draft edits must never replace the active grid data. */
export function useScientificSheetWorkbook({
  blockId,
  tableId,
  table,
  rows,
  formulas,
  failed,
}: {
  blockId: string
  tableId: string
  table: ScientificTableWire | null | undefined
  rows: ScientificRowWire[] | undefined
  formulas: FormulaDefinitionWire[] | undefined
  failed: boolean
}) {
  const formulaByCell = useMemo(
    () =>
      new Map(
        (formulas ?? []).map((formula) => [
          `${formula.target_row_id}/${formula.target_column_id}`,
          formula,
        ]),
      ),
    [formulas],
  )

  const workbookTable = useMemo<WorkbookTable | null>(() => {
    if (!table || !rows || !formulas || rows.length > 10_000) return null

    try {
      return {
        id: table.id,
        name: table.name,
        columns: table.columns.map((column) => ({
          id: column.id,
          label: column.label,
          createdAt:
            column.created_at ?? table.created_at ?? '1970-01-01T00:00:00Z',
          logicalType: column.logical_type,
          categoryOptionIds: column.options.map((option) => option.id),
        })),
        rows: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at ?? '1970-01-01T00:00:00Z',
          cells: Object.fromEntries(
            table.columns.map((column) => {
              const formula = formulaByCell.get(`${row.id}/${column.id}`)
              const cell: WorkbookCell = { literal: row[column.field_name] }

              if (formula) cell.formula = persistedFormula(formula)

              return [column.id, cell]
            }),
          ),
        })),
      }
    } catch {
      // Invalid persisted artifacts disable calculation, not literal access.
      return null
    }
  }, [table, rows, formulas, formulaByCell])

  const workbook = useNotebookScientificWorkbook(blockId, workbookTable)
  const tableWorkbook = workbook?.hasTable(tableId) ? workbook : null

  const calculationProblem =
    (rows?.length ?? 0) > 10_000
      ? t('notebook.scientificSheetBlock.calculationIsUnavailableBecause')
      : failed
        ? t('notebook.scientificSheetBlock.calculationDataCouldNot')
        : formulas && rows && !workbookTable
          ? t('notebook.scientificSheetBlock.persistedFormulaDataIs')
          : null

  const gridData = useMemo(() => {
    const detached: ScientificDisplayRow[] = (rows ?? []).map((row) => {
      const copy = { ...row }

      for (const column of table?.columns ?? []) {
        if (column.logical_type !== 'category') continue
        copy[column.field_name] =
          column.options.find((option) => option.id === row[column.field_name])
            ?.label ?? row[column.field_name]
      }

      return copy
    })

    for (const row of detached) {
      if (!row.id) continue

      for (const column of table?.columns ?? []) {
        const formula = formulaByCell.get(`${row.id}/${column.id}`)

        if (!formula) continue

        // Same-sheet expressions stay in the grid for formula-aware autofill
        // and copy/paste; only the notebook engine resolves cross-sheet data.
        if (
          formula.status === 'supported' &&
          formula.engine_expression &&
          !formula.engine_expression.includes('!')
        ) {
          row[column.field_name] = formula.engine_expression
        } else if (tableWorkbook) {
          row[column.field_name] = displayResult(
            safeWorkbookGet(tableWorkbook, {
              tableId,
              rowId: row.id,
              columnId: column.id,
            }),
          )
        }
      }
    }

    return detached
  }, [rows, table, formulaByCell, tableWorkbook, tableId])

  return { formulaByCell, tableWorkbook, calculationProblem, gridData }
}
