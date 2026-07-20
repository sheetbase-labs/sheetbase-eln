import { DetailedCellError } from 'hyperformula'
import type {
  CellValue,
  ExportedChange,
  HyperFormula,
  RawCellContent,
} from 'hyperformula'
import {
  emitFormula,
  parseFormula,
  validatePersistedFormulaArtifact,
} from './formula-ir'
import type {
  FormulaArtifact,
  FormulaMaps,
  PersistedFormulaArtifact,
} from './formula-ir'
import { createSheetbaseHyperFormula } from './hyperformula-profile'
import {
  decodeScientificResult,
  encodeScientificLiteral,
} from './hyperformula-literals'
import type { LiteralCodecResult } from './hyperformula-literals'
import type { ScientificLogicalType } from './scientific-sheet-data'

export interface WorkbookColumn {
  id: string
  createdAt: string | Date
  logicalType: ScientificLogicalType
  categoryOptionIds?: readonly string[]
}
export interface WorkbookCell {
  literal?: unknown
  /** Untrusted persisted JSON; validated recursively before engine use. */
  formula?: unknown
}
export interface WorkbookRow {
  id: string
  createdAt: string | Date
  cells: Readonly<Record<string, WorkbookCell | undefined>>
}
export interface WorkbookTable {
  id: string
  columns: readonly WorkbookColumn[]
  rows: readonly WorkbookRow[]
}
export interface WorkbookCellAddress {
  tableId: string
  rowId: string
  columnId: string
}
export type WorkbookResult =
  | {
      status: 'literal' | 'formula'
      source?: string
      engineFormula?: string
      value: CellValue | null
      logical: LiteralCodecResult
    }
  | {
      status: 'error'
      source?: string
      engineFormula?: string
      error: string
      message: string
    }

export function scientificSheetName(tableId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tableId,
    )
  )
    throw new Error('Scientific table IDs must be UUIDs.')
  return `sb_${tableId.toLowerCase().replaceAll('-', '')}`
}
const ERROR_CODES: Record<string, string> = {
  DIV_BY_ZERO: 'DIV_BY_ZERO',
  CYCLE: 'CYCLE',
  REF: 'REF',
  NAME: 'NAME',
  VALUE: 'VALUE',
  NUM: 'NUM',
  NA: 'NA',
  SPILL: 'SPILL',
  LIC: 'LIC',
  ERROR: 'ERROR',
}

