/**
 * SPIKE — sheetbase-table integration (spike/table-engine-integration).
 *
 * Bridges the sheetbase-table `PagedDataAdapter` contract onto the existing
 * `/api/db` PostgREST boundary via `DataClient`, so the table engine can read
 * and write a Scientific Table through the same authenticated, RLS-scoped
 * path the Handsontable surface uses today.
 *
 * Mapping notes (see docs/sheetbase-table-integration-report.md):
 * - Reads page `resource_name` rows with PostgREST `order`/`limit`/`offset`;
 *   the total comes from `client.count`.
 * - Filters map to PostgREST operators; `and` logic is implicit, `or` wraps
 *   the conditions in a single `or=(...)` expression (values containing
 *   commas are not supported in `or` mode).
 */
import { RevisionConflictError } from "sheetbase-table/dev";
import type {
  CellBinding,
  CommitResult,
  DatasetPage,
  PageRequest,
  PagedDataAdapter,
  RecordFieldWrite,
  Scalar,
} from 'sheetbase-table/dev'

import type { DataClient } from '#/lib/data-client'
import type { ScientificRowWire, ScientificTableWire } from "#/lib/scientific-sheet-data"

const REVISION_CONFLICT_CODES = ['version_conflict', 'row_version_conflict', 'conflict']

function isVersionConflict(error: { code: string; message: string }): boolean {
  const haystack = `${error.code} ${error.message}`.toLowerCase()
  return REVISION_CONFLICT_CODES.some((code) => haystack.includes(code)) || haystack.includes('version')
}

/** Map a sheetbase-table filter clause onto PostgREST query conditions. */
export function postgrestCondition(
  filter: { fieldId: string; operator: string; value?: unknown },
): string | null {
  const column = filter.fieldId
  const encode = (value: unknown): string =>
    typeof value === 'boolean' ? String(value) : String(value ?? '')

  switch (filter.operator) {
    case 'eq':
      return `${column}=eq.${encode(filter.value)}`
    case 'neq':
      return `${column}=neq.${encode(filter.value)}`
    case 'gt':
      return `${column}=gt.${encode(filter.value)}`
    case 'gte':
      return `${column}=gte.${encode(filter.value)}`
    case 'lt':
      return `${column}=lt.${encode(filter.value)}`
    case 'lte':
      return `${column}=lte.${encode(filter.value)}`
    case 'contains':
      return `${column}=ilike.*${encode(filter.value)}*`
    case 'startsWith':
      return `${column}=ilike.${encode(filter.value)}*`
    case 'in': {
      const values = Array.isArray(filter.value) ? filter.value : []
      return values.length > 0
        ? `${column}=in.(${values.map(encode).map((entry) => encodeURIComponent(entry)).join(',')})`
        : null
    }
    case 'between': {
      const [min, max] = Array.isArray(filter.value) ? filter.value : [undefined, undefined]
      if (min === undefined || max === undefined) return null
      return `and=(${column}.gte.${encode(min)},${column}.lte.${encode(max)})`
    }
    case 'withinLastDays': {
      const days = Number(filter.value)
      if (!Number.isFinite(days) || days <= 0) return null
      const now = Date.now()
      const day = 86_400_000
      const toIso = (millis: number) => new Date(millis).toISOString().slice(0, 10)
      return `and=(${column}.gte.${toIso(now - (days - 1) * day)},${column}.lte.${toIso(now)})`
    }
    case 'isNull':
      return `${column}=is.null`
    case 'notNull':
      return `${column}=not.is.null`
    default:
      return null
  }
}

/** Build a PostgREST filter query string from a sheetbase-table query. */
export function postgrestFilterQuery(
  filters: readonly { fieldId: string; operator: string; value?: unknown }[] | undefined,
  filterLogic: 'and' | 'or' | undefined,
): string {
  if (!filters || filters.length === 0) return ''
  const conditions = filters
    .map((filter) => postgrestCondition(filter))
    .filter((condition): condition is string => condition !== null)
  if (conditions.length === 0) return ''
  if (filterLogic === 'or' && conditions.length > 1) {
    return `or=(${conditions.map((condition) => condition.replace('=', '.')).join(',')})`
  }
  return conditions.join('&')
}

export interface PostgrestPagedAdapterOptions {
  client: DataClient
  table: ScientificTableWire
}

export class PostgrestPagedDataAdapter implements PagedDataAdapter {
  readonly #client: DataClient
  readonly #table: ScientificTableWire
  readonly #resource: string
  readonly #columnIdByField = new Map<string, string>()
  readonly #values = new Map<string, Scalar>()
  readonly #rowVersions = new Map<string, number>()

  constructor(options: PostgrestPagedAdapterOptions) {
    this.#client = options.client
    this.#table = options.table
    this.#resource = encodeURIComponent(options.table.resource_name)
    for (const column of options.table.columns) {
      this.#columnIdByField.set(column.field_name, column.id)
    }
  }

  get table(): ScientificTableWire {
    return this.#table
  }

  /** The cached row version guarding optimistic writes for `recordId`. */
  rowVersion(recordId: string): number | undefined {
    return this.#rowVersions.get(recordId)
  }

  /** The physical column id behind a grid field id (field_name). */
  columnIdForField(fieldId: string): string | undefined {
    return this.#columnIdByField.get(fieldId)
  }

  /** Drop the cached row version after an optimistic-guard failure. */
  invalidateRow(recordId: string): void {
    this.#rowVersions.delete(recordId)
  }

