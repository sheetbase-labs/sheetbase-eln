import type { DataClient } from './data-client'
import {
  applyScientificRowChanges,
  decodeScientificValue,
  mutateScientificFormula,
} from './scientific-sheet-data'
import type {
  FormulaDefinitionWire,
  ScientificRowWire,
  ScientificTableWire,
} from './scientific-sheet-data'
import { normalizeExponentiation } from './formula-ir'
import { DataClientError } from './data-client'

export type SaveStatus = 'idle' | 'saving' | 'retrying' | 'error' | 'saved'

export interface PendingCell {
  rowIndex: number
  rowId: string | null
  columnId: string
  fieldName: string
  raw: unknown
  generation: number
}

interface PendingFormulaWrite {
  rowId: string
  columnId: string
  source?: string
  replacement?: unknown
  existing?: FormulaDefinitionWire
}

export interface CoordinatorConfig {
  /** Data client for RPC calls. */
  client: DataClient
  /** Coalescing window in ms (default 300). */
  coalesceMs?: number
  /** Max retry attempts for network errors (default 3). */
  maxRetries?: number
  /** Get the current canonical rows from the query cache. */
  getCanonicalRows: () => ScientificRowWire[]
  /** Get the formula-by-cell map. */
  getFormulaByCell: () => Map<string, FormulaDefinitionWire>
  /** Get the current table schema. */
  getTable: () => ScientificTableWire | null
  /** Whether the grid is read-only (flushes are no-ops). */
  isReadOnly: () => boolean
  /** Called when rows are updated in the cache. */
  onRowsUpdated: (rows: ScientificRowWire[]) => void
  /** Called to replace a provisional row ID with the server-created UUID. */
  onProvisionalRowReplaced: (provisionalId: string, realId: string) => void
  /** Called to clear drafts for committed cells. */
  onDraftsCleared: (cells: PendingCell[]) => void
  /** Called when validation issues are found. */
  onIssues: (issues: Array<{ key: string; message: string }>) => void
  /** Called when the save status changes. */
  onStatusChange: (status: SaveStatus) => void
  /** Called when a trusted recalculation is needed. */
  onCalculationNeeded: (reconcileRows: boolean) => void
  /** Called to refetch rows after ambiguous errors. */
  onRefetchRows: () => void
  /**
   * Called after a formula write succeeds, with the target cell and source
   * expression. The caller can use this to optimistically update the
   * formulas query cache so the formula bar updates immediately without
   * waiting for a refetch.
   */
  onFormulaPersisted?: (
    target: { tableId: string; rowId: string; columnId: string },
    source: string | null,
  ) => void
}

/**
 * Coordinates grid edits with durable persistence, replacing the per-
 * `afterChange` mutation pattern with a coalesced, ordered, status-aware
 * write pipeline.
 *
 * - Applies edits to local drafts immediately (optimistic, handled by caller).
 * - Coalesces unsubmitted edits for ~300ms by row and cell, merging rapid
 *   successive changes into one batch.
 * - Submits ordered commands: literal edits/inserts first, then formula
 *   writes that advance row versions one at a time.
 * - Batches literals and formulas against one canonical table snapshot.
 * - Keeps local formula results immediate (the grid's own engine updates
 *   inline; the coordinator only persists).
 * - Schedules only one latest-wins trusted calculation after the write batch.
 * - Exposes states: Saved, Saving, Retrying, Save failed, Idle.
 * - Supports formulas on provisional new rows by inserting the row first,
 *   then applying the formula to the server-created UUID.
 */
export class GridOperationCoordinator {
  private readonly config: CoordinatorConfig
  private readonly coalesceMs: number
  private readonly maxRetries: number
  private pendingCells = new Map<string, PendingCell>()
  /** Provisional row IDs awaiting their first insert RPC. */
  private provisionalInserts = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private isFlushing = false
  private status: SaveStatus = 'idle'
  private generation = 0
  private destroyed = false
  /** Latest formula-only row versions, which are not written into grid data. */
  private formulaRowVersions = new Map<string, number>()

  constructor(config: CoordinatorConfig) {
    this.config = config
    this.coalesceMs = config.coalesceMs ?? 300
    this.maxRetries = config.maxRetries ?? 3
  }

  /** Current save status. */
  getStatus(): SaveStatus {
    return this.status
  }

