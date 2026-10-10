import {
  addressKey,
  compileFormula,
  Workbook,
} from '@sheetbase-labs/sheetbase-table'
import type { CellBinding, Worksheet } from '@sheetbase-labs/sheetbase-table'

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
  normalizeEngineScalar,
} from './scientific-literals'
import type {
  LiteralCodecResult,
  ScientificScalar,
} from './scientific-literals'
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
/** A cell the engine recalculated as a side effect of a write. */
export interface WorkbookChange {
  address: WorkbookCellAddress
}
export type WorkbookResult =
  | {
      status: 'literal' | 'formula'
      source?: string
      engineFormula?: string
      value: ScientificScalar
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

/** Engine error strings mapped to the codes persisted in `formula_result_cache`. */
const ERROR_CODES: Partial<Record<string, string>> = {
  '#DIV/0!': 'DIV_BY_ZERO',
  '#REF!': 'REF',
  '#NAME?': 'NAME',
  '#VALUE!': 'VALUE',
  '#NUM!': 'NUM',
  '#N/A': 'NA',
  '#SPILL!': 'SPILL',
  '#CALC!': 'ERROR',
}

/**
 * The server's calculation workbook, on the `sheetbase-table` engine
 * (ADR-0048 option (b)). It preserves the previous workbook's contract exactly:
 * stable-identity addressing, persisted artifacts, typed results and error
 * codes. Only the evaluator changed.
 */
export class ScientificWorkbook {
  /** The underlying package workbook; exposed for diagnostics. */
  readonly engine: Workbook
  private readonly tables = new Map<string, WorkbookTable>()
  private readonly sheetNames = new Map<string, string>()
  private readonly worksheets = new Map<string, Worksheet>()
  private readonly formulas = new Map<
    string,
    PersistedFormulaArtifact | FormulaArtifact
  >()
  /** `${tableId}/${A1}` -> stable identity, so writes and changes never re-derive it. */
  private readonly addresses = new Map<string, WorkbookCellAddress>()

  constructor(tables: readonly WorkbookTable[]) {
    this.engine = new Workbook()
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
      const sheetName = scientificSheetName(table.id)
      this.engine.addSheet(sheetName)
      this.tables.set(table.id, table)
      this.sheetNames.set(table.id, sheetName)
      this.worksheets.set(table.id, this.engine.sheet(sheetName))
    }
    for (const table of normalized) this.installTable(table)
  }

  private key(address: WorkbookCellAddress) {
    return `${address.tableId}/${address.rowId}/${address.columnId}`
  }
  private address(table: WorkbookTable, row: number, column: number) {
    return {
      a1: addressKey({ row, column }),
      identity: {
        tableId: table.id,
        rowId: table.rows[row].id,
        columnId: table.columns[column].id,
      },
    }
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
  private installFormula(sheetName: string, a1: string, expression: string) {
    try {
      this.engine.set(sheetName, a1, { kind: 'formula', expression })
    } catch {
      // A rejected expression stays bound on the sheet so `get` surfaces the
      // engine's typed error for that cell instead of failing the workbook.
      this.engine.sheet(sheetName).set(a1, { kind: 'formula', expression })
    }
  }
  private installTable(table: WorkbookTable) {
    const sheetName = this.sheetNames.get(table.id)!
    const maps = this.maps(table)
    for (const [row, rowData] of table.rows.entries()) {
      for (const [column, columnData] of table.columns.entries()) {
        const { a1, identity } = this.address(table, row, column)
        this.addresses.set(`${table.id}/${a1}`, identity)
        const cell = rowData.cells[columnData.id]
        if (cell?.formula) {
          const formula = validatePersistedFormulaArtifact(cell.formula)
          this.formulas.set(this.key(identity), formula)
          // Unsupported artifacts remain durable and visible to callers, but
          // must never be interpreted by a calculation engine on reload.
          if (formula.status === 'supported') {
            this.installFormula(sheetName, a1, emitFormula(formula, maps))
            continue
          }
        }
        this.engine.set(
          sheetName,
          a1,
          encodeScientificLiteral(columnData.logicalType, cell?.literal),
        )
      }
    }
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
      sheetName: this.sheetNames.get(address.tableId)!,
      logicalType: table.columns[column].logicalType,
      categoryOptionIds: table.columns[column].categoryOptionIds,
    }
  }
  private errorResult(
    source: string | undefined,
    engineFormula: string | undefined,
    error: unknown,
  ): WorkbookResult {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      source,
      engineFormula,
      // Cyclic evaluation surfaces as a thrown message, not an error code.
      error: message.startsWith('Circular reference')
        ? 'CYCLE'
        : (ERROR_CODES[message] ?? 'ERROR'),
      message,
    }
  }
  hasTable(tableId: string) {
    return this.tables.has(tableId)
  }
  /** Registered engine sheet names, in registration order. */
  engineSheetNames(): readonly string[] {
    return [...this.sheetNames.values()]
  }
  get(address: WorkbookCellAddress): WorkbookResult {
    const location = this.locate(address)
    const a1 = addressKey({ row: location.row, column: location.column })
    const worksheet = this.worksheets.get(address.tableId)!
    const formula = this.formulas.get(this.key(address)),
      engineFormula =
        worksheet.binding(a1)?.kind === 'formula'
          ? worksheet.input(a1)
          : undefined
    let raw: unknown
    try {
      raw = worksheet.value(a1)
    } catch (error) {
      return this.errorResult(formula?.source, engineFormula, error)
    }
    const value = normalizeEngineScalar(raw)
    // A spilled matrix is not a scalar cell value for this profile.
    if (value !== null && typeof value === 'object')
      return this.errorResult(formula?.source, engineFormula, '#VALUE!')
    return {
      status: formula ? 'formula' : 'literal',
      source: formula?.source,
      engineFormula,
      value,
      logical: decodeScientificResult(
        location.logicalType,
        value,
        location.categoryOptionIds,
      ),
    }
  }
  /**
   * The written cell and every cell the engine must recompute because of it,
   * within the sheet and across cross-sheet references.
   */
  private affected(tableId: string, a1: string): WorkbookChange[] {
    const changes: WorkbookChange[] = []
    const seen = new Set<string>()
    const queue: Array<readonly [string, string]> = [[tableId, a1]]
    while (queue.length) {
      const current = queue.shift()!
      const [currentTableId, currentA1] = current
      const key = `${currentTableId}/${currentA1}`
      if (seen.has(key)) continue
      seen.add(key)
      const identity = this.addresses.get(key)
      if (!identity) continue
      changes.push({ address: identity })
      const worksheet = this.worksheets.get(currentTableId)!
      for (const dependent of worksheet.dependents(currentA1))
        queue.push([currentTableId, dependent])
      const qualified = `${this.sheetNames.get(currentTableId)}!${currentA1}`
      for (const [otherTableId, other] of this.worksheets) {
        for (const formula of other.formulaAddresses())
          if (other.dependencyAddresses(formula).includes(qualified))
            queue.push([otherTableId, formula])
      }
    }
    return changes
  }
  private write(
    tableId: string,
    row: number,
    column: number,
    binding: CellBinding | ScientificScalar,
  ): string {
    const { a1, identity } = this.address(
      this.tables.get(tableId)!,
      row,
      column,
    )
    this.addresses.set(`${tableId}/${a1}`, identity)
    this.engine.set(this.sheetNames.get(tableId)!, a1, binding)
    return a1
  }
  setLiteral(address: WorkbookCellAddress, value: unknown): WorkbookChange[] {
    const location = this.locate(address)
    this.formulas.delete(this.key(address))
    const a1 = this.write(
      address.tableId,
      location.row,
      location.column,
      encodeScientificLiteral(location.logicalType, value),
    )
    return this.affected(address.tableId, a1)
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
    } catch {
      throw new Error('The formula engine rejected the normalized expression.')
    }
    const a1 = this.write(address.tableId, location.row, location.column, {
      kind: 'formula',
      expression: artifact.engineExpression,
    })
    this.formulas.set(this.key(address), artifact)
    return {
      status: 'supported',
      artifact,
      changes: this.affected(address.tableId, a1),
    }
  }
  getChangedResults(changes: readonly WorkbookChange[]) {
    return changes.flatMap((change) => {
      try {
        return [{ address: change.address, result: this.get(change.address) }]
      } catch {
        // A change may name a row or column retired by the same write.
        return []
      }
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
    this.formulas.clear()
    this.addresses.clear()
    this.worksheets.clear()
    this.sheetNames.clear()
    this.tables.clear()
  }
}
export function buildScientificWorkbook(tables: readonly WorkbookTable[]) {
  return new ScientificWorkbook(tables)
}
