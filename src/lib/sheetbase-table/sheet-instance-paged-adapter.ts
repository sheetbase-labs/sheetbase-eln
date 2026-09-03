/**
 * Engine-swap bridge — Sheet Instance data over the sheetbase-table
 * `PagedDataAdapter` contract, for the `CanonicalSheetWorkspace` cutover.
 *
 * - Rows and values come from the canonical grid matrix (bound composition +
 *   local state + calculation-results overlay), so the adapter sees exactly
 *   what the Handsontable grid would have rendered. Calculation columns
 *   resolve to server-computed values — the host-authority hydration path.
 * - Pages are served from that in-memory matrix: Sheet Instance composition
 *   is bounded (≤200 composed rows per snapshot, ≤10k local rows), so one
 *   snapshot load is the page source and the engine's virtualizer slices it
 *   per viewport. Filters and sorts from the engine query are applied
 *   in-memory over the canonical order.
 * - `commit` routes by column authority exactly like the workspace edit
 *   pipeline: bound cells through the GRID-02/PLAT-05 batch write-back,
 *   local cells through `mutateSheetLocalState`, and a batch that spans both
 *   authorities fails closed (`SheetMixedAuthorityWriteError`) before any
 *   write. Engine edits arrive as strings and are coerced through
 *   `parseSheetCellInput` + `validateCanonicalCell` before persisting.
 * - Revision contract: `r<instance.revision>`. Stale-revision and conflict
 *   rejections surface as the engine's `RevisionConflictError`; after a
 *   successful commit the authoritative instance is refetched so the
 *   coordinator observes the server-bumped revision.
 */
import type {
  CellBinding,
  CommitResult,
  DatasetPage,
  DatasetQuery,
  PagedDataAdapter,
  PageRequest,
  RecordFieldWrite,
  Scalar,
} from 'sheetbase-table/dev'
import { RevisionConflictError } from 'sheetbase-table/dev'

import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'
import {
  canonicalSheetGridMatrix,
  parseSheetCellInput,
  validateCanonicalCell,
} from '#/lib/canonical-sheet-grid'
import type {
  CanonicalSheetGridColumn,
  CanonicalSheetGridMatrix,
} from '#/lib/canonical-sheet-grid'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetPresentation } from '#/lib/sheet-instance'
import { fetchSheetInstance, sheetInstanceDataClient } from '#/lib/sheet-instance-data'
import {
  createAdHocTextField,
  mutateSheetLocalState,
} from '#/lib/sheet-local-data'
import {
  SheetMixedAuthorityWriteError,
  sheetCellWriteError,
  writeSheetCells,
} from '#/lib/sheet-write-back'
import type { SheetCellWrite } from '#/lib/sheet-write-back'

export function sheetInstanceDatasetId(instanceId: string): string {
  return `sheet-instance:${instanceId}`
}

/** GRID-04 — presentation working-state filters mapped onto the engine's
 * typed filter vocabulary. Only the four operators the presentation schema
 * allows have counterparts, so the mapping is total. */
export function presentationFiltersToQueryFilters(
  filters: SheetPresentationFilters,
): DatasetQuery['filters'] {
  return filters.map((filter) => {
    if (filter.operator === 'equals')
      return { fieldId: filter.columnId, operator: 'eq' as const, value: filter.value }
    if (filter.operator === 'not-equals')
      return { fieldId: filter.columnId, operator: 'neq' as const, value: filter.value }
    if (filter.operator === 'is-empty')
      return { fieldId: filter.columnId, operator: 'isNull' as const }
    return { fieldId: filter.columnId, operator: 'notNull' as const }
  })
}

/** GRID-04 — presentation sorts (`{columnId, direction}`) mapped onto the
 * engine's sort clauses. */
export function presentationSortsToQuerySorts(
  sorts: SheetPresentationSorts,
): DatasetQuery['sort'] {
  return sorts.map((sort) => ({
    fieldId: sort.columnId,
    direction: sort.direction,
  }))
}

type SheetPresentationFilters = SheetPresentation['filters']
type SheetPresentationSorts = SheetPresentation['sorts']

function compareScalar(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean')
    return (a ? 1 : 0) - (b ? 1 : 0)
  return String(a).localeCompare(String(b))
}

function matchesFilter(value: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return value === expected
    case 'neq':
      return value !== expected
    case 'isNull':
      return value == null || value === ''
    case 'notNull':
      return !(value == null || value === '')
    case 'contains':
      return String(value ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())
    case 'startsWith':
      return String(value ?? '').toLowerCase().startsWith(String(expected ?? '').toLowerCase())
    case 'gt':
      return compareScalar(value, expected) > 0
    case 'gte':
      return compareScalar(value, expected) >= 0
    case 'lt':
      return compareScalar(value, expected) < 0
    case 'lte':
      return compareScalar(value, expected) <= 0
    // Operators without an in-memory counterpart never filter rows out.
    default:
      return true
  }
}

