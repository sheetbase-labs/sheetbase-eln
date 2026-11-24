/**
 * The Results tab of a record: every dataset row whose link column holds the
 * record, one table per measurement table. A row opens the exact row in its
 * dataset; its dataset and any linked record are links with peek.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { RecordLinkValue } from '#/components/datasets/record-link-value'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { EmptyState } from '#/components/ui/empty-state'
import { Section } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { TableBox } from '#/components/ui/table'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { formatQuantity } from '#/lib/format-quantity'
import { linkedRecordIds, useRecordLinkLabels } from '#/lib/record-link-labels'
import type { RecordLinkLabels } from '#/lib/record-link-labels'
import {
  groupColumns,
  groupRecordResults,
  resultRowHref,
  RECORD_RESULTS_PAGE,
  useRecordResults,
} from '#/lib/record-results'
import type {
  RecordResultGroup,
  RecordResultRow,
  RecordResultValue,
} from '#/lib/record-results'

function ResultValue({
  cell,
  labels,
}: {
  cell: RecordResultValue | undefined
  labels: RecordLinkLabels
}) {
  if (!cell || cell.value === null || cell.value === undefined) return <>—</>

  if (cell.type === 'reference')
    return <RecordLinkValue value={cell.value} labels={labels} />

  const items = Array.isArray(cell.value) ? cell.value : [cell.value]

  const shown = items.map((item) => {
    const num = z.number().safeParse(item)

    if (num.success) return formatQuantity(num.data)

    const flag = z.boolean().safeParse(item)

    if (flag.success)
      return flag.data
        ? t('features.recordResults.yes')
        : t('features.recordResults.no')

    if (cell.type === 'timestamp' || cell.type === 'date')
      return formatDate(String(item), { time: cell.type === 'timestamp' })

    return String(item)
  })

  return <>{shown.join(', ')}</>
}

function useGroupColumns(group: RecordResultGroup, labels: RecordLinkLabels) {
  return useMemo<RegistryColumn<RecordResultRow>[]>(() => {
    const own: RegistryColumn<RecordResultRow>[] = [
      {
        id: 'dataset',
        header: t('features.recordResults.dataset'),
        accessorFn: (row) => row.datasetDisplayId ?? row.datasetName,
        enableHiding: false,
        cell: ({ row }) => (
          <ObjectLink
            kind="dataset"
            id={row.original.datasetId}
            identifier={
              row.original.datasetDisplayId ?? row.original.datasetName
            }
          />
        ),
      },
      {
        id: 'source',
        header: t('features.recordResults.source'),
        accessorFn: (row) => row.source,
        cell: ({ row }) =>
          row.original.source === 'snapshot' ? (
            <Badge variant="kind">
              {t('features.recordResults.snapshot', {
                label: row.original.snapshotLabel ?? '',
              })}
            </Badge>
          ) : (
            <span className="text-fg-muted">
              {row.original.status === 'planned'
                ? t('features.recordResults.planned')
                : t('features.recordResults.live')}
            </span>
          ),
      },
    ]

    const fields: RegistryColumn<RecordResultRow>[] = groupColumns(group)
      // The column that holds this record says nothing new on its page.
      .filter((column) => !column.linksHere)
      .map((column) => ({
        id: `field:${column.key}`,
        header: column.unit ? `${column.label} (${column.unit})` : column.label,
        accessorFn: (row) =>
          String(
            row.values.find((value) => value.key === column.key)?.value ?? '',
          ),
        cell: ({ row }) => (
          <ResultValue
            cell={row.original.values.find((value) => value.key === column.key)}
            labels={labels}
          />
        ),
        meta:
          column.type === 'integer' || column.type === 'decimal'
            ? { cellClassName: 'num text-right', headerClassName: 'text-right' }
            : undefined,
      }))

    const recorded: RegistryColumn<RecordResultRow> = {
      id: 'recorded',
      header: t('features.recordResults.recorded'),
      accessorFn: (row) => row.recordedAt ?? '',
      cell: ({ row }) => formatDate(row.original.recordedAt),
      meta: { cellClassName: 'num text-fg-muted' },
    }

    return [...own, ...fields, recorded]
  }, [group, labels])
}

function ResultsTable({
  group,
  labels,
}: {
  group: RecordResultGroup
  labels: RecordLinkLabels
}) {
  const navigate = useNavigate()
  const columns = useGroupColumns(group, labels)

  const openRow = useOpenRow<RecordResultRow>(
    navigate,
    resultRowHref,
    (row) => row.datasetDisplayId ?? row.datasetName,
  )

  return (
    <Section
      title={group.tableName}
      count={t('features.recordResults.rows', { count: group.rows.length })}
    >
      <TableBox>
        <RegistryGrid
          label={t('features.recordResults.tableLabel', {
            table: group.tableName,
          })}
          rows={group.rows}
          columns={columns}
          getRowId={(row) =>
            `${row.source}:${row.snapshotId ?? ''}:${row.rowId}`
          }
          selectable={false}
          // Every value stays; a wide table scrolls rather than drop columns.
          fit={false}
          onRowClick={(row) => openRow(row)}
        />
      </TableBox>
    </Section>
  )
}

export function RecordResults({
  recordId,
  action,
  variant = 'page',
}: {
  recordId: string
  /** A button the page keeps beside the results, such as Record reading. */
  action?: React.ReactNode
  /** `panel` sits inside an inspector: no page padding or heading. */
  variant?: 'page' | 'panel'
}) {
  const [includeSnapshots, setIncludeSnapshots] = useState(false)
  const query = useRecordResults(recordId, includeSnapshots)
  const rows = useMemo(() => query.data?.rows ?? [], [query.data])
  const groups = useMemo(() => groupRecordResults(rows), [rows])

  const labels = useRecordLinkLabels(
    useMemo(
      () =>
        linkedRecordIds(
          rows.flatMap((row) =>
            row.values
              .filter((value) => value.type === 'reference' && !value.linksHere)
              .map((value) => value.value),
          ),
        ),
      [rows],
    ),
  )

  return (
    <div
      className={
        variant === 'panel'
          ? 'flex min-w-0 flex-col gap-4'
          : 'flex min-w-0 flex-1 flex-col gap-6 px-4 py-[22px] md:px-8'
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {variant === 'page' ? (
          <h2 className="text-section">{t('features.recordResults.title')}</h2>
        ) : null}
        <label
          className="flex items-center gap-2 text-label text-fg-muted"
          title={t('features.recordResults.snapshotsHint')}
        >
          <Checkbox
            checked={includeSnapshots}
            onCheckedChange={(checked) => setIncludeSnapshots(checked)}
          />
          {t('features.recordResults.snapshots')}
        </label>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {variant === 'page' ? (
        <p className="m-0 -mt-4 text-label text-fg-muted">
          {t('features.recordResults.intro')}
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-body text-fg-muted" aria-busy="true">
          {t('features.recordResults.loading')}
        </p>
      ) : query.isError ? (
        <EmptyState
          icon="warn"
          title={t('features.recordResults.error')}
          action={
            <Button variant="primary" onClick={() => void query.refetch()}>
              {t('features.recordResults.retry')}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="chart"
          title={t('features.recordResults.empty')}
          description={t('features.recordResults.emptyHint')}
        />
      ) : (
        <>
          {groups.map((group) => (
            <ResultsTable
              key={group.tableId}
              group={group}
              labels={labels.data ?? {}}
            />
          ))}
          {query.data && query.data.total > RECORD_RESULTS_PAGE ? (
            <p className="text-label text-fg-muted">
              {t('features.recordResults.more', {
                shown: rows.length,
                total: query.data.total,
              })}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