  /** True when there are unsent edits or a flush is in progress. */
  hasPendingEdits(): boolean {
    return (
      this.pendingCells.size > 0 ||
      this.isFlushing ||
      this.provisionalInserts.size > 0
    )
  }

  /**
   * Register a provisional row (created optimistically by the Add Row
   * button). The coordinator will send an empty insert for it on the next
   * flush, even if no cells were edited. Once the server returns the real
   * UUID, the caller's `onProvisionalRowReplaced` callback is invoked so the
   * cache and grid can swap the identity.
   */
  registerProvisionalRow(rowId: string): void {
    if (this.config.isReadOnly()) return
    this.provisionalInserts.add(rowId)
    this.scheduleFlush()
  }

  /** Enqueue cell edits from `afterChange`. Applies optimistic drafts via the caller. */
  enqueue(cells: PendingCell[]): void {
    if (this.destroyed || this.config.isReadOnly() || cells.length === 0) return
    for (const cell of cells) {
      const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
      this.pendingCells.set(key, cell)
    }
    this.scheduleFlush()
  }

  /** Force an immediate flush (e.g., before route exit). Returns a promise that resolves when the flush completes. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.doFlush(0)
  }

  /** Retry the last failed flush. */
  async retry(): Promise<void> {
    if (this.status !== 'error') return
    // Re-enqueue the last failed cells if any are still pending.
    await this.doFlush(0)
  }