export interface SheetInstancePagedAdapterOptions {
  instance: SheetInstance
  composition?: ComposedSheetSnapshot | null
  calculationResults?: Record<string, Record<string, unknown>>
  client?: DataClient
  /** Write-back seams, injectable for tests. Defaults wire the production paths. */
  writeBoundCells?: typeof writeSheetCells
  writeLocalCells?: typeof mutateSheetLocalState
  refetchInstance?: typeof fetchSheetInstance
}

export class SheetInstancePagedAdapter implements PagedDataAdapter {
  readonly datasetId: string
  readonly #instance: SheetInstance
  readonly #composition: ComposedSheetSnapshot | null
  readonly #client: DataClient
  readonly #matrix: CanonicalSheetGridMatrix
  readonly #columnByField = new Map<string, CanonicalSheetGridColumn>()
  readonly #values = new Map<string, Scalar>()
  readonly #writeBoundCells: typeof writeSheetCells
  readonly #writeLocalCells: typeof mutateSheetLocalState
  readonly #refetchInstance: typeof fetchSheetInstance

  constructor(options: SheetInstancePagedAdapterOptions) {
    this.#instance = options.instance
    this.#composition = options.composition ?? null
    this.#client = options.client ?? createDataClient()
    this.#writeBoundCells = options.writeBoundCells ?? writeSheetCells
    this.#writeLocalCells = options.writeLocalCells ?? mutateSheetLocalState
    this.#refetchInstance = options.refetchInstance ?? fetchSheetInstance
    this.datasetId = sheetInstanceDatasetId(options.instance.id)
    this.#matrix = canonicalSheetGridMatrix({
      instance: options.instance,
      composition: this.#composition,
      calculationResults: options.calculationResults,
    })
    for (const column of this.#matrix.columns) {
      this.#columnByField.set(column.id, column)
    }
    this.#matrix.rowKeys.forEach((rowKey, rowIndex) => {
      for (const [columnIndex, column] of this.#matrix.columns.entries()) {
        const value = this.#matrix.data[rowIndex]?.[columnIndex]
        this.#values.set(
          `${this.datasetId}\u0000${rowKey}\u0000${column.id}`,
          (value ?? null) as Scalar,
        )
      }
    })
  }

  /** Canonical (pre-presentation) column ids, in canonical order. */
  get fieldIds(): readonly string[] {
    return this.#matrix.columns.map((column) => column.id)
  }

  get revision(): string {
    return `r${this.#instance.revision}`
  }

  async fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const order = this.#orderedRowKeys(request.sort, request.filters, request.filterLogic)
    const fields = request.fieldIds.length > 0 ? request.fieldIds : this.fieldIds
    const records = order
      .slice(request.rowStart, request.rowStart + request.rowCount)
      .map((rowKey) => {
        const values: Record<string, Scalar> = {}
        for (const fieldId of fields) {
          values[fieldId] =
            this.#values.get(`${this.datasetId}\u0000${rowKey}\u0000${fieldId}`) ?? null
        }
        return { recordId: rowKey, values }
      })
    return { request, totalRows: order.length, revision: this.revision, records }
  }

  resolve(binding: CellBinding): Scalar {
    if (binding.kind !== 'record-field') return null
    return (
      this.#values.get(
        `${this.datasetId}\u0000${binding.recordId}\u0000${binding.fieldId}`,
      ) ?? null
    )
  }

  async commit(
    writes: readonly RecordFieldWrite[],
    _baseRevision?: string,
  ): Promise<CommitResult> {
    if (writes.length === 0) {
      return { revision: this.revision, accepted: [], rejected: [] }
    }
    const accepted: RecordFieldWrite[] = []
    const rejected: Array<{ write: RecordFieldWrite; reason: string }> = []
    const bound: SheetCellWrite[] = []
    const local: Array<{ rowKey: string; fieldId: string; value: unknown }> = []
    for (const write of writes) {
      const column = this.#columnByField.get(write.fieldId)
      if (!column || !column.editable) {
        rejected.push({ write, reason: 'read_only_column' })
        continue
      }
      const value = parseSheetCellInput(column.field, write.after ?? '')
      const invalid = validateCanonicalCell(column.field, value)
      if (invalid) {
        rejected.push({ write, reason: invalid })
        continue
      }
      if (column.origin === 'bound') {
        bound.push({ rowKey: write.recordId, columnId: write.fieldId, value })
      } else {
        local.push({ rowKey: write.recordId, fieldId: write.fieldId, value })
      }
    }
    // GRID-02 parity: a batch spanning bound and local authorities is
    // rejected before any write — sequential dispatch has no cross-group
    // atomicity, and partial commits strand cells in pending state.
    if (bound.length > 0 && local.length > 0) {
      throw new SheetMixedAuthorityWriteError()
    }
    for (const write of writes) {
      if (!rejected.some((entry) => entry.write === write)) accepted.push(write)
    }
    let revision = this.revision
    if (bound.length > 0) {
      if (!this.#composition) throw new Error('unresolved_target')
      await this.#guardConflicts(writes, async () =>
        this.#writeBoundCells(
          { composition: this.#composition!, cells: bound, retryToken: retryToken() },
          this.#client,
        ),
      )
      // The bound write-back returns void: refetch the authoritative
      // instance so the coordinator observes the server-bumped revision.
      const fresh = await this.#refetchInstance(
        this.#instance.id,
        sheetInstanceDataClient,
      )
      if (!fresh) throw new Error('unresolved_target')
      revision = `r${fresh.revision}`
    }
    if (local.length > 0) {
      const next = await this.#guardConflicts(writes, async () =>
        this.#writeLocalCells(
          {
            instanceId: this.#instance.id,
            expectedRevision: this.#instance.revision,
            retryToken: retryToken(),
            cells: local.map((cell) => ({
              rowKey: cell.rowKey,
              fieldId: cell.fieldId,
              value: cell.value,
            })),
          },
          this.#client,
        ),
      )
      // The local mutation returns the updated instance — no refetch needed.
      revision = `r${next.revision}`
    }
    if (bound.length === 0 && local.length === 0) {
      // Nothing was dispatched (every write rejected fail-closed): the
      // authoritative revision cannot have moved.
      return { revision: this.revision, accepted, rejected }
    }
    return { revision, accepted, rejected }
  }

  /** Local rows only — composed rows belong to their governing dataset. */
  async createRecord(
    _datasetId: string,
    values: Readonly<Record<string, string>>,
    _baseRevision?: string,
  ): Promise<Readonly<{ recordId: string; revision: string }>> {
    const activeFields = this.#instance.state.localFields.filter(
      (field) => field.lifecycle === 'active',
    )
    const field =
      activeFields.at(0) ??
      createAdHocTextField(
        'Column',
        activeFields.map((item) => item.key),
      )
    const rowKey = retryToken()
    const next = await this.#writeLocalCells(
      {
        instanceId: this.#instance.id,
        expectedRevision: this.#instance.revision,
        retryToken: retryToken(),
        fieldChanges:
          activeFields.length === 0 ? [{ operation: 'add', field }] : undefined,
        rows: [{ kind: 'local' as const, rowKey }],
        cells: [
          { rowKey, fieldId: field.fieldId, value: null },
          ...Object.entries(values).map(([fieldId, value]) => ({
            rowKey,
            fieldId,
            value: parseSheetCellInput(
              this.#columnByField.get(fieldId)?.field ?? null,
              value,
            ),
          })),
        ],
      },
      this.#client,
    )
    return { recordId: rowKey, revision: `r${next.revision}` }
  }

  async #guardConflicts<T>(
    writes: readonly RecordFieldWrite[],
    dispatch: () => Promise<T>,
  ): Promise<T> {
    try {
      return await dispatch()
    } catch (error) {
      const kind = sheetCellWriteError(error)
      if (kind === 'stale' || kind === 'conflict') {
        throw new RevisionConflictError(
          this.revision,
          writes.map((write) => ({ write, reason: kind })),
        )
      }
      throw error
    }
  }

  #orderedRowKeys(
    sort: PageRequest['sort'],
    filters: PageRequest['filters'],
    filterLogic: PageRequest['filterLogic'],
  ): readonly string[] {
    let keys = this.#matrix.rowKeys
    if (filters && filters.length > 0) {
      const predicates = filters.map((filter) => (rowKey: string) =>
        matchesFilter(
          this.#values.get(
            `${this.datasetId}\u0000${rowKey}\u0000${filter.fieldId}`,
          ),
          filter.operator,
          filter.value,
        ),
      )
      keys = keys.filter((rowKey) =>
        filterLogic === 'or'
          ? predicates.some((predicate) => predicate(rowKey))
          : predicates.every((predicate) => predicate(rowKey)),
      )
    }
    if (sort && sort.length > 0) {
      keys = [...keys].sort((left, right) => {
        for (const clause of sort) {
          const leftValue = this.#values.get(
            `${this.datasetId}\u0000${left}\u0000${clause.fieldId}`,
          )
          const rightValue = this.#values.get(
            `${this.datasetId}\u0000${right}\u0000${clause.fieldId}`,
          )
          // Nulls sort last regardless of direction.
          if (leftValue == null && rightValue == null) continue
          if (leftValue == null) return 1
          if (rightValue == null) return -1
          const compared = compareScalar(leftValue, rightValue)
          if (compared !== 0) return clause.direction === 'desc' ? -compared : compared
        }
        return 0
      })
    }
    return keys
  }
}

function retryToken(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Math.random()}`.slice(2)
}
