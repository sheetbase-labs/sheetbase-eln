import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { useListView } from '#/lib/list-views'
import { SheetFiltersButton } from '#/components/sheet/sheet-filters-popover'
import type {
  SheetbaseGridColumn,
  SheetbaseGridFilter,
} from '#/components/sheet/sheetbase-grid'
import { pickerStatus } from '#/components/record-picker/record-picker-data'
import { displayModelFieldValue } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { downloadTextFile } from '#/lib/download'
import { toast } from '#/components/ui/sonner'
import { Icon } from '#/components/icons'
import { SpecVerdictBadge } from '#/components/results/spec-verdict'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchFieldLimits,
  fetchKindResults,
  qualityKeys,
  useQualityOptions,
  worstVerdict,
} from '#/lib/result-quality'
import type { SpecVerdict } from '#/lib/result-quality'
import {
  filterRecordModelRecords,
  recordFieldValue,
  recordModelCsv,
  recordStatusOptions,
  useRecordModelFields,
  useRecordModelRecords,
  useWorkspaceRecordModel,
} from './models-data'
import type { RecordModelRecord } from './models-data'
import { SubtypeObjects } from './model-subtype-ui'
import {
  PluginActionBar,
  usePluginTableHooks,
} from '#/components/extensions/table-hooks'
import { CellDisplayView } from '#/components/extensions/cell-display'
import { PluginCell } from '#/components/extensions/plugin-cell-renderer'
import { t } from '#/copy'

/**
 * MDL-04.1: records list for a workspace-defined record model (ADR-0051).
 * Columns are the model's active fields in display order; the table is the
 * shared TanStack `DataTable`, and CSV export reuses the canonical delimited
 * serializers. No second table or field engine.
 */
export function RecordModelRecords({ modelKey }: { modelKey: string }) {
  const model = useWorkspaceRecordModel(modelKey)

  if (model.data?.parent_key) return <SubtypeObjects modelKey={modelKey} />

  return <RecordModelRecordList modelKey={modelKey} />
}

/** The popover's filters, applied to what the search left: every one must hold. */
function applyFilters(
  records: RecordModelRecord[],
  fields: ModelFieldDefinition[],
  filters: readonly SheetbaseGridFilter[],
): RecordModelRecord[] {
  if (filters.length === 0) return records

  const shown = (record: RecordModelRecord, columnId: string): string => {
    if (columnId === 'status') return record.status ?? ''

    const field = fields.find(
      (entry) => `field:${entry.fieldName}` === columnId,
    )

    return field
      ? displayModelFieldValue(field, recordFieldValue(record, field.fieldName))
      : ''
  }

  return records.filter((record) =>
    filters.every((filter) => {
      const value = shown(record, filter.columnId)

      if (filter.operator === 'is-empty') return value === ''

      if (filter.operator === 'is-not-empty') return value !== ''

      const same = value === String(filter.value ?? '')

      return filter.operator === 'equals' ? same : !same
    }),
  )
}

