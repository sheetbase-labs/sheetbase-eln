import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'

import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { DataTable } from '#/components/scientific/data-table'
import type { DataTableFeatures } from '#/components/scientific/data-table'
import { pickerStatus } from '#/components/record-picker/record-picker-data'
import { displayModelFieldValue } from '#/lib/model-fields'
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

function RecordModelRecordList({ modelKey }: { modelKey: string }) {
  const model = useWorkspaceRecordModel(modelKey)
  const fieldsQuery = useRecordModelFields(modelKey)
  const recordsQuery = useRecordModelRecords(modelKey)

  const fields = fieldsQuery.data ?? []
  const records = recordsQuery.data ?? []

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [fieldName, setFieldName] = useState('')
  const [fieldValue, setFieldValue] = useState('')
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
  const visible = useMemo(() => {
    const matching = filterRecordModelRecords(records, fields, {
      q,
      status,
      fieldName,
      fieldValue,
    })
    return judged && results === 'out'
      ? matching.filter((record) => {
          const verdict = verdictByRecord.get(record.id)
          return verdict === 'fail' || verdict === 'alert'
        })
      : matching
  }, [
    records,
    fields,
    q,
    status,
    fieldName,
    fieldValue,
    judged,
    results,
    verdictByRecord,
  ])

  const [selected, setSelected] = useState<RecordModelRecord[]>([])
  const plugin = usePluginTableHooks({ modelKey, fields, records })

  const columns = useMemo<
    ColumnDef<DataTableFeatures, RecordModelRecord, unknown>[]
  >(() => {
    const base: ColumnDef<DataTableFeatures, RecordModelRecord, unknown>[] = [
      {
        id: 'identifier',
        header: t('library.models.recordModelRecords.id'),
        accessorFn: (record) => record.identifier,
        cell: ({ getValue }) => (
          <span className="mono">{String(getValue() ?? '')}</span>
        ),
        meta: { className: 'whitespace-nowrap' },
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
        meta: { className: 'min-w-[180px]' },
      },
      {
        id: 'status',
        header: t('library.models.recordModelRecords.status'),
        accessorFn: (record) => record.status,
        cell: ({ row }) => {
          const mapped = pickerStatus(row.original.status)
          return <Status tone={mapped.tone}>{mapped.label}</Status>
        },
      },
    ]
    if (judged) {
      base.push({
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
      })
    }
    return [
      ...base,
      ...fields.map<ColumnDef<DataTableFeatures, RecordModelRecord, unknown>>(
        (field) => ({
          id: `field:${field.fieldName}`,
          header: field.label,
          accessorFn: (record) =>
            displayModelFieldValue(
              field,
              recordFieldValue(record, field.fieldName),
            ),
          cell: ({ getValue, row }) => {
            const display = plugin.cellDisplay(field)
            return display ? (
              <CellDisplayView
                spec={display}
                value={recordFieldValue(row.original, field.fieldName)}
              />
            ) : (
              <span className="block max-w-[240px] truncate">
                {String(getValue() ?? '')}
              </span>
            )
          },
          meta: { className: 'max-w-[240px]' },
        }),
      ),
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

  const toolbar = (
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
      <Select
        aria-label={t('library.models.recordModelRecords.filterByStatus')}
        size="sm"
        className="h-8"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        <option value="">
          {t('library.models.recordModelRecords.allStatuses')}
        </option>
        {statuses.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      {judged ? (
        <Select
          aria-label={t('quality.limits.filter')}
          size="sm"
          className="h-8"
          value={results}
          onChange={(event) => setResults(event.target.value as '' | 'out')}
        >
          <option value="">{t('quality.limits.filterAll')}</option>
          <option value="out">{t('quality.limits.filterOut')}</option>
        </Select>
      ) : null}
      <Select
        aria-label={t('library.models.recordModelRecords.filterByField')}
        size="sm"
        className="h-8"
        value={fieldName}
        onChange={(event) => setFieldName(event.target.value)}
      >
        <option value="">
          {t('library.models.recordModelRecords.anyField')}
        </option>
        {fields.map((field) => (
          <option key={field.fieldName} value={field.fieldName}>
            {field.label}
          </option>
        ))}
      </Select>
      <Input
        value={fieldValue}
        disabled={!fieldName}
        onChange={(event) => setFieldValue(event.target.value)}
        placeholder={t('library.models.recordModelRecords.fieldContains')}
        aria-label={t('library.models.recordModelRecords.fieldValue')}
        className="h-8 w-[160px] text-body disabled:text-fg-faint"
      />
      <IconButton
        variant="secondary"
        icon="download"
        label={t('library.models.recordModelRecords.exportCsv')}
        disabled={!visible.length}
        onClick={exportCsv}
      />
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
      <DataTable
        label={t('library.models.shared.nameRecords', {
          name:
            model.data?.name ?? t('library.models.recordModelRecords.model'),
        })}
        columns={columns}
        data={visible}
        getRowId={(record) => record.id}
        enableColumnVisibility
        enableRowSelection={plugin.actions.length > 0}
        onSelectionChange={setSelected}
        toolbar={toolbar}
        emptyMessage={
          loading
            ? t('library.models.recordModelRecords.loadingRecords')
            : q || status || fieldValue || results
              ? t('library.models.recordModelRecords.noRecordsMatchTheCurrent')
              : t('library.models.recordModelRecords.noRecordsYet')
        }
      />
    </div>
  )
}
