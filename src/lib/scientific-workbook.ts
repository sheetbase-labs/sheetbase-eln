/**
 * The Scientific calculation workbook, evaluated by the `sheetbase-table`
 * engine — the single calculation model (HyperFormula retired).
 *
 * One `Worksheet` per table; formulas are evaluated lazily through
 * `evaluateFormula` with a resolver that walks cell references across sheets
 * (cross-table references use the quoted `'Sheet'!A1` form emitted by
 * `emitFormula`). A memo cache plus an in-flight trail give deterministic
 * recalculation and global cycle detection.
 *
 * Dates arrive from the literal codec as Excel serial numbers (1899-12-30
 * epoch) and the engine's date functions interpret them with the same
 * convention, matching the retired HyperFormula nullDate configuration.
 */
import {
  compileFormula,
  evaluateFormula,
  Worksheet,
} from 'sheetbase-table/dev'
import type { Scalar } from 'sheetbase-table/dev'
import {
  calculationSheetName,
  emitFormula,
  parseFormula,
  validatePersistedFormulaArtifact,
} from './formula-ir'
import type {
  FormulaArtifact,
  FormulaMaps,
  PersistedFormulaArtifact,
} from './formula-ir'
import {
  decodeScientificResult,
  encodeScientificLiteral,
} from './hyperformula-literals'
/** Excel serial epoch matching the literal codec and the engine's date functions. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
import type { LiteralCodecResult } from './hyperformula-literals'
import type { ScientificLogicalType } from './scientific-sheet-data'

export interface WorkbookColumn {
  id: string
  label?: string
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
  name?: string
  columns: readonly WorkbookColumn[]
  rows: readonly WorkbookRow[]
}
export interface WorkbookCellAddress {
  tableId: string
  rowId: string
  columnId: string
}
/** Shape-compatible stand-in for the retired engine's change records. */
export interface WorkbookChange {
  address: { sheet: number; row: number; col: number }
}
export type WorkbookResult =
  | {
      status: 'literal' | 'formula'
      source?: string
      engineFormula?: string
      value: Scalar | null
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
  return calculationSheetName(tableId)
}