  resolve(binding: CellBinding): Scalar {
    if (binding.kind !== 'record-field') return null
    return (
      this.#values.get(`${binding.datasetId}\u0000${binding.recordId}\u0000${binding.fieldId}`) ?? null
    )
  }

  async fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage> {
    const filterQuery = postgrestFilterQuery(request.filters, request.filterLogic)
    // The DataClient contract concatenates `/${resource}${query}` verbatim,
    // so every query must carry its own leading `?`.
    const totalRows = await this.#client.count(this.#resource, filterQuery ? `?${filterQuery}` : '')
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const order = [
      ...(request.sort ?? []).map((clause) => `${clause.fieldId}.${clause.direction}`),
      'id.asc',
    ].join(',')
    const rows = await this.#client.list<ScientificRowWire>(
      this.#resource,
      `?${filterQuery ? `${filterQuery}&` : ''}select=${encodeURIComponent(
        ['id', 'version', ...request.fieldIds].join(','),
      )}&order=${order}&limit=${request.rowCount}&offset=${request.rowStart}`,
    )
    for (const row of rows) {
      this.#rowVersions.set(row.id, row.version)
      for (const fieldId of request.fieldIds) {
        const value = row[fieldId]
        this.#values.set(
          `${request.datasetId}\u0000${row.id}\u0000${fieldId}`,
          (value ?? null) as Scalar,
        )
      }
    }
    return {
      request,
      totalRows,
      revision: `sv${this.#table.schema_version}`,
      records: rows.map((row) => ({
        recordId: row.id,
        values: Object.fromEntries(
          request.fieldIds.map((fieldId) => [fieldId, (row[fieldId] ?? null) as Scalar]),
        ),
      })),
    }
  }

  async commit(
    writes: readonly RecordFieldWrite[],
    _baseRevision?: string,
  ): Promise<CommitResult> {
    if (writes.length === 0) {
      return { revision: `sv${this.#table.schema_version}`, accepted: [], rejected: [] }
    }
    const valuesByRow = new Map<string, Record<string, unknown>>()
    for (const write of writes) {
      const values = valuesByRow.get(write.recordId) ?? {}
      values[write.fieldId] = write.after ?? null
      valuesByRow.set(write.recordId, values)
    }
    const edits = [...valuesByRow.entries()].map(([rowId, values]) => ({
      rowId,
      expectedVersion: this.#rowVersions.get(rowId) ?? 1,
      values,
    }))
    const result = await this.#client.rpc<
      | { ok: true; schemaVersion: number; rows: ScientificRowWire[] }
      | {
          ok: false
          errors: Array<{ rowId: string; columnId: string; code: string; message: string }>
        }
    >('apply_scientific_row_changes', {
      p_table_id: this.#table.id,
      p_expected_schema_version: this.#table.schema_version,
      p_edits: edits,
      p_inserts: [],
    })

    if (result.ok) {
      for (const row of result.rows) this.#rowVersions.set(row.id, row.version)
      for (const write of writes) {
        this.#values.set(
          `${write.datasetId ?? ''}\u0000${write.recordId}\u0000${write.fieldId}`,
          (write.after ?? null) as Scalar,
        )
      }
      return { revision: `sv${result.schemaVersion}`, accepted: writes, rejected: [] }
    }

    const columnField = new Map<string, string>()
    for (const [fieldId, columnId] of this.#columnIdByField) columnField.set(columnId, fieldId)
    const rejected: Array<{ write: RecordFieldWrite; reason: string }> = []
    const conflicts: Array<{ write: RecordFieldWrite; reason: string }> = []
    const accepted: RecordFieldWrite[] = []
    for (const write of writes) {
      const error = result.errors.find(
        (candidate) =>
          candidate.rowId === write.recordId && columnField.get(candidate.columnId) === write.fieldId,
      )
      if (!error) {
        accepted.push(write)
        continue
      }
      if (isVersionConflict(error)) {
        this.#rowVersions.delete(write.recordId)
        conflicts.push({ write, reason: error.message })
      } else {
        rejected.push({ write, reason: error.message })
      }
    }
    if (conflicts.length > 0) {
      throw new RevisionConflictError(`sv${this.#table.schema_version}`, conflicts)
    }
    return {
      revision: `sv${this.#table.schema_version}`,
      accepted,
      rejected: rejected.map(({ write, reason }) => ({ write, reason })),
    }
  }

  async createRecord(
    datasetId: string,
    values: Readonly<Record<string, string>>,
    _baseRevision?: string,
  ): Promise<Readonly<{ recordId: string; revision: string }>> {
    const insert = { ...values }
    const result = await this.#client.rpc<
      | { ok: true; schemaVersion: number; rows: ScientificRowWire[] }
      | { ok: false; errors: Array<{ rowId: string; columnId: string; code: string; message: string }> }
    >('apply_scientific_row_changes', {
      p_table_id: this.#table.id,
      p_expected_schema_version: this.#table.schema_version,
      p_edits: [],
      p_inserts: [insert],
    })
    if (!result.ok || result.rows.length === 0) {
      throw new Error('Record creation failed')
    }
    const created = result.rows[result.rows.length - 1]
    for (const [fieldId, value] of Object.entries(values)) {
      this.#values.set(`${datasetId}\u0000${created.id}\u0000${fieldId}`, value)
    }
    return { recordId: created.id, revision: `sv${result.schemaVersion}` }
  }
}
