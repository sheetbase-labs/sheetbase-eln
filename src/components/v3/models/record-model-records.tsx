import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { DataTable } from '#/components/scientific/data-table'
import type { DataTableFeatures } from '#/components/scientific/data-table'
import { pickerStatus } from '#/components/v3/record-picker/record-picker-data'
import { displayModelFieldValue } from '#/lib/model-fields'
import { downloadTextFile } from '#/lib/download'
import { toast } from '#/components/v3/ui/sonner'
import { Icon } from '#/components/v3/icons'
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

  const statuses = useMemo(() => recordStatusOptions(records), [records])
  const visible = useMemo(
    () =>
      filterRecordModelRecords(records, fields, {
        q,
        status,
        fieldName,
        fieldValue,
      }),
    [records, fields, q, status, fieldName, fieldValue],
  )

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
          cell: ({ getValue }) => (
            <span className="block max-w-[240px] truncate">
              {String(getValue() ?? '')}
            </span>
          ),
          meta: { className: 'max-w-[240px]' },
        }),
      ),
    ]
  }, [fields, modelKey])

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
      <Button
        variant="secondary"
        size="sm"
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
      <DataTable
        label={t('library.models.shared.nameRecords', {
          name:
            model.data?.name ?? t('library.models.recordModelRecords.model'),
        })}
        columns={columns}
        data={visible}
        getRowId={(record) => record.id}
        enableColumnVisibility
        toolbar={toolbar}
        emptyMessage={
          loading
            ? t('library.models.recordModelRecords.loadingRecords')
            : q || status || fieldValue
              ? t('library.models.recordModelRecords.noRecordsMatchTheCurrent')
              : t('library.models.recordModelRecords.noRecordsYet')
        }
      />
    </div>
  )
}
