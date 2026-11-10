import { rich, t } from '#/copy'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react'
import { z } from 'zod'
import { ScientificColumnForm } from './scientific-sheet-column-form'
import { ScientificFormulaBar } from './scientific-sheet-formula-bar'
import { ScientificSheetFooter } from './scientific-sheet-footer'
import { ScientificSheetMessages } from './scientific-sheet-messages'
import {
  ScientificSchemaColumn,
  ScientificSchemaConfirmation,
} from './scientific-sheet-schema-column'
import { useScientificEditCoordinator } from './scientific-sheet-edit-coordinator'
import type { ScientificDraftCell as DraftCell } from './scientific-sheet-edit-coordinator'
import { useScientificSheetWorkbook } from './scientific-sheet-workbook'
import type { ScientificDisplayRow } from './scientific-sheet-workbook'
import {
  sheetbaseColumn,
  readColumnWidths,
  readColumnOrder,
  writeColumnPreferences,
} from './scientific-sheet-presentation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { shiftFormulaReferences } from './formula-references'
import { normalizeExponentiation } from '#/lib/formula-ir'
import type { NotebookBlock } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogHeader } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { SheetbaseTableGrid } from './sheetbase-grid'
import type {
  SheetbaseGridCellChange,
  SheetbaseGridCellValue,
  SheetbaseGridClipboardRange,
  SheetbaseGridHandle,
  SheetbaseGridMenuEntry,
  SheetbaseGridSelection,
  SheetbaseGridWriteSource,
} from './sheetbase-grid'
import { ScientificApiInspector } from './scientific-api-inspector'
import { useDataAccess, useIsWorkspaceAdmin } from '#/lib/data-access'
import { ScientificTransferPanel } from './scientific-transfer-panel'
import {
  addScientificColumn,
  deleteScientificRows,
  fetchAllScientificRows,
  fetchScientificFormulas,
  fetchScientificDependencies,
  fetchScientificCalculationResults,
  fetchScientificTable,
  mutateScientificFormula,
  requestScientificCalculation,
  renameScientificTable,
  scientificDataClient,
  scientificQueryKeys,
} from '#/lib/scientific-sheet-data'
import type {
  FormulaDependencyWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import { upgradeScientificSchema } from '#/lib/dataset-schema-data'
import type { WorkbookCellAddress } from '#/lib/scientific-workbook'
import type { SaveStatus } from '#/lib/grid-operation-coordinator'

type Confirmation = Parameters<
  typeof ScientificSchemaConfirmation
>[0]['confirmation']

function SchemaConfigurator({
  table,
  tableId,
  readOnly,
  draftColumnIds,
  rowMutationPending,
  formulaDependencies,
  onSuccess,
}: {
  table: ScientificTableWire
  tableId: string
  readOnly: boolean
  draftColumnIds: Set<string>
  rowMutationPending: boolean
  formulaDependencies: FormulaDependencyWire[]
  onSuccess: () => Promise<void>
}) {
  const isAdmin = useIsWorkspaceAdmin()
  const [nameDraft, setName] = useState<string | null>(null)
  const name = nameDraft ?? table.name
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [status, setStatus] = useState('')
  const version = useRef(table.schema_version)

  useEffect(() => {
    version.current = Math.max(version.current, table.schema_version)
  }, [table.schema_version])

  const schemaMutation = useMutation({
    scope: { id: `scientific-table:${tableId}` },
    mutationFn: async (run: (schemaVersion: number) => PromiseLike<object>) => {
      setStatus(t('notebook.scientificSheetBlock.migrationInProgress'))

      return run(version.current)
    },
    onSuccess: async () => {
      version.current += 1
      setConfirmation(null)
      await onSuccess()
      setStatus(t('notebook.scientificSheetBlock.schemaUpdatedSuccessfully'))
    },
    onError: async (error) => {
      setStatus(
        t('notebook.scientificSheetBlock.schemaUpdateFailed', {
          reason:
            error instanceof Error
              ? error.message
              : t('notebook.scientificSheetBlock.pleaseRetry'),
        }),
      )

      if (
        error instanceof DataClientError &&
        (error.code === 'service_unavailable' || error.code === 'stale_version')
      )
        await onSuccess()
    },
  })

  const disabled = readOnly || schemaMutation.isPending

  return (
    <div className="space-y-5">
      <DialogHeader
        title={t('notebook.scientificSheetBlock.title')}
        description={t('notebook.scientificSheetBlock.description')}
      />

      {formulaDependencies.length ? (
        <p className="text-xs text-warning-text" role="status">
          {t('notebook.scientificSheetBlock.sizePersistedFormulaS', {
            size: new Set(formulaDependencies.map((item) => item.formula_id))
              .size,
          })}
        </p>
      ) : null}

      <div className="space-y-1">
        <label className="text-label text-fg-muted" htmlFor="sheet-name">
          {t('notebook.scientificSheetBlock.sheetName')}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="sheet-name"
            aria-label={t('notebook.scientificSheetBlock.sheetName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="quiet"
            disabled={disabled || !name.trim() || name === table.name}
            onClick={() =>
              schemaMutation.mutate((v) =>
                renameScientificTable(
                  scientificDataClient,
                  tableId,
                  v,
                  name.trim(),
                ),
              )
            }
          >
            {t('notebook.scientificSheetBlock.saveName')}
          </Button>
        </div>
      </div>

      <hr className="border-border" />

      <ScientificColumnForm
        disabled={disabled}
        isAdmin={isAdmin}
        onError={setStatus}
        onAdd={(input) =>
          schemaMutation.mutate((schemaVersion) =>
            addScientificColumn(
              scientificDataClient,
              tableId,
              schemaVersion,
              input,
            ),
          )
        }
      />

      <hr className="border-border" />

      <div className="space-y-2">
        <div className="text-label font-medium text-fg-muted">
          {t('notebook.scientificSheetBlock.columns')}
        </div>
        <ol
          className="space-y-1.5"
          aria-label={t('notebook.scientificSheetBlock.columns')}
        >
          {table.columns.map((column, index) => (
            <ScientificSchemaColumn
              key={column.id}
              column={column}
              index={index}
              last={index === table.columns.length - 1}
              disabled={disabled}
              blocked={rowMutationPending || draftColumnIds.has(column.id)}
              schemaVersion={() => version.current}
              mutate={schemaMutation.mutate}
              onStatus={setStatus}
              onConfirm={setConfirmation}
            />
          ))}
        </ol>
        {rowMutationPending || draftColumnIds.size > 0 ? (
          <p role="status" className="text-xs text-warning-text">
            {t('notebook.scientificSheetBlock.saveOrDiscardPending')}
          </p>
        ) : null}
      </div>

      {confirmation ? (
        <ScientificSchemaConfirmation
          confirmation={confirmation}
          blocked={
            rowMutationPending || draftColumnIds.has(confirmation.column.id)
          }
          disabled={disabled}
          dependencyCount={
            new Set(
              formulaDependencies.flatMap((item) =>
                item.source_column_id === confirmation.column.id
                  ? [item.formula_id]
                  : [],
              ),
            ).size
          }
          mutate={schemaMutation.mutate}
          onCancel={() => {
            setConfirmation(null)
            setStatus(t('notebook.scientificSheetBlock.schemaChangeCancelled'))
          }}
        />
      ) : null}

      {status ? (
        <p role="status" className="text-xs">
          {status}
        </p>
      ) : null}

      <hr className="border-border" />

      {isAdmin ? (
        <details className="rounded-md border bg-surface-muted/20 p-2 text-xs text-fg-muted">
          <summary className="cursor-pointer font-medium">
            {t('notebook.scientificSheetBlock.developerInfo')}
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              {rich('notebook.scientificSheetBlock.apiResource', {
                resource: table.resource_name,
                id: table.id,
                code: (text) => <code className="font-mono">{text}</code>,
              })}
            </p>
            <p>{t('notebook.scientificSheetBlock.renamingAColumnDoes')}</p>
            <ul className="space-y-1 font-mono">
              {table.columns.map((column) => (
                <li key={column.id}>
                  {column.label}: <span>{column.field_name}</span> · {column.id}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </div>
  )
}

function useScientificSheetController(block: NotebookBlock, readOnly: boolean) {
  const tableId = z.string().catch('').parse(block.payload.tableId)

  const [issues, setIssues] = useState<Array<{ key: string; message: string }>>(
    [],
  )

  const [drafts, setDrafts] = useState<Record<string, DraftCell>>({})
  const [selected, setSelected] = useState<WorkbookCellAddress | null>(null)

  const [selectedCoords, setSelectedCoords] = useState<{
    row: number
    col: number
  } | null>(null)

  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const dataAccess = useDataAccess()
  const [formulaStatus, setFormulaStatus] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const nextGeneration = useRef(0)

  const queryClient = useQueryClient()

  const tableQuery = useQuery({
    queryKey: scientificQueryKeys.table(tableId),
    queryFn: () => fetchScientificTable(scientificDataClient, tableId),
    enabled: !!tableId,
  })

  const table = tableQuery.data

  // SCI-010: upgrade the bound sheet to a newer published schema revision.
  const upgradeMutation = useMutation({
    mutationFn: async (targetRevision: number) => {
      if (!table)
        throw new Error(t('notebook.scientificSheetBlock.tableNotLoaded'))

      return upgradeScientificSchema(
        scientificDataClient,
        table.id,
        targetRevision,
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.table(tableId),
      })
      await queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.allRows(tableId),
      })
    },
  })

  const allRowsKey = useMemo(
    () => scientificQueryKeys.allRows(tableId),
    [tableId],
  )

  const allRowsQuery = useQuery({
    queryKey: allRowsKey,
    queryFn: () => fetchAllScientificRows(scientificDataClient, table!),
    enabled: !!table,
  })

  const formulasQuery = useQuery({
    queryKey: scientificQueryKeys.formulas(tableId),
    queryFn: () => fetchScientificFormulas(scientificDataClient, tableId),
    enabled: !!table,
  })

  const dependenciesQuery = useQuery({
    queryKey: scientificQueryKeys.dependencies(tableId),
    queryFn: () => fetchScientificDependencies(scientificDataClient, tableId),
    enabled: !!tableId && configurationOpen,
  })

  const calculationResultsQuery = useQuery({
    queryKey: scientificQueryKeys.calculationResults(tableId),
    queryFn: () =>
      fetchScientificCalculationResults(scientificDataClient, tableId),
    enabled:
      !!tableId &&
      !!selected &&
      !!formulasQuery.data?.some(
        (formula) =>
          formula.target_row_id === selected.rowId &&
          formula.target_column_id === selected.columnId,
      ),
  })

  const { formulaByCell, tableWorkbook, calculationProblem, gridData } =
    useScientificSheetWorkbook({
      blockId: block.id,
      tableId,
      table,
      rows: allRowsQuery.data,
      formulas: formulasQuery.data,
      failed: allRowsQuery.isError || formulasQuery.isError,
    })

  const selectedFormula = selected
    ? formulaByCell.get(`${selected.rowId}/${selected.columnId}`)
    : undefined

  const refreshCalculation = async (reconcileRows = false) => {
    // Literal edits update the all-rows cache optimistically in onSuccess; do
    // not refetch them here or rapid successive edits would read a stale
    // reverted version. Only formula writes (which advance row versions
    // server-side without returning a row) and explicit recalculation need to
    // reconcile the canonical rows.
    //
    // The formulas query is NOT refetched here. The optimistic cache update
    // in onFormulaPersisted (coordinator path) or commitFormula (formula bar
    // path) already inserted the formula into the cache for immediate
    // formula bar display. A refetch would overwrite the optimistic data and
    // — critically — change formulasQuery.data, which recomputes gridData,
    // which recomputes settings, which triggers updateSettings on HotTable.
    // That updateSettings call can disrupt ongoing grid interactions like
    // autofill drags by calling loadData() mid-drag. Instead, we just
    // invalidate the formulas query so it refetches in the background
    // (non-awaited) and replaces the optimistic data when it completes —
    // hopefully when the user is not mid-interaction.
    void queryClient.invalidateQueries({
      queryKey: scientificQueryKeys.formulas(tableId),
    })

    if (reconcileRows) {
      await queryClient.invalidateQueries({ queryKey: allRowsKey })
    }

    try {
      await requestScientificCalculation(block.recordId)
      await queryClient.invalidateQueries({
        queryKey: scientificQueryKeys.calculationResults(tableId),
      })
    } catch (error) {
      setFormulaStatus(
        error instanceof Error
          ? error.message
          : t('notebook.scientificSheetBlock.trustedCalculationDidNot'),
      )
    }
  }

  const { coordinator, cacheFormula, recalculate } =
    useScientificEditCoordinator({
      tableId,
      table,
      readOnly,
      formulaByCell,
      workbook: tableWorkbook,
      onCalculate: refreshCalculation,
      setSelected,
      setDrafts,
      setIssues,
      setSaveStatus,
    })

  const formulaByCellRef = useRef(formulaByCell)
  useLayoutEffect(() => {
    formulaByCellRef.current = formulaByCell
  }, [formulaByCell])

  /**
   * Commit the formula bar's current text to the selected cell via
   * `mutateScientificFormula` (create or update), then trigger recalculation.
   * Called when the user presses Enter in the formula input. Errors are
   * surfaced through `formulaStatus`.
   */
  const commitFormula = useCallback(
    async (formulaSource: string) => {
      if (!selected || !table) return

      if (!formulaSource.startsWith('=')) return
      const normalized = normalizeExponentiation(formulaSource)

      // Provisional rows (optimistic Add Row) must route through the
      // coordinator, which will insert the row first and then apply the
      // formula to the server-created UUID. Calling mutateScientificFormula
      // directly with a `prov:` ID would fail because the server doesn't
      // know about the row yet.
      if (selected.rowId.startsWith('prov:')) {
        const column = table.columns.find((c) => c.id === selected.columnId)

        if (!column) return

        const rowIndex = (allRowsQuery.data ?? []).findIndex(
          (item) => item.id === selected.rowId,
        )

        coordinator.enqueue([
          {
            rowIndex:
              rowIndex >= 0 ? rowIndex : (allRowsQuery.data ?? []).length - 1,
            rowId: selected.rowId,
            columnId: selected.columnId,
            fieldName: column.field_name,
            raw: normalized,
            generation: ++nextGeneration.current,
          },
        ])
        setFormulaStatus('')

        return
      }

      const row = (allRowsQuery.data ?? []).find(
        (item) => item.id === selected.rowId,
      )

      if (!row) {
        // The row may have been removed by a refetch after a failed insert.
        // Don't tell the user to "save the row" — that's confusing when the
        // formula already evaluated locally. Route through the coordinator
        // which will re-insert if needed.
        coordinator.enqueue([
          {
            rowIndex: selectedCoords?.row ?? 0,
            rowId: selected.rowId,
            columnId: selected.columnId,
            fieldName:
              table.columns.find((c) => c.id === selected.columnId)
                ?.field_name ?? '',
            raw: normalized,
            generation: ++nextGeneration.current,
          },
        ])
        setFormulaStatus('')

        return
      }

      try {
        const input = {
          target: selected,
          expectedSchemaVersion: table.schema_version,
          expectedRowVersion: row.version,
          source: normalized,
        }

        await mutateScientificFormula(
          selectedFormula
            ? {
                ...input,
                operation: 'update',
                expectedFormulaVersion: Number(selectedFormula.version),
              }
            : { ...input, operation: 'create' },
        )
        // Optimistically update the formulas query cache so the formula bar
        // shows the source expression immediately. The refetch in
        // refreshCalculation will replace this with the full server-side
        // formula definition shortly after.
        cacheFormula(selected, normalized)
        setFormulaStatus('')
        // Don't reconcile rows for formula bar commits. Formula writes change
        // row versions on the server but don't change the row data that
        // gridData uses. Avoiding the allRows invalidation prevents a
        // background refetch that would recompute gridData → settings →
        // updateSettings on HotTable, which calls loadData() and can
        // overwrite the formula expression in the source data. If a stale
        // version error occurs on a subsequent literal edit, the coordinator
        // handles it by refetching.
        await recalculate(false)
      } catch (error) {
        setFormulaStatus(
          error instanceof Error
            ? error.message
            : t('notebook.scientificSheetBlock.couldNotSaveThe'),
        )
      }
    },
    [
      selected,
      selectedCoords,
      table,
      selectedFormula,
      allRowsQuery.data,
      coordinator,
      cacheFormula,
      recalculate,
    ],
  )

  // localRows: gridData + draft overlays. Used for localRowsRef (read by
  // afterChange/afterSelectionEnd callbacks to get row IDs) and the footer
  // row count. NOT passed to the grid — see gridData comment above.
  const localRows = useMemo(() => {
    const detached: ScientificDisplayRow[] = gridData.map((row) => ({ ...row }))

    for (const draft of Object.values(drafts)) {
      const rowIndex = draft.rowId
        ? detached.findIndex((row) => row.id === draft.rowId)
        : draft.rowIndex

      if (rowIndex < 0) continue
      detached[rowIndex] ??= {}
      detached[rowIndex][draft.fieldName] = draft.raw
    }

    return detached
  }, [gridData, drafts])

  const selectedCellDisplay = useMemo(() => {
    if (selectedFormula) return selectedFormula.source_expression

    if (!selected) return ''
    const row = localRows.find((candidate) => candidate.id === selected.rowId)

    const column = table?.columns.find(
      (candidate) => candidate.id === selected.columnId,
    )

    if (!row || !column) return ''
    const value = row[column.field_name]

    const scalar = z
      .union([z.string(), z.number(), z.boolean()])
      .safeParse(value)

    return scalar.success
      ? String(scalar.data)
      : value == null
        ? ''
        : JSON.stringify(value)
  }, [selectedFormula, selected, localRows, table])

  // Mirror `localRows` into a ref so the afterChange and afterSelectionEnd
  // callbacks can read current grid data without depending on `localRows` in
  // their useCallback deps. This keeps the callbacks stable across renders,
  // which prevents the settings memo from being recreated on every edit —
  // recreating settings triggers updateSettings, which reloads the grid data
  // and can interfere with the formulas plugin during multi-cell operations
  // like autofill.
  const localRowsRef = useRef(localRows)
  useLayoutEffect(() => {
    localRowsRef.current = localRows
  }, [localRows])

  // Track the source range of the last copy/cut so beforePaste can
  // translate relative A1 references by the row/column offset.
  const copySourceRef = useRef<{ startRow: number; startCol: number } | null>(
    null,
  )

  // COMP-06.3: the table backend hands back a neutral imperative handle; the
  // Add-row path uses it to select and reveal the row it just appended.
  const gridHandleRef = useRef<SheetbaseGridHandle | null>(null)

  const handleGridReady = useCallback((handle: SheetbaseGridHandle | null) => {
    gridHandleRef.current = handle
  }, [])

  const revealRowRef = useRef<number | null>(null)

  // Add Row: creates a provisional row optimistically in the query cache,
  // registers it with the coordinator for persistence, and selects its
  // first editable cell. The coordinator sends the insert RPC and swaps
  // the provisional ID for the server-created UUID on success.
  const addRow = useCallback(() => {
    if (readOnly || !table) return
    const provisionalId = `prov:${crypto.randomUUID()}`
    queryClient.setQueryData<ScientificRowWire[]>(allRowsKey, (old = []) => {
      revealRowRef.current = old.length

      return [...old, { id: provisionalId, version: 0 }]
    })
    coordinator.registerProvisionalRow(provisionalId)
  }, [readOnly, table, coordinator, queryClient, allRowsKey])

  // Row deletion: captures row IDs before removal, then persists via
  // deleteScientificRows. If the DB trigger blocks deletion (formula
  // dependencies), refetches to restore the row and surfaces the error.
  const removedRowIdsRef = useRef<string[]>([])

  const handleBeforeRemoveRow = useCallback(
    (rowIndex: number, amount: number) => {
      if (readOnly) return
      const rows = localRowsRef.current
      const ids: string[] = []
      let hasContent = false

      for (let i = rowIndex; i < rowIndex + amount; i++) {
        if (i >= rows.length) continue
        const row = rows[i]

        if (row.id) {
          if (row.id.startsWith('prov:')) continue
          ids.push(row.id)
        }

        for (const column of table?.columns ?? []) {
          if (
            row[column.field_name] !== null &&
            row[column.field_name] !== undefined
          ) {
            hasContent = true
            break
          }
        }
      }

      // Preflight: check if any formula depends on the rows being deleted.
      // The DB trigger blocks deletion of rows referenced by formulas
      // (SQLSTATE 23514); surfacing this before the request gives a clearer
      // error than a post-failure refetch.
      const deps = dependenciesQuery.data ?? []
      const blockedIds = new Set(ids)

      const blockingFormulas = deps.filter((d) =>
        blockedIds.has(d.source_row_id),
      )

      if (blockingFormulas.length) {
        const formulaIds = [
          ...new Set(blockingFormulas.map((d) => d.formula_id)),
        ]

        setIssues(
          formulaIds.map((fid) => ({
            key: `${fid}:delete-block`,
            message: t('notebook.scientificSheetBlock.message', {
              fid: fid.slice(0, 8),
            }),
          })),
        )

        return false
      }

      removedRowIdsRef.current = ids

      // Confirm non-empty or multi-row deletion.
      if (hasContent || amount > 1) {
        const message =
          amount > 1
            ? t('notebook.scientificSheetBlock.removeAmountRows', { amount })
            : t('notebook.scientificSheetBlock.removeThisRowIt')

        return window.confirm(message)
      }
    },
    [readOnly, table, dependenciesQuery.data],
  )

  const handleAfterRemoveRow = useCallback(
    async (_rowIndex: number, _amount: number, source: string) => {
      if (readOnly || !table) return

      if (source === 'formula' || source === 'load') return
      const rowIds = removedRowIdsRef.current
      removedRowIdsRef.current = []

      if (rowIds.length === 0) return

      try {
        await deleteScientificRows(
          scientificDataClient,
          table.resource_name,
          rowIds,
        )
        setIssues([])
        void recalculate(true)
      } catch (error) {
        // The DB trigger blocks deletion of rows with formula dependencies.
        // Refetch to restore the row in the grid (the grid already
        // removed it locally) and surface the error. Drafts are preserved
        // because they live in React state, not the query cache.
        await queryClient.invalidateQueries({ queryKey: allRowsKey })

        const message =
          error instanceof Error
            ? error.message.includes('formula') ||
              error.message.includes('23514')
              ? t('notebook.scientificSheetBlock.cannotRemoveRowsReferenced')
              : error.message
            : t('notebook.scientificSheetBlock.couldNotRemoveRow')

        setIssues(
          rowIds.map((id) => ({
            key: `${id}:delete`,
            message,
          })),
        )
      }
    },
    // refreshCalculation is NOT in the deps because it's a non-memoized
    // function that gets a new reference on every render. Including it
    // here would give handleAfterRemoveRow a new reference on every
    // render, which flows into the settings memo, which causes
    // SheetbaseGridClient to re-render and HotTable to call
    // updateSettings() — reloading all data and reverting formulas set
    // by autofill. Use the ref instead.
    [readOnly, table, allRowsKey, queryClient, recalculate],
  )

  // Memoize columns, colHeaders, and formulas config so they don't get new
  // object references on every re-render. Without this, React reconciliation
  // (e.g. setSelected from afterSelectionEnd) would give HotTable "changed"
  // props and reinitialize the grid, killing the cell editor.
  // COMP-06 step 1: the caller speaks Sheetbase terms only. Column types,
  // formula editing, the formula-reference clipboard and row-removal
  // persistence are expressed neutrally; the wrapper owns the engine mapping.
  const sheetColumns = useMemo(
    () =>
      table?.columns.map((column) => sheetbaseColumn(column, readOnly)) ?? [],
    [table?.columns, readOnly],
  )

  // gridData keeps the same value identity across draft changes (see the
  // gridData comment): the neutral rows are derived from it without overlaying
  // drafts, so the editor commit cycle is never disrupted.
  const sheetRows = useMemo(
    () =>
      table
        ? gridData.map((row) => ({
            id: row.id,
            cells: table.columns.map(
              (column) => row[column.field_name] ?? null,
            ),
          }))
        : [],
    [gridData, table],
  )

  const columnWidthsKey = `sheetbase:column-widths:${tableId}`
  const columnOrderKey = `sheetbase:column-order:${tableId}`

  // The first editable column is where an added row lands its active cell.
  const firstEditableColumnIndex = useMemo(
    () =>
      sheetColumns.findIndex(
        (column) => !column.readOnly && column.source !== 'calculated',
      ),
    [sheetColumns],
  )

  // Select and reveal a row the Add-row path appended, once the rebuilt rows
  // have reached the engine (the child's `replaceData` effect runs first).
  useEffect(() => {
    const handle = gridHandleRef.current
    const target = revealRowRef.current

    if (!handle || target == null) return
    revealRowRef.current = null

    if (firstEditableColumnIndex < 0) return
    const rowIndex = Math.min(target, Math.max(0, sheetRows.length - 1))
    handle.selectCell(rowIndex, firstEditableColumnIndex)
    handle.scrollCellIntoView(rowIndex, firstEditableColumnIndex)
  }, [sheetRows.length, firstEditableColumnIndex])

  const insertRows = useCallback(
    (amount: number) => {
      for (let index = 0; index < amount; index += 1) addRow()
    },
    [addRow],
  )

  const handleRowsInserted = useCallback(
    (_rowIndex: number, amount: number) => insertRows(amount),
    [insertRows],
  )

  const initialColumnWidths = useMemo(() => {
    if (!table) return undefined

    const stored = readColumnWidths(columnWidthsKey)

    return table.columns.map(
      (column) => stored[column.id] ?? column.width ?? 120,
    )
  }, [columnWidthsKey, table])

  const initialColumnOrder = useMemo(() => {
    if (!table) return undefined
    const stored = readColumnOrder(columnOrderKey)
    const currentIds = new Set(table.columns.map((column) => column.id))
    const storedIds = new Set(stored)

    return [
      ...stored.filter((id) => currentIds.has(id)),
      ...table.columns
        .map((column) => column.id)
        .filter((id) => !storedIds.has(id)),
    ]
  }, [columnOrderKey, table])

  // Memoize the change handler so it doesn't get a new function reference on
  // every render (which would reconfigure the grid and can kill the editor).
  const handleCellsChange = useCallback(
    (
      changes: readonly SheetbaseGridCellChange[],
      source: SheetbaseGridWriteSource,
    ) => {
      if (readOnly || source === 'load' || source === 'formula') return
      const generation = ++nextGeneration.current
      const rows = localRowsRef.current

      const columns = new Map(
        table?.columns.map((column) => [column.id, column]),
      )

      const cells: DraftCell[] = changes.flatMap((change) => {
        const column = columns.get(change.columnId)

        if (!column || !table) return []

        const rowId = change.rowId ?? rows[change.rowIndex]?.id ?? null

        return [
          {
            rowIndex: change.rowIndex,
            rowId,
            columnId: column.id,
            fieldName: column.field_name,
            raw: change.next,
            generation,
          },
        ]
      })

      // Defer setDrafts() to a microtask so the React state update does not
      // interfere with the editor commit cycle (it fires synchronously inside
      // the editor's finishEditing → saveValue path).
      queueMicrotask(() => {
        setDrafts((current) => {
          const next = { ...current }

          for (const cell of cells) {
            const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
            next[key] = { ...cell, generation }
          }

          return next
        })
      })
      coordinator.enqueue(cells)
    },
    [readOnly, table, coordinator],
  )

  // Memoize selection handling so it stays stable across renders.
  const handleSelectionChange = useCallback(
    (selection: SheetbaseGridSelection | null) => {
      if (!selection || !table) return

      const column = table.columns.find(
        (candidate) => candidate.id === selection.columnId,
      )

      const displayIndex = table.columns.findIndex(
        (candidate) => candidate.id === selection.columnId,
      )

      const rowId = selection.rowId ?? null
      setFormulaStatus('')
      setSelectedCoords({ row: selection.rowIndex, col: displayIndex })
      setSelected(
        rowId && column
          ? { tableId: table.id, rowId, columnId: column.id }
          : null,
      )

      // Don't show "Save the row before adding a formula" — provisional rows
      // (prov:…) and spare rows have no rowId, but the user can still enter
      // formulas. The coordinator handles persistence for provisional rows;
      // spare-row edits become inserts automatically.
      if (!rowId) setFormulaStatus('')
    },
    [table],
  )

  const preserveFormulaClipboard = useCallback(
    (data: SheetbaseGridCellValue[][], range: SheetbaseGridClipboardRange) => {
      if (!table) return

      const columns = new Map(
        table.columns.map((column) => [column.id, column]),
      )

      // Record the source start for paste-time reference translation.
      copySourceRef.current = {
        startRow: range.startRow,
        startCol: range.startColumn,
      }
      const rows = localRowsRef.current

      for (let rowOffset = 0; rowOffset < data.length; rowOffset++) {
        for (
          let colOffset = 0;
          colOffset < (data[rowOffset]?.length ?? 0);
          colOffset++
        ) {
          const rowIndex = range.startRow + rowOffset
          const row = rows.at(rowIndex)
          // Resolve the display column through its stable id (the adapter may
          // apply a persisted column order), falling back to the natural order.
          const columnId = range.columnIds?.[colOffset]

          const column = columnId
            ? columns.get(columnId)
            : table.columns.at(range.startColumn + colOffset)

          if (!row?.id || !column) continue
          const formula = formulaByCellRef.current.get(`${row.id}/${column.id}`)

          const source = z
            .string()
            .safeParse(formula?.source_expression ?? row[column.field_name])

          if (source.success && source.data.startsWith('='))
            data[rowOffset][colOffset] = source.data
        }
      }
    },
    [table],
  )

  const handlePaste = useCallback(
    (
      data: SheetbaseGridCellValue[][],
      target: { row: number; column: number },
    ) => {
      // Translate relative A1 references in pasted formulas by the row/column
      // offset between the copy source and paste target.
      const source = copySourceRef.current
      const rowOffset = source ? target.row - source.startRow : 0
      const colOffset = source ? target.column - source.startCol : 0

      for (const row of data)
        for (let column = 0; column < row.length; column++) {
          const value = z.string().safeParse(row[column])

          if (value.success && value.data.startsWith('='))
            row[column] = shiftFormulaReferences(
              value.data,
              rowOffset,
              colOffset,
            )
        }

      // Clear so a subsequent external paste doesn't use a stale offset.
      copySourceRef.current = null
    },
    [],
  )

  const handleColumnResize = useCallback(
    (columnId: string, newSize: number) => {
      const widths = readColumnWidths(columnWidthsKey)

      writeColumnPreferences(columnWidthsKey, {
        ...widths,
        [columnId]: newSize,
      })
    },
    [columnWidthsKey],
  )

  const handleColumnOrderChange = useCallback(
    (columnIds: string[]) => {
      writeColumnPreferences(columnOrderKey, columnIds)
    },
    [columnOrderKey],
  )

  const contextMenu = useMemo<SheetbaseGridMenuEntry[]>(
    () => [
      'insert-row-above',
      'insert-row-below',
      'remove-row',
      'separator',
      'cut',
      'copy',
      'paste',
      {
        id: 'clear-contents',
        label: t('notebook.scientificSheetBlock.clearContentsLabel'),
        skipEmpty: false,
      },
      'separator',
      'undo',
      'redo',
      'separator',
      {
        id: 'configure-columns',
        label: t('notebook.scientificSheetBlock.configureColumnsLabel'),
        onSelect: () => setConfigurationOpen(true),
      },
    ],
    [],
  )

  return {
    tableId,
    table,
    tableQuery,
    allRowsQuery,
    calculationResultsQuery,
    issues,
    calculationProblem,
    upgradeMutation,
    selected,
    selectedCoords,
    selectedCellDisplay,
    formulaStatus,
    commitFormula,
    setFormulaStatus,
    selectedFormula,
    sheetColumns,
    sheetRows,
    gridData,
    initialColumnWidths,
    initialColumnOrder,
    preserveFormulaClipboard,
    handlePaste,
    contextMenu,
    handleCellsChange,
    handleSelectionChange,
    handleColumnResize,
    handleColumnOrderChange,
    handleBeforeRemoveRow,
    handleAfterRemoveRow,
    handleRowsInserted,
    handleGridReady,
    localRows,
    saveStatus,
    coordinator,
    addRow,
    dataAccess,
    configurationOpen,
    setConfigurationOpen,
    transferOpen,
    setTransferOpen,
    inspectorOpen,
    setInspectorOpen,
    drafts,
    dependenciesQuery,
    refreshCalculation,
    onSchemaSuccess: async () => {
      await tableQuery.refetch()
      await queryClient.invalidateQueries({ queryKey: allRowsKey })
    },
  }
}

function ScientificSchemaDialog({
  open,
  onOpenChange,
  table,
  readOnly,
  drafts,
  saveStatus,
  dependencies,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: ScientificTableWire
  readOnly: boolean
  drafts: Record<string, DraftCell>
  saveStatus: SaveStatus
  dependencies: FormulaDependencyWire[] | undefined
  onSuccess: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <SchemaConfigurator
          table={table}
          tableId={table.id}
          readOnly={readOnly}
          draftColumnIds={
            new Set(Object.values(drafts).map((draft) => draft.columnId))
          }
          rowMutationPending={
            saveStatus === 'saving' || saveStatus === 'retrying'
          }
          formulaDependencies={dependencies ?? []}
          onSuccess={onSuccess}
        />
      </DialogContent>
    </Dialog>
  )
}

function ScientificInspectorDialog({
  open,
  onOpenChange,
  table,
  rows,
  selected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: ScientificTableWire
  rows: ScientificRowWire[]
  selected: WorkbookCellAddress | null
}) {
  const selectedRow = rows.find((row) => row.id === selected?.rowId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader
          title={t('notebook.scientificSheetBlock.apiInspector')}
          description={t(
            'notebook.scientificSheetBlock.fieldsAndRequestExamplesDescription',
          )}
        />
        <ScientificApiInspector
          table={table}
          selectedRowId={selected?.rowId}
          selectedRowVersion={selectedRow?.version}
          selectedColumnId={selected?.columnId}
        />
      </DialogContent>
    </Dialog>
  )
}

export function ScientificSheetBlock({
  block,
  readOnly = false,
}: {
  block: NotebookBlock
  readOnly?: boolean
}) {
  const {
    tableId,
    table,
    tableQuery,
    allRowsQuery,
    calculationResultsQuery,
    issues,
    calculationProblem,
    upgradeMutation,
    selected,
    selectedCoords,
    selectedCellDisplay,
    formulaStatus,
    commitFormula,
    setFormulaStatus,
    sheetColumns,
    sheetRows,
    gridData,
    initialColumnWidths,
    initialColumnOrder,
    preserveFormulaClipboard,
    handlePaste,
    contextMenu,
    handleCellsChange,
    handleSelectionChange,
    handleColumnResize,
    handleColumnOrderChange,
    handleBeforeRemoveRow,
    handleAfterRemoveRow,
    handleRowsInserted,
    handleGridReady,
    localRows,
    saveStatus,
    coordinator,
    addRow,
    dataAccess,
    configurationOpen,
    setConfigurationOpen,
    transferOpen,
    setTransferOpen,
    inspectorOpen,
    setInspectorOpen,
    drafts,
    dependenciesQuery,
    refreshCalculation,
    onSchemaSuccess,
  } = useScientificSheetController(block, readOnly)

  if (!tableId)
    return (
      <p role="alert">{t('notebook.scientificSheetBlock.invalidSheetBlock')}</p>
    )

  if (tableQuery.isPending || (table && allRowsQuery.isPending))
    return (
      <p role="status">
        {t('notebook.scientificSheetBlock.loadingScientificSheet')}
      </p>
    )

  if (tableQuery.isError || allRowsQuery.isError)
    return (
      <p role="alert">
        {t('notebook.scientificSheetBlock.couldNotLoadScientific')}
      </p>
    )

  if (!table)
    return (
      <p role="alert">
        {t('notebook.scientificSheetBlock.scientificSheetNotFound')}
      </p>
    )

  return (
    <div className="group/sheet border-t border-border/50 pt-1.5">
      <ScientificSheetMessages
        issues={issues}
        calculationProblem={calculationProblem}
        schema={table.dataset_schema}
        readOnly={readOnly}
        upgrading={upgradeMutation.isPending}
        onUpgrade={upgradeMutation.mutate}
      />

      {readOnly ? null : (
        <ScientificFormulaBar
          key={JSON.stringify(selected)}
          display={selectedCellDisplay}
          selected={!!selected}
          coords={selectedCoords}
          status={formulaStatus}
          onCommit={commitFormula}
          onStatusClear={() => setFormulaStatus('')}
        />
      )}

      <SheetbaseTableGrid
        columns={sheetColumns}
        rows={sheetRows}
        ariaLabel={table.name}
        rowHeaders
        readOnly={readOnly}
        spareRows={readOnly ? 0 : 1}
        stretch="all"
        height={Math.min(
          Math.max(
            (gridData.length + 1) * 30 + 40,
            table.columns.length > 0 ? 80 : 48,
          ),
          600,
        )}
        initialColumnWidths={initialColumnWidths}
        columnOrder={initialColumnOrder}
        clipboard={{
          onCopy: preserveFormulaClipboard,
          onCut: preserveFormulaClipboard,
          onPaste: handlePaste,
        }}
        contextMenuItems={readOnly ? false : contextMenu}
        onCellsChange={handleCellsChange}
        onSelectionChange={handleSelectionChange}
        onColumnResize={handleColumnResize}
        onColumnOrderChange={handleColumnOrderChange}
        onBeforeRowsRemove={handleBeforeRemoveRow}
        onRowsRemoved={handleAfterRemoveRow}
        onRowsInserted={handleRowsInserted}
        onReady={handleGridReady}
      />

      <ScientificSheetFooter
        table={table}
        rowCount={localRows.length}
        readOnly={readOnly}
        saveStatus={saveStatus}
        dataAccess={dataAccess}
        calculating={calculationResultsQuery.isFetching}
        onRetry={() => void coordinator.retry()}
        onAdd={addRow}
        onConfigure={() => setConfigurationOpen(true)}
        onExport={() => setTransferOpen(true)}
        onInspect={() => setInspectorOpen(true)}
        onRecalculate={() => void refreshCalculation()}
      />

      <ScientificSchemaDialog
        open={configurationOpen}
        onOpenChange={setConfigurationOpen}
        table={table}
        readOnly={readOnly}
        drafts={drafts}
        saveStatus={saveStatus}
        dependencies={dependenciesQuery.data}
        onSuccess={onSchemaSuccess}
      />

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader
            title={t('notebook.scientificSheetBlock.sheetExportTitle')}
            description={t(
              'notebook.scientificSheetBlock.exportThisSheetWithDescription',
            )}
          />
          <ScientificTransferPanel
            table={table}
            rows={allRowsQuery.data ?? []}
          />
        </DialogContent>
      </Dialog>

      <ScientificInspectorDialog
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        table={table}
        rows={allRowsQuery.data ?? []}
        selected={selected}
      />
    </div>
  )
}
