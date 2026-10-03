import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Input } from '#/components/v3/ui/input'
import { Status } from '#/components/v3/ui/status'
import { DataTable } from '#/components/scientific/data-table'
import { pickerStatus } from '#/components/v3/record-picker/record-picker-data'
import { displayModelFieldValue } from '#/lib/model-fields'
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

/**
 * MDL-04.1: records list for a workspace-defined record model (ADR-0051).
 * Columns are the model's active fields in display order; the table is the
 * shared TanStack `DataTable`, and CSV export reuses the canonical delimited
 * serializers. No second table or field engine.
 */
export function RecordModelRecords({ modelKey }: { modelKey: string }) {
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

  const columns = useMemo<ColumnDef<RecordModelRecord, unknown>[]>(() => {
    const base: ColumnDef<RecordModelRecord, unknown>[] = [
      {
        id: 'identifier',
        header: 'ID',
        accessorFn: (record) => record.identifier,
        cell: ({ getValue }) => (
          <span className="mono">{String(getValue() ?? '')}</span>
        ),
        meta: { className: 'whitespace-nowrap' },
      },
      {
        id: 'title',
        header: 'Name',
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
        header: 'Status',
        accessorFn: (record) => record.status,
        cell: ({ row }) => {
          const mapped = pickerStatus(row.original.status)
          return <Status tone={mapped.tone}>{mapped.label}</Status>
        },
      },
    ]
    return [
      ...base,
      ...fields.map<ColumnDef<RecordModelRecord, unknown>>((field) => ({
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
      })),
    ]
  }, [fields, modelKey])

  const exportCsv = () => {
    const csv = recordModelCsv(visible, fields)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${model.data?.key ?? modelKey}-records.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const loading =
    model.isLoading || fieldsQuery.isLoading || recordsQuery.isLoading

  const toolbar = (
    <>
      <label className="block w-full md:w-[220px]">
        <span className="sr-only">Search records</span>
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={`Search ${model.data?.name ?? 'records'}`}
          className="h-8 text-body"
        />
      </label>
      <select
        aria-label="Filter by status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-label text-fg"
      >
        <option value="">All statuses</option>
        {statuses.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by field"
        value={fieldName}
        onChange={(event) => setFieldName(event.target.value)}
        className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-label text-fg"
      >
        <option value="">Any field</option>
        {fields.map((field) => (
          <option key={field.fieldName} value={field.fieldName}>
            {field.label}
          </option>
        ))}
      </select>
      <Input
        value={fieldValue}
        disabled={!fieldName}
        onChange={(event) => setFieldValue(event.target.value)}
        placeholder="Field contains…"
        aria-label="Field value"
        className="h-8 w-[160px] text-body disabled:text-fg-faint"
      />
      <Button
        variant="secondary"
        size="sm"
        icon="download"
        disabled={!visible.length}
        onClick={exportCsv}
      >
        Export CSV
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
        New {model.data?.name ?? 'record'}
      </Button>
    </>
  )

  if (!model.isLoading && !model.data) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title="Model not found"
          body={`No workspace record model with the key “${modelKey}” is visible in this workspace.`}
        >
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link to="/models" />}
          >
            Back to Models
          </Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-4 md:px-6">
      <p className="m-0 mb-3 flex items-center gap-1.5 text-label text-fg-muted">
        <Icon name="schema" size={12} />
        Columns are this model’s fields. Add a field to the model and every{' '}
        {model.data?.name ?? 'record'} gets it; existing records show it as not
        yet recorded.
      </p>
      <DataTable
        label={`${model.data?.name ?? 'Model'} records`}
        columns={columns}
        data={visible}
        getRowId={(record) => record.id}
        enableColumnVisibility
        toolbar={toolbar}
        emptyMessage={
          loading
            ? 'Loading records…'
            : q || status || fieldValue
              ? 'No records match the current search and filters.'
              : 'No records yet.'
        }
      />
    </div>
  )
}