function useRecordList(modelKey: string) {
  const model = useWorkspaceRecordModel(modelKey)
  const fieldsQuery = useRecordModelFields(modelKey)
  const recordsQuery = useRecordModelRecords(modelKey)

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data])
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data])

  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<SheetbaseGridFilter[]>([])
  const [results, setResults] = useState<'' | 'out'>('')

  // Result limits: a column and a filter, only for a model that has limits.
  const quality = useQualityOptions(model.data?.workspace_id)

  const limitsQuery = useQuery({
    queryKey: qualityKeys.limits(modelKey),
    queryFn: () => fetchFieldLimits(notebookDataClient, modelKey),
    enabled: quality.specLimits,
  })

  const judged = quality.specLimits && (limitsQuery.data?.length ?? 0) > 0

  const outOfSpec = useQuery({
    queryKey: qualityKeys.kindResults(modelKey),
    queryFn: () => fetchKindResults(notebookDataClient, modelKey),
    enabled: judged,
  })

  const verdictByRecord = useMemo(() => {
    const grouped = new Map<string, { verdict: SpecVerdict }[]>()

    for (const r of outOfSpec.data ?? []) {
      grouped.set(r.recordId, [
        ...(grouped.get(r.recordId) ?? []),
        { verdict: r.verdict },
      ])
    }

    return new Map(
      [...grouped].map(([id, list]) => [id, worstVerdict(list)] as const),
    )
  }, [outOfSpec.data])

  const statuses = useMemo(() => recordStatusOptions(records), [records])

  const filterColumns = useMemo<SheetbaseGridColumn[]>(
    () => [
      {
        id: 'status',
        label: t('library.models.recordModelRecords.status'),
        source: 'local',
        type: 'select',
        options: statuses,
      },
      ...fields.map<SheetbaseGridColumn>((field) => ({
        id: `field:${field.fieldName}`,
        label: field.label,
        source: 'local',
        type: 'text',
      })),
    ],
    [statuses, fields],
  )

  const visible = useMemo(() => {
    const matching = applyFilters(
      filterRecordModelRecords(records, fields, { q }),
      fields,
      filters,
    )

    return judged && results === 'out'
      ? matching.filter((record) => {
          const verdict = verdictByRecord.get(record.id)

          return verdict === 'fail' || verdict === 'alert'
        })
      : matching
  }, [records, fields, q, filters, judged, results, verdictByRecord])

  // The ticked records feed the plugin actions; the list keeps what a person
  // chose to hide and how they sorted it.
  const bulk = useBulkSelection()
  const view = useListView(`model-records:${modelKey}`)

  const selected = useMemo(
    () => visible.filter((record) => bulk.has(record.id)),
    [visible, bulk],
  )

  const plugin = usePluginTableHooks({
    modelKey,
    fields,
    records,
    ready: !fieldsQuery.isLoading && !recordsQuery.isLoading,
  })

  const columns = useMemo<RegistryColumn<RecordModelRecord>[]>(() => {
    const base: RegistryColumn<RecordModelRecord>[] = [
      {
        id: 'identifier',
        header: t('library.models.recordModelRecords.id'),
        accessorFn: (record) => record.identifier,
        cell: ({ row }) => (
          <span className="mono">{row.original.identifier}</span>
        ),
      },
      {
        id: 'title',
        header: t('library.models.recordModelRecords.name'),
        accessorFn: (record) => record.title,
        cell: ({ row }) => (
          <Link
            to="/models/$modelId/records/$recordId"
            params={{ modelId: modelKey, recordId: row.original.id }}
            className="text-link"
          >
            {row.original.title}
          </Link>
        ),
        meta: { cellClassName: 'min-w-[180px]' },
      },
    ]

    const statusColumn: RegistryColumn<RecordModelRecord> = {
      id: 'status',
      meta: { cellClassName: 'min-w-[120px]!' },
      header: t('library.models.recordModelRecords.status'),
      accessorFn: (record) => record.status,
      cell: ({ row }) => {
        const mapped = pickerStatus(row.original.status)

        return <Status tone={mapped.tone}>{mapped.label}</Status>
      },
    }

    const judgedColumns: RegistryColumn<RecordModelRecord>[] = judged
      ? [
          {
            id: 'result',
            header: t('quality.limits.column'),
            accessorFn: (record) => verdictByRecord.get(record.id) ?? '',
            cell: ({ row }) => {
              const verdict = verdictByRecord.get(row.original.id)

              return verdict ? (
                <SpecVerdictBadge verdict={verdict} short />
              ) : (
                <span className="text-fg-faint">—</span>
              )
            },
          },
        ]
      : []

    return [
      ...base,
      ...fields.map<RegistryColumn<RecordModelRecord>>((field) => ({
        id: `field:${field.fieldName}`,
        header: field.label,
        accessorFn: (record) =>
          displayModelFieldValue(
            field,
            recordFieldValue(record, field.fieldName),
          ),
        cell: ({ row }) => {
          const renderer = plugin.cellRenderer(field)

          if (renderer)
            return (
              <PluginCell
                extensionKey={renderer.extensionKey}
                itemId={renderer.itemId}
                value={recordFieldValue(row.original, field.fieldName)}
              />
            )
          const display = plugin.cellDisplay(field)

          return display ? (
            <CellDisplayView
              spec={display}
              value={recordFieldValue(row.original, field.fieldName)}
            />
          ) : (
            <span className="block max-w-[240px] truncate">
              {displayModelFieldValue(
                field,
                recordFieldValue(row.original, field.fieldName),
              )}
            </span>
          )
        },
        meta: { cellClassName: 'max-w-[240px]' },
      })),
      statusColumn,
      ...judgedColumns,
      ...plugin.columns,
    ]
  }, [fields, modelKey, judged, verdictByRecord, plugin])

  const exportCsv = () => {
    const csv = recordModelCsv(visible, fields)

    try {
      downloadTextFile(
        `${model.data?.key ?? modelKey}-records.csv`,
        csv,
        'text/csv;charset=utf-8',
      )
    } catch (error) {
      toast(t('library.models.recordModelRecords.couldNotExportRecords'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.models.recordModelRecords.theDownloadFailed'),
      })
    }
  }

  const loading =
    model.isLoading || fieldsQuery.isLoading || recordsQuery.isLoading

  return {
    model,
    fields,
    q,
    setQ,
    filters,
    setFilters,
    filterColumns,
    results,
    setResults,
    statuses,
    judged,
    visible,
    selected,
    bulk,
    view,
    plugin,
    columns,
    exportCsv,
    loading,
  }
}

