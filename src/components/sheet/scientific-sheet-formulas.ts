import { normalizeExponentiation, parseFormula } from '#/lib/formula-ir'
import {
  SHEETBASE_ENGINE_VERSION,
  SHEETBASE_FUNCTION_PROFILE,
  SHEETBASE_SYNTAX_PROFILE,
} from '#/lib/formula-profile'
import { SHEETBASE_LITERAL_PROFILE } from '#/lib/scientific-literals'
import type {
  FormulaDefinitionWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificWorkbook,
  WorkbookCellAddress,
} from '#/lib/scientific-workbook'

export function persistedFormula(formula: FormulaDefinitionWire) {
  const dependencies = new Map<string, WorkbookCellAddress>()

  for (const binding of formula.bindings) {
    const cells =
      binding.kind === 'cell' ? [binding.cell] : binding.members.flat()

    for (const cell of cells) {
      const tableId = binding.tableId ?? formula.target_table_id
      dependencies.set(`${tableId}/${cell.rowId}/${cell.columnId}`, {
        tableId,
        ...cell,
      })
    }
  }

  return {
    version: 1,
    syntaxProfile: formula.syntax_profile,
    functionProfile: formula.function_profile,
    literalProfile: formula.literal_profile,
    engineVersion: formula.engine_version,
    status: formula.status,
    source: formula.source_expression,
    template: formula.template,
    bindings: formula.bindings,
    engineExpression: formula.engine_expression,
    dependencies: [...dependencies.values()].sort((a, b) =>
      `${a.rowId}/${a.columnId}`.localeCompare(`${b.rowId}/${b.columnId}`),
    ),
  }
}

/** Runs only after a successful durable write, never during render. */
export function cachePersistedFormula({
  previous,
  target,
  source,
  table,
  rows,
  workbook,
}: {
  previous: FormulaDefinitionWire[]
  target: WorkbookCellAddress
  source: string | null
  table: ScientificTableWire | null
  rows: ScientificRowWire[]
  workbook: ScientificWorkbook | null
}): FormulaDefinitionWire[] {
  const matches = (formula: FormulaDefinitionWire) =>
    formula.target_row_id === target.rowId &&
    formula.target_column_id === target.columnId

  if (source === null) return previous.filter((formula) => !matches(formula))

  if (!table) return previous

  const normalized = normalizeExponentiation(source)

  try {
    // The notebook workbook owns cross-sheet maps. For a newly inserted row
    // its asynchronous rebuild may lag; same-sheet parsing uses canonical IDs.
    const parsed = workbook?.hasTable(target.tableId)
      ? workbook.setFormula(target, normalized)
      : parseFormula(normalized, {
          tableId: table.id,
          name: table.name,
          rowIds: rows.map((row) => row.id),
          columnIds: table.columns.map((column) => column.id),
        })

    const existing = previous.find(matches)

    const entry: FormulaDefinitionWire = {
      id: existing?.id ?? '',
      target_table_id: target.tableId,
      target_row_id: target.rowId,
      target_column_id: target.columnId,
      source_expression: normalized,
      template: parsed.artifact.template,
      bindings: [...parsed.artifact.bindings],
      engine_expression: parsed.artifact.engineExpression,
      syntax_profile: SHEETBASE_SYNTAX_PROFILE,
      function_profile: SHEETBASE_FUNCTION_PROFILE,
      literal_profile: SHEETBASE_LITERAL_PROFILE,
      engine_version: SHEETBASE_ENGINE_VERSION,
      status: parsed.status,
      version: existing?.version ?? 1,
      created_at: existing?.created_at ?? new Date().toISOString(),
    }

    return existing
      ? previous.map((formula) => (matches(formula) ? entry : formula))
      : [...previous, entry]
  } catch {
    // A successful server write must not become a failed coordinator batch
    // because the local workbook is stale. The scheduled refetch supplies it.
    return previous
  }
}