  /** Cleanup timers on unmount. Prevents in-flight flushes from calling back. */
  destroy(): void {
    this.destroyed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.doFlush(0)
    }, this.coalesceMs)
  }

  private setStatus(status: SaveStatus): void {
    if (this.status === status) return
    this.status = status
    this.config.onStatusChange(status)
  }

  private async doFlush(attempt: number): Promise<void> {
    if (this.destroyed || this.config.isReadOnly()) return
    if (this.isFlushing) return
    if (
      this.pendingCells.size === 0 &&
      this.provisionalInserts.size === 0 &&
      attempt === 0
    )
      return

    const table = this.config.getTable()
    if (!table) return

    this.isFlushing = true
    const cells = [...this.pendingCells.values()]
    if (attempt === 0) this.pendingCells.clear()

    const batchGeneration = ++this.generation
    this.setStatus('saving')

    try {
      const changedRows = await this.processBatch(table, cells, batchGeneration)
      // The destroyed flag can be set during the async processBatch await
      // (e.g., component unmount). Check before calling React state setters.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.destroyed) return
      this.config.onRowsUpdated(changedRows)
      this.config.onDraftsCleared(cells)
      this.config.onIssues([])
      // Only reconcile rows if there were actual row changes (literal
      // edits or inserts). Formula-only writes change row versions on the
      // server but don't change the row data that gridData uses. Avoiding
      // the unnecessary allRows invalidation prevents a background refetch
      // that would recompute gridData → settings → updateSettings on
      // HotTable, which calls loadData() and overwrites the formula
      // expression that the editor wrote to the source data. If a stale
      // version error occurs on a subsequent literal edit, the coordinator
      // handles it by refetching.
      const formulaChanged = cells.some(
        (cell) =>
          (typeof cell.raw === 'string' && cell.raw.startsWith('=')) ||
          (!!cell.rowId &&
            this.config
              .getFormulaByCell()
              .has(`${cell.rowId}/${cell.columnId}`)),
      )
      this.config.onCalculationNeeded(formulaChanged && changedRows.length > 0)
      this.setStatus('saved')
    } catch (error) {
      const isLocalValidation = (error as { localValidation?: boolean })
        .localValidation
      // stale_version is a deterministic conflict, not a transient failure —
      // do NOT retry. Surface it immediately so the user sees the conflict.
      const isStaleVersion =
        error instanceof DataClientError && error.code === 'stale_version'
      if (isStaleVersion) {
        this.config.onRefetchRows()
        const affected = new Map<string, { key: string; message: string }>()
        for (const cell of cells) {
          const rowKey = cell.rowId ?? `new:${cell.rowIndex}`
          affected.set(rowKey, {
            key: `${rowKey}:conflict`,
            message: `Row ${cell.rowIndex + 1} changed elsewhere. Your entered values remain in the grid.`,
          })
        }
        this.config.onIssues([...affected.values()])
        this.setStatus('error')
        return
      }
      // Permission errors (401/403) and bad requests (400) are not
      // transient — don't retry. 400 typically means a validation or
      // constraint error from PostgREST/PostgreSQL that won't resolve
      // by resending the same payload.
      const isNonRetryableError =
        error instanceof DataClientError &&
        (error.status === 400 || error.status === 401 || error.status === 403)
      if (isNonRetryableError) {
        this.config.onIssues(
          cells.map((cell) => ({
            key: `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`,
            message: error.message,
          })),
        )
        this.setStatus('error')
        return
      }
      if (!isLocalValidation) {
        // Network or server error — retry with backoff.
        if (attempt < this.maxRetries) {
          this.setStatus('retrying')
          this.isFlushing = false
          // Put cells back for retry.
          for (const cell of cells) {
            const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
            if (!this.pendingCells.has(key)) this.pendingCells.set(key, cell)
          }
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          )
          await this.doFlush(attempt + 1)
          return
        }
        // Max retries exhausted — refetch and surface error.
        this.config.onRefetchRows()
      }
      this.setStatus('error')
    } finally {
      this.isFlushing = false
      // If more cells accumulated during flush, schedule another.
      if (this.pendingCells.size > 0) this.scheduleFlush()
    }
  }

  /**
   * Process a batch of cell changes against one canonical snapshot.
   * Literals and inserts go first via `applyScientificRowChanges`; formula
   * writes follow, each advancing the target row's version. Formulas on
   * new rows are applied after the insert returns the server-created UUID.
   */
  private async processBatch(
    table: ScientificTableWire,
    cells: PendingCell[],
    _batchGeneration: number,
  ): Promise<ScientificRowWire[]> {
    const canonical = this.config.getCanonicalRows()
    const canonicalById = new Map(canonical.map((row) => [row.id, row]))
    const formulaByCell = this.config.getFormulaByCell()

    const edits = new Map<
      string,
      {
        rowId: string
        expectedVersion: number
        values: Record<string, unknown>
      }
    >()
    // Ordered insert entries so we can match returned rows to their source
    // key. For spare-row inserts the key is `rowIndex:N`; for provisional
    // rows (Add Row button) the key is the provisional ID itself.
    const insertEntries: Array<{
      key: string
      values: Record<string, unknown>
    }> = []
    const insertByKey = new Map<string, number>()
    const formulaWrites: PendingFormulaWrite[] = []
    // Formulas pending on new/provisional rows — applied after the insert
    // returns UUIDs. Keyed by the same insert key.
    const insertFormulas = new Map<
      string,
      { columnId: string; source: string }
    >()
    const errors: Array<{ key: string; message: string }> = []

    const isProvisional = (id: string | null): boolean =>
      !!id && id.startsWith('prov:')

    const ensureInsert = (key: string): Record<string, unknown> => {
      let idx = insertByKey.get(key)
      if (idx === undefined) {
        idx = insertEntries.length
        insertEntries.push({ key, values: {} })
        insertByKey.set(key, idx)
      }
      return insertEntries[idx].values
    }

    for (const cell of cells) {
      const { rowIndex, rowId, columnId, raw } = cell
      const column = table.columns.find((c) => c.id === columnId)
      if (!column) continue
      // Provisional rows are in the cache but must be treated as inserts,
      // not edits — the server doesn't know about them yet.
      const row =
        rowId && !isProvisional(rowId) ? canonicalById.get(rowId) : undefined
      const existingFormula = row
        ? formulaByCell.get(`${row.id}/${column.id}`)
        : undefined
      const insertKey = isProvisional(rowId) ? rowId! : `rowIndex:${rowIndex}`

      if (typeof raw === 'string' && raw.startsWith('=')) {
        if (!row) {
          // Formula on a new or provisional row — insert the row first,
          // then apply the formula to the server-created UUID.
          ensureInsert(insertKey)
          insertFormulas.set(insertKey, {
            columnId,
            source: normalizeExponentiation(raw),
          })
        } else {
          formulaWrites.push({
            rowId: row.id,
            columnId,
            source: normalizeExponentiation(raw),
            existing: existingFormula,
          })
        }
        continue
      }

      let value: unknown
      try {
        value = decodeScientificValue(column, raw)
      } catch (error) {
        errors.push({
          key: `${rowIndex}:${columnId}`,
          message: error instanceof Error ? error.message : 'Invalid value.',
        })
        continue
      }

      if (row) {
        if (existingFormula) {
          formulaWrites.push({
            rowId: row.id,
            columnId,
            replacement: value,
            existing: existingFormula,
          })
          continue
        }
        const edit = edits.get(row.id) ?? {
          rowId: row.id,
          expectedVersion: Math.max(
            Number(row.version),
            this.formulaRowVersions.get(row.id) ?? Number(row.version),
          ),
          values: {},
        }
        edit.values[columnId] = value
        edits.set(row.id, edit)
      } else {
        const values = ensureInsert(insertKey)
        values[columnId] = value
      }
    }

    // Add empty inserts for registered provisional rows that had no cell
    // edits — they still need to be persisted (e.g., Add Row button click
    // with no subsequent edits).
    for (const provId of this.provisionalInserts) {
      ensureInsert(provId)
    }

    if (errors.length) {
      this.config.onIssues(errors)
      throw Object.assign(new Error('Some cells are invalid.'), {
        localValidation: true,
      })
    }

    let changedRows: ScientificRowWire[] = []
    if (edits.size || insertEntries.length) {
      const result = await applyScientificRowChanges(
        this.config.client,
        table.id,
        table.schema_version,
        [...edits.values()],
        insertEntries.map((e) => e.values),
      )
      if (!result.ok) {
        this.config.onIssues(
          result.errors.map((e) => ({
            key: `${e.rowId}:${e.columnId}`,
            message: e.message,
          })),
        )
        throw Object.assign(new Error('Some cells were rejected.'), {
          validation: true,
        })
      }
      changedRows = result.rows
    }

    // Build the version map from canonical + changed rows.
    const rowVersions = new Map(
      canonical.map((row) => [
        row.id,
        Math.max(
          Number(row.version),
          this.formulaRowVersions.get(row.id) ?? Number(row.version),
        ),
      ]),
    )
    for (const row of changedRows) rowVersions.set(row.id, Number(row.version))

    // Match newly created rows to insert entries so we can apply
    // pending formulas on provisional rows and swap provisional IDs.
    const canonicalIds = new Set(canonical.map((r) => r.id))
    const newRows = changedRows.filter((r) => !canonicalIds.has(r.id))
    for (let i = 0; i < insertEntries.length && i < newRows.length; i++) {
      const entry = insertEntries[i]
      const createdRow = newRows[i]
      // Swap provisional IDs for real UUIDs in the caller's cache.
      if (entry.key.startsWith('prov:')) {
        this.provisionalInserts.delete(entry.key)
        this.config.onProvisionalRowReplaced(entry.key, createdRow.id)
      }
      const pendingFormula = insertFormulas.get(entry.key)
      if (pendingFormula) {
        formulaWrites.push({
          rowId: createdRow.id,
          columnId: pendingFormula.columnId,
          source: pendingFormula.source,
        })
      }
    }

    // Formula writes: each advances the target row's version by 1.
    for (const formula of formulaWrites) {
      const expectedRowVersion = rowVersions.get(formula.rowId)
      if (expectedRowVersion === undefined) continue
      await mutateScientificFormula(
        formula.source
          ? ({
              operation: formula.existing ? 'update' : 'create',
              target: {
                tableId: table.id,
                rowId: formula.rowId,
                columnId: formula.columnId,
              },
              expectedSchemaVersion: table.schema_version,
              expectedRowVersion,
              ...(formula.existing
                ? { expectedFormulaVersion: Number(formula.existing.version) }
                : {}),
              source: formula.source,
            } as Parameters<typeof mutateScientificFormula>[0])
          : {
              operation: 'remove',
              target: {
                tableId: table.id,
                rowId: formula.rowId,
                columnId: formula.columnId,
              },
              expectedSchemaVersion: table.schema_version,
              expectedRowVersion,
              expectedFormulaVersion: Number(formula.existing!.version),
              replacement: formula.replacement,
            },
      )
      rowVersions.set(formula.rowId, expectedRowVersion + 1)
      this.formulaRowVersions.set(formula.rowId, expectedRowVersion + 1)
      // Notify the caller so it can optimistically update the formulas
      // query cache. This makes the formula bar update immediately after
      // a formula write without waiting for the refetch in
      // onCalculationNeeded.
      this.config.onFormulaPersisted?.(
        {
          tableId: table.id,
          rowId: formula.rowId,
          columnId: formula.columnId,
        },
        formula.source ?? null,
      )
    }

    return changedRows
  }
}