function RecordListToolbar({
  modelKey,
  list,
}: {
  modelKey: string
  list: ReturnType<typeof useRecordList>
}) {
  const {
    model,
    q,
    setQ,
    filters,
    setFilters,
    filterColumns,
    results,
    setResults,
    judged,
    visible,
    exportCsv,
  } = list

  return (
    <>
      <label className="block w-full md:w-[220px]">
        <span className="sr-only">
          {t('library.models.recordModelRecords.searchRecords')}
        </span>
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t('library.models.recordModelRecords.search', {
            name: model.data?.name ?? 'records',
          })}
          className="h-8 text-body"
        />
      </label>
      {judged ? (
        <Select
          aria-label={t('quality.limits.filter')}
          size="sm"
          className="h-8"
          value={results}
          onChange={(event) =>
            setResults(event.target.value === 'out' ? 'out' : '')
          }
        >
          <option value="">{t('quality.limits.filterAll')}</option>
          <option value="out">{t('quality.limits.filterOut')}</option>
        </Select>
      ) : null}
      <SheetFiltersButton
        columns={filterColumns}
        filters={filters}
        onChange={setFilters}
      />
      <Button
        size="sm"
        variant="secondary"
        icon="download"
        disabled={!visible.length}
        onClick={exportCsv}
      >
        {t('library.models.recordModelRecords.exportCsv')}
      </Button>
      <Button
        variant="primary"
        size="sm"
        nativeButton={false}
        render={
          <Link
            to="/models/$modelId/records/new"
            params={{ modelId: modelKey }}
          />
        }
      >
        {t('common.actions.new')} {model.data?.name ?? 'record'}
      </Button>
    </>
  )
}

function RecordModelRecordList({ modelKey }: { modelKey: string }) {
  const list = useRecordList(modelKey)

  const {
    model,
    fields,
    q,
    filters,
    results,
    visible,
    selected,
    bulk,
    view,
    plugin,
    columns,
    loading,
  } = list

  if (!model.isLoading && !model.data) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title={t('library.models.recordModelRecords.modelNotFound')}
          description={t(
            'library.models.recordModelRecords.noWorkspaceRecordModelWith',
            { modelKey },
          )}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/models" />}
            >
              {t('library.models.recordModelRecords.backToModels')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-4 md:px-6">
      <p className="m-0 mb-3 flex items-center gap-1.5 text-label text-fg-muted">
        <Icon name="schema" size={12} />
        {t('library.models.recordModelRecords.columnsAreThisModelsFields', {
          name: model.data?.name ?? 'record',
        })}
      </p>
      <PluginActionBar
        actions={plugin.actions}
        selected={selected}
        fields={fields}
        runner={plugin.runner}
      />
      {plugin.runner.dialog}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <RecordListToolbar modelKey={modelKey} list={list} />
      </div>
      {visible.length === 0 ? (
        <p className="m-0 text-label text-fg-muted" role="status">
          {loading
            ? t('library.models.recordModelRecords.loadingRecords')
            : q || filters.length > 0 || results
              ? t('library.models.recordModelRecords.noRecordsMatchTheCurrent')
              : t('library.models.recordModelRecords.noRecordsYet')}
        </p>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('library.models.shared.nameRecords', {
              name:
                model.data?.name ??
                t('library.models.recordModelRecords.model'),
            })}
            rows={visible}
            columns={columns}
            getRowId={(record) => record.id}
            rowLabel={(record) => record.identifier}
            selectable={false}
            bulk={plugin.actions.length > 0 ? bulk : undefined}
            view={view}
            exportName={`${model.data?.key ?? modelKey}-records`}
          />
        </TableBox>
      )}
    </div>
  )
}
