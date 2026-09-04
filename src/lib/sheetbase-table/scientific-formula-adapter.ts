/**
 * Decorates the paged PostgREST adapter with the per-cell formula flow for
 * Scientific Tables. `=...` edits route to `/api/formulas` (create or update
 * a `formula_definitions` row guarded by schema/row versions) instead of
 * being committed as literal text; overwriting a formula cell with a plain
 * value removes the formula first; and reads overlay `formula_results` so a
 * computed cell displays its calculated value rather than the stored source.
 *
 * The calculation itself stays host-side: after any formula mutation the
 * caller's `afterFormulaChange` hook triggers the trusted calculation run,
 * and the refreshed results query feeds the overlay back through fetchPage.
 */
import type {
  CellBinding,
  CommitResult,
  DatasetPage,
  PageRequest,
  PagedDataAdapter,
  RecordFieldWrite,
  Scalar,
} from 'sheetbase-table/dev'
import { RevisionConflictError } from 'sheetbase-table/dev'

import type {
  FormulaDefinitionWire,
  FormulaResultWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import {
  FormulaMutationError,
  mutateScientificFormula,
} from '#/lib/scientific-sheet-data'
import type { PostgrestPagedDataAdapter } from './postgrest-paged-adapter'

// The formula API's optimistic-guard code (plus defensive variants) — these
// mean the grid's row/schema snapshot is stale, so surface the engine's
// revision-conflict flow rather than a per-cell rejection.
const CONFLICT_HINTS = ['stale_version', 'row_version', 'schema_version']

export function isFormulaSource(value: Scalar | undefined): boolean {
  return typeof value === 'string' && value.startsWith('=')
}

export function formulaKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`
}

export interface ScientificFormulaAdapterOptions {
  inner: PostgrestPagedDataAdapter
  table: ScientificTableWire
  /** Latest formula definitions keyed by `${rowId}:${columnId}` (React Query owned). */
  formulas: () => ReadonlyMap<string, FormulaDefinitionWire>
  /** Latest trusted results keyed by `${rowId}:${columnId}` (React Query owned). */
  results: () => ReadonlyMap<string, FormulaResultWire>
  /** Fired after any formula mutation so the host can re-run calculations. */
  afterFormulaChange: () => void
  fetchImpl?: typeof fetch
}

export class ScientificFormulaAdapter implements PagedDataAdapter {
  readonly #inner: PostgrestPagedDataAdapter
  readonly #table: ScientificTableWire
  readonly #options: Omit<ScientificFormulaAdapterOptions, 'inner' | 'table'>

  constructor(options: ScientificFormulaAdapterOptions) {
    this.#inner = options.inner
    this.#table = options.table
    const { inner: _inner, table: _table, ...rest } = options
    this.#options = rest
  }

  get table(): ScientificTableWire {
    return this.#table
  }

  resolve(binding: CellBinding): Scalar {
    const value = this.#inner.resolve(binding)
    if (binding.kind !== 'record-field') return value
    const columnId = this.#inner.columnIdForField(binding.fieldId)
    if (!columnId) return value
    const result = this.#options.results().get(formulaKey(binding.recordId, columnId))
    if (!result || (result.calculation_status !== 'current' && result.calculation_status !== 'stale')) {
      return value
    }
    return (result.calculated_value ?? null) as Scalar
  }

  async fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage> {
    const page = await this.#inner.fetchPage(request, signal)
    const results = this.#options.results()
    if (results.size === 0) return page
    const records = page.records.map((record) => {
      let overlay: Record<string, Scalar> | undefined
      for (const fieldId of request.fieldIds) {
        const columnId = this.#inner.columnIdForField(fieldId)
        if (!columnId) continue
        const result = results.get(formulaKey(record.recordId, columnId))
        if (!result || (result.calculation_status !== 'current' && result.calculation_status !== 'stale')) continue
        overlay ??= { ...record.values }
        overlay[fieldId] = (result.calculated_value ?? null) as Scalar
      }
      return overlay ? { ...record, values: overlay } : record
    })
    return { ...page, records }
  }

  async commit(
    writes: readonly RecordFieldWrite[],
    baseRevision?: string,
  ): Promise<CommitResult> {
    if (writes.length === 0) {
      return { revision: `sv${this.#table.schema_version}`, accepted: [], rejected: [] }
    }
    const rejected: Array<{ write: RecordFieldWrite; reason: string }> = []
    const accepted: RecordFieldWrite[] = []
    const valueWrites: RecordFieldWrite[] = []
    let mutated = false

    for (const write of writes) {
      const columnId = this.#inner.columnIdForField(write.fieldId)
      const existing = columnId
        ? this.#options.formulas().get(formulaKey(write.recordId, columnId))
        : undefined
      try {
        if (isFormulaSource(write.after as Scalar | undefined)) {
          // Create or update the formula definition; the column keeps the
          // source text and the trusted run fills formula_results.
          const rowVersion = this.#inner.rowVersion(write.recordId)
          if (!columnId || rowVersion === undefined) {
            rejected.push({ write, reason: 'Row not loaded; reload before writing formulas.' })
            continue
          }
          await mutateScientificFormula(
            existing
              ? {
                  operation: 'update',
                  target: { tableId: this.#table.id, rowId: write.recordId, columnId },
                  expectedSchemaVersion: this.#table.schema_version,
                  expectedRowVersion: rowVersion,
                  expectedFormulaVersion: Number(existing.version),
                  source: write.after as string,
                }
              : {
                  operation: 'create',
                  target: { tableId: this.#table.id, rowId: write.recordId, columnId },
                  expectedSchemaVersion: this.#table.schema_version,
                  expectedRowVersion: rowVersion,
                  source: write.after as string,
                },
            this.#options.fetchImpl,
          )
          mutated = true
          accepted.push(write)
          continue
        }
        if (existing) {
          // A plain value over a formula cell: retire the formula, then the
          // value flows through the ordinary row commit below.
          const rowVersion = this.#inner.rowVersion(write.recordId)
          if (rowVersion === undefined) {
            rejected.push({ write, reason: 'Row not loaded; reload before overwriting formulas.' })
            continue
          }
          await mutateScientificFormula(
            {
              operation: 'remove',
              target: { tableId: this.#table.id, rowId: write.recordId, columnId: columnId as string },
              expectedSchemaVersion: this.#table.schema_version,
              expectedRowVersion: rowVersion,
              expectedFormulaVersion: Number(existing.version),
              replacement: write.after ?? null,
            },
            this.#options.fetchImpl,
          )
          mutated = true
        }
        valueWrites.push(write)
      } catch (error) {
        if (error instanceof FormulaMutationError) {
          if (CONFLICT_HINTS.some((hint) => error.code.toLowerCase().includes(hint))) {
            this.#inner.invalidateRow(write.recordId)
            throw new RevisionConflictError(`sv${this.#table.schema_version}`, [
              { write, reason: error.message },
            ])
          }
          rejected.push({ write, reason: error.message })
          continue
        }
        throw error
      }
    }

    let result: CommitResult = {
      revision: `sv${this.#table.schema_version}`,
      accepted: valueWrites,
      rejected: [],
    }
    if (valueWrites.length > 0) {
      result = await this.#inner.commit(valueWrites, baseRevision)
    }
    if (mutated) this.#options.afterFormulaChange()
    return {
      revision: result.revision,
      accepted: [...accepted, ...result.accepted],
      rejected: [...rejected, ...result.rejected],
    }
  }

  async createRecord(
    datasetId: string,
    values: Readonly<Record<string, string>>,
    baseRevision?: string,
  ): Promise<Readonly<{ recordId: string; revision: string }>> {
    return this.#inner.createRecord(datasetId, values, baseRevision)
  }
}