const ERROR_CODES: Partial<Record<string, string>> = {
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

function errorCodeFor(message: string): string {
  if (/Circular|cycle|#CYC!/i.test(message)) return 'CYCLE'
  if (message.startsWith('#DIV/0!')) return 'DIV_BY_ZERO'
  if (message.startsWith('#REF!')) return 'REF'
  if (message.startsWith('#NAME?')) return 'NAME'
  if (message.startsWith('#VALUE!')) return 'VALUE'
  if (message.startsWith('#NUM!')) return 'NUM'
  if (message.startsWith('#N/A')) return 'NA'
  if (message.startsWith('#SPILL!')) return 'SPILL'
  return 'ERROR'
}

export class ScientificWorkbook {
  private readonly tables = new Map<string, WorkbookTable>()
  private readonly sheets = new Map<string, Worksheet>()
  private readonly tableBySheet = new Map<string, string>()
  private readonly sheetNumbers = new Map<string, number>()
  private readonly formulas = new Map<
    string,
    PersistedFormulaArtifact | FormulaArtifact
  >()
  private readonly cache = new Map<string, Scalar>()

  constructor(tables: readonly WorkbookTable[]) {
    const stable = <T extends { id: string; createdAt: string | Date }>(
      values: readonly T[],
    ) =>
      [...values].sort((a, b) =>
        `${new Date(a.createdAt).toISOString()}/${a.id}`.localeCompare(
          `${new Date(b.createdAt).toISOString()}/${b.id}`,
        ),
      )
    const normalized = tables.map((table) => ({
      ...table,
      rows: stable(table.rows),
      columns: stable(table.columns),
    }))
    // Register every engine sheet before installing any formula so a valid
    // reference never depends on notebook block render/registration order.
    for (const table of normalized) {
      if (table.rows.length > 10_000 || table.columns.length > 256)
        throw new Error(
          'Table is unavailable for calculation: profile dimensions exceeded.',
        )
      this.tables.set(table.id, table)
      this.sheets.set(table.id, new Worksheet())
      this.tableBySheet.set(scientificSheetName(table.id), table.id)
      this.sheetNumbers.set(table.id, this.sheetNumbers.size)
    }
    for (const table of normalized) this.installTable(table)
  }
  private key(address: WorkbookCellAddress) {
    return `${address.tableId}/${address.rowId}/${address.columnId}`
  }
  private maps(table: WorkbookTable): FormulaMaps {
    return {
      tableId: table.id,
      name: table.name,
      rowIds: table.rows.map((r) => r.id),
      columnIds: table.columns.map((c) => c.id),
      tables: [...this.tables.values()].map((candidate) => ({
        tableId: candidate.id,
        name: candidate.name,
        rowIds: candidate.rows.map((row) => row.id),
        columnIds: candidate.columns.map((column) => column.id),
      })),
    }
  }
  private cellAddress(rowIndex: number, columnIndex: number): string {
    // Engine addresses are 0-based `A1`-style coordinates.
    let name = ''
    let remaining = columnIndex + 1
    while (remaining > 0) {
      const offset = (remaining - 1) % 26
      name = String.fromCharCode(65 + offset) + name
      remaining = Math.floor((remaining - 1) / 26)
    }
    return `${name}${rowIndex + 1}`
  }
  private installTable(table: WorkbookTable) {
    const sheet = this.sheets.get(table.id)!
    table.rows.forEach((row, rowIndex) => {
      table.columns.forEach((column, columnIndex) => {
        const cell = row.cells[column.id]
        const address = this.cellAddress(rowIndex, columnIndex)
        if (cell?.formula) {
          const formula = validatePersistedFormulaArtifact(cell.formula)
          this.formulas.set(
            this.key({ tableId: table.id, rowId: row.id, columnId: column.id }),
            formula,
          )
          // Unsupported artifacts remain durable and visible to callers, but
          // must never be interpreted by a calculation engine on reload.
          if (formula.status === 'supported') {
            // Evaluated lazily from the persisted artifact on read.
            return
          }
        }
        const literal = encodeScientificLiteral(
          column.logicalType,
          cell?.literal,
        )
        // The retired engine used a leading apostrophe to force text; the
        // sheetbase-table engine stores the string as-is.
        sheet.set(
          address,
          typeof literal === 'string' && literal.startsWith("'")
            ? literal.slice(1)
            : literal,
        )
      })
    })
  }
  private locate(address: WorkbookCellAddress) {
    const table = this.tables.get(address.tableId)
    if (!table) throw new Error('Unknown table.')
    const row = table.rows.findIndex((item) => item.id === address.rowId),
      column = table.columns.findIndex((item) => item.id === address.columnId)
    if (row < 0 || column < 0) throw new Error('Unknown stable cell identity.')
    return {
      table,
      row,
      column,
      logicalType: table.columns[column].logicalType,
    }
  }
  hasTable(tableId: string) {
    return this.tables.has(tableId)
  }
  get(address: WorkbookCellAddress): WorkbookResult {
    const location = this.locate(address)
    const formula = this.formulas.get(this.key(address))
    const engineFormula =
      formula && 'status' in formula && formula.status === 'supported'
        ? formula.engineExpression
        : undefined
    try {
      const value = this.valueAt(location.table, location.row, location.column, new Set())
      return {
        status: formula ? 'formula' : 'literal',
        source: formula?.source,
        engineFormula,
        value: (value instanceof Date ? value.toISOString() : value) as
          | string
          | number
          | boolean
          | null,
        logical: decodeScientificResult(
          location.logicalType,
          value instanceof Date
            ? (value.getTime() - SERIAL_EPOCH_MS) / 86_400_000
            : value,
          location.table.columns[location.column].categoryOptionIds,
        ),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[workbook] evaluation error:', message)
      return {
        status: 'error',
        source: formula?.source,
        engineFormula,
        error: ERROR_CODES[errorCodeFor(message)] ?? 'ERROR',
        message,
      }
    }
  }
  /**
   * Lazy, memoized cell evaluation with a global in-flight trail: reading a
   * formula resolves its references (cross-sheet included) through the same
   * evaluator, so a reference cycle is detected no matter how many sheets it
   * spans.
   */
  private valueAt(
    table: WorkbookTable,
    row: number,
    column: number,
    trail: Set<string>,
  ): Scalar {
    const key = `${table.id}/${row}/${column}`
    if (this.cache.has(key)) return this.cache.get(key) as Scalar
    if (trail.has(key)) throw new Error('CYCLE')
    trail.add(key)
    const columnId = table.columns[column]?.id ?? ''
    const cell = table.rows[row]?.cells[columnId]
    const formulaKey = this.key({
      tableId: table.id,
      rowId: table.rows[row].id,
      columnId,
    })
    const stored = this.formulas.get(formulaKey)
    const formula =
      stored ??
      (cell?.formula
        ? validatePersistedFormulaArtifact(cell.formula)
        : undefined)
    if (formula) this.formulas.set(formulaKey, formula)
    // Parsed artifacts are supported by construction; persisted artifacts
    // carry an explicit status that may mark them unsupported.
    const supported =
      !!formula && (!('status' in formula) || formula.status === 'supported')
    let value: Scalar
    if (supported) {
      // Formula cells evaluate lazily from the persisted artifact.
      const expression = emitFormula(
        formula as FormulaArtifact,
        this.maps(table),
      )
      value = evaluateWithin(
        expression,
        table.id,
        (originTableId, referenceKey) =>
          this.resolveReference(originTableId, referenceKey, trail),
      )
    } else {
      const sheet = this.sheets.get(table.id)!
      value = (sheet.value(this.cellAddress(row, column)) ?? null) as Scalar
    }
    trail.delete(key)
    this.cache.set(key, value)
    return value
  }
  /** Resolve a reference from a formula on `originTableId`. */
  private resolveReference(
    originTableId: string,
    referenceKey: string,
    trail: Set<string>,
  ): Scalar {
    const separator = referenceKey.lastIndexOf('!')
    if (separator < 0) {
      const table = this.tables.get(originTableId)
      if (!table) throw new Error('#REF!')
      const { row, column } = parseCoordinates(referenceKey)
      return this.valueAt(table, row, column, trail)
    }
    const sheetName = referenceKey.slice(0, separator).replace(/^'|'$/g, '')
    const tableId = this.tableBySheet.get(sheetName)
    const table = tableId ? this.tables.get(tableId) : undefined
    if (!table) throw new Error('#REF!')
    const { row, column } = parseCoordinates(referenceKey.slice(separator + 1))
    return this.valueAt(table, row, column, trail)
  }
  setLiteral(address: WorkbookCellAddress, value: unknown): WorkbookChange[] {
    const location = this.locate(address)
    this.formulas.delete(this.key(address))
    const literal = encodeScientificLiteral(location.logicalType, value)
    this.sheets
      .get(location.table.id)!
      .set(
        this.cellAddress(location.row, location.column),
        typeof literal === 'string' && literal.startsWith("'")
          ? literal.slice(1)
          : literal,
      )
    this.cache.clear()
    return [
      {
        address: {
          sheet: this.sheetNumbers.get(location.table.id) ?? 0,
          row: location.row,
          col: location.column,
        },
      },
    ]
  }
  setFormula(
    address: WorkbookCellAddress,
    source: string,
  ):
    | {
        status: 'supported'
        artifact: FormulaArtifact
        changes: WorkbookChange[]
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
    // Real-target normalization is a compatibility check, not persisted meaning.
    try {
      compileFormula(artifact.engineExpression)
    } catch (error) {
      throw new Error(
        `The calculation engine rejected the normalized expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    this.formulas.set(this.key(address), artifact)
    this.cache.clear()
    return {
      status: 'supported',
      artifact,
      changes: [
        {
          address: {
            sheet: this.sheetNumbers.get(location.table.id) ?? 0,
            row: location.row,
            col: location.column,
          },
        },
      ],
    }
  }
  getChangedResults(changes: readonly WorkbookChange[]) {
    return changes.flatMap((change) => {
      const tableId = this.tableBySheet.get(
        scientificSheetNameFromNumber(change.address.sheet, this.sheetNumbers),
      )
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
  describe(address: WorkbookCellAddress) {
    const location = this.locate(address)
    return {
      tableName: location.table.name ?? location.table.id,
      columnName:
        location.table.columns[location.column].label ?? address.columnId,
      rowNumber: location.row + 1,
      columnNumber: location.column + 1,
    }
  }
  destroy() {
    this.cache.clear()
  }
}
function parseCoordinates(address: string): { row: number; column: number } {
  const letters = (address.match(/[A-Z]+/g) ?? ['A']).join('')
  const digits = Number(address.replace(/[^0-9]/g, ''))
  let column = 0
  for (const ch of letters) column = column * 26 + (ch.charCodeAt(0) - 64)
  return { row: digits - 1, column: column - 1 }
}

function scientificSheetNameFromNumber(
  sheet: number,
  sheetNumbers: Map<string, number>,
): string {
  for (const [tableId, number] of sheetNumbers) {
    if (number === sheet) return scientificSheetName(tableId)
  }
  return ''
}

/** Evaluate an expression with all bare references bound to one sheet. */
function evaluateWithin(
  expression: string,
  originTableId: string,
  resolveReference: (originTableId: string, referenceKey: string) => Scalar,
): Scalar {
  const sheetName = scientificSheetName(originTableId)
  return evaluateFormula(expression, (referenceKey) => {
    if (referenceKey.includes('!')) return resolveReference(originTableId, referenceKey)
    return resolveReference(originTableId, `${sheetName}!${referenceKey}`)
  })
}

export function buildScientificWorkbook(tables: readonly WorkbookTable[]) {
  return new ScientificWorkbook(tables)
}