export class ScientificWorkbook {
  readonly engine: HyperFormula
  private readonly tables = new Map<string, WorkbookTable>()
  private readonly sheetIds = new Map<string, number>()
  private readonly formulas = new Map<
    string,
    PersistedFormulaArtifact | FormulaArtifact
  >()
  constructor(tables: readonly WorkbookTable[]) {
    this.engine = createSheetbaseHyperFormula()
    for (const table of tables) {
      const stable = <T extends { id: string; createdAt: string | Date }>(
        values: readonly T[],
      ) =>
        [...values].sort((a, b) =>
          `${new Date(a.createdAt).toISOString()}/${a.id}`.localeCompare(
            `${new Date(b.createdAt).toISOString()}/${b.id}`,
          ),
        )
      this.installTable({
        ...table,
        rows: stable(table.rows),
        columns: stable(table.columns),
      })
    }
  }
  private key(address: WorkbookCellAddress) {
    return `${address.tableId}/${address.rowId}/${address.columnId}`
  }
  private maps(table: WorkbookTable): FormulaMaps {
    return {
      rowIds: table.rows.map((r) => r.id),
      columnIds: table.columns.map((c) => c.id),
    }
  }
  private installTable(table: WorkbookTable) {
    if (table.rows.length > 10_000 || table.columns.length > 256)
      throw new Error(
        'Table is unavailable for calculation: profile dimensions exceeded.',
      )
    const sheetName = scientificSheetName(table.id)
    this.engine.addSheet(sheetName)
    const sheetId = this.engine.getSheetId(sheetName)
    if (sheetId === undefined)
      throw new Error('HyperFormula did not create the sheet.')
    this.tables.set(table.id, table)
    this.sheetIds.set(table.id, sheetId)
    const maps = this.maps(table)
    const content: RawCellContent[][] = table.rows.map((row) =>
      table.columns.map((column) => {
        const cell = row.cells[column.id]
        if (cell?.formula) {
          const formula = validatePersistedFormulaArtifact(cell.formula)
          this.formulas.set(
            this.key({ tableId: table.id, rowId: row.id, columnId: column.id }),
            formula,
          )
          // Unsupported artifacts remain durable and visible to callers, but
          // must never be interpreted by a calculation engine on reload.
          return formula.status === 'supported'
            ? emitFormula(formula, maps)
            : encodeScientificLiteral(column.logicalType, cell.literal)
        }
        return encodeScientificLiteral(column.logicalType, cell?.literal)
      }),
    )
    if (content.length && content[0]?.length)
      this.engine.setSheetContent(sheetId, content)
  }
  private locate(address: WorkbookCellAddress) {
    const table = this.tables.get(address.tableId)
    if (!table) throw new Error('Unknown table.')
    const row = table.rows.findIndex((item) => item.id === address.rowId),
      column = table.columns.findIndex((item) => item.id === address.columnId)
    const sheet = this.sheetIds.get(address.tableId)
    if (row < 0 || column < 0 || sheet === undefined)
      throw new Error('Unknown stable cell identity.')
    return {
      table,
      row,
      column,
      sheet,
      logicalType: table.columns[column].logicalType,
    }
  }
  get(address: WorkbookCellAddress): WorkbookResult {
    const location = this.locate(address),
      hfAddress = {
        sheet: location.sheet,
        row: location.row,
        col: location.column,
      }
    const value = this.engine.getCellValue(hfAddress),
      formula = this.formulas.get(this.key(address)),
      engineFormula = this.engine.getCellFormula(hfAddress) ?? undefined
    if (value instanceof DetailedCellError)
      return {
        status: 'error',
        source: formula?.source,
        engineFormula,
        error: ERROR_CODES[value.type] ?? 'ERROR',
        message: value.message,
      }
    return {
      status: formula ? 'formula' : 'literal',
      source: formula?.source,
      engineFormula,
      value,
      logical: decodeScientificResult(
        location.logicalType,
        value,
        location.table.columns[location.column].categoryOptionIds,
      ),
    }
  }
  setLiteral(address: WorkbookCellAddress, value: unknown): ExportedChange[] {
    const location = this.locate(address)
    this.formulas.delete(this.key(address))
    return this.engine.setCellContents(
      { sheet: location.sheet, row: location.row, col: location.column },
      [[encodeScientificLiteral(location.logicalType, value)]],
    )
  }
  setFormula(
    address: WorkbookCellAddress,
    source: string,
  ):
    | {
        status: 'supported'
        artifact: FormulaArtifact
        changes: ExportedChange[]
      }
    | {
        status: 'unsupported'
        artifact: FormulaArtifact
        functionIds: string[]
      } {
    const location = this.locate(address),
      parsed = parseFormula(source, this.maps(location.table))
    if (parsed.status === 'unsupported')
      return {
        status: 'unsupported',
        artifact: parsed.artifact,
        functionIds: parsed.functionIds,
      }
    const artifact = parsed.artifact
    const changes = this.engine.setCellContents(
      { sheet: location.sheet, row: location.row, col: location.column },
      [[artifact.engineExpression]],
    )
    // Real-target normalization is a compatibility check, not persisted meaning.
    if (
      !this.engine.getCellFormula({
        sheet: location.sheet,
        row: location.row,
        col: location.column,
      })
    )
      throw new Error('HyperFormula rejected the normalized expression.')
    this.formulas.set(this.key(address), artifact)
    return { status: 'supported', artifact, changes }
  }
  getChangedResults(changes: readonly ExportedChange[]) {
    return changes.flatMap((change) => {
      if (!('address' in change)) return []
      const tableId = [...this.sheetIds].find(
        ([, sheet]) => sheet === change.address.sheet,
      )?.[0]
      if (!tableId) return []
      const table = this.tables.get(tableId)!
      const rowId = table.rows[change.address.row]?.id,
        columnId = table.columns[change.address.col]?.id
      return rowId && columnId
        ? [
            {
              address: { tableId, rowId, columnId },
              result: this.get({ tableId, rowId, columnId }),
            },
          ]
        : []
    })
  }
  destroy() {
    this.engine.destroy()
  }
}
export function buildScientificWorkbook(tables: readonly WorkbookTable[]) {
  return new ScientificWorkbook(tables)
}
