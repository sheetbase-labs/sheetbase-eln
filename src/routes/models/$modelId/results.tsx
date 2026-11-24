import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '#/components/ui/empty-state'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  measurementTableSources,
  queryMeasurementTableRows,
  resultKeys,
} from '#/features/measurement-results/data'
import type {
  ResultMode,
  ResultQuery,
  ResultRow,
} from '#/features/measurement-results/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'

/**
 * The Results tab of a measurement table: its rows across every dataset you can
 * open, live or at each dataset's newest snapshot, with the dataset and snapshot
 * of each row. The same call the API, assistant and pipelines use.
 */
export const Route = createFileRoute('/models/$modelId/results')({
  component: ModelResults,
})

const PAGE = 200

function ModelResults() {
  const { modelId } = Route.useParams()
  const [mode, setMode] = useState<ResultMode>('live')
  const [datasetId, setDatasetId] = useState('')

  const sources = useQuery({
    queryKey: resultKeys.sources(modelId),
    queryFn: () => measurementTableSources(notebookDataClient, modelId),
  })

  const query = useMemo<ResultQuery>(() => {
    const next: ResultQuery = { mode }

    if (datasetId) next.datasets = [datasetId]

    return next
  }, [mode, datasetId])

  const result = useQuery({
    queryKey: resultKeys.rows(modelId, query, 0),
    queryFn: () =>
      queryMeasurementTableRows(notebookDataClient, modelId, query, PAGE, 0),
  })

  const data = result.data

  const columns = useMemo<RegistryColumn<ResultRow>[]>(() => {
    const provenance: RegistryColumn<ResultRow>[] = [
      {
        id: 'dataset',
        header: t('features.measurementResults.datasetColumn'),
        cell: ({ row }) => (
          <Link
            to="/datasets/$datasetId"
            params={{ datasetId: row.original.datasetId }}
          >
            <span className="mono">
              {row.original.datasetDisplayId ?? row.original.datasetName}
            </span>
          </Link>
        ),
      },
      {
        id: 'snapshot',
        header: t('features.measurementResults.snapshotColumn'),
        cell: ({ row }) =>
          row.original.live ? (
            <span className="text-fg-muted">
              {t('features.measurementResults.live')}
            </span>
          ) : (
            (row.original.snapshotLabel ?? '')
          ),
      },
    ]

    const own = (data?.columns ?? []).map<RegistryColumn<ResultRow>>(
      (column) => ({
        id: `v-${column.key}`,
        header: column.label,
        cell: ({ row }) => {
          const value = row.original.values[column.key]

          if (value === null) return ''

          return Array.isArray(value) ? value.join(', ') : String(value)
        },
      }),
    )

    return [...provenance, ...own]
  }, [data?.columns])

  if (result.isError)
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title={t('features.measurementResults.loadError')}
        />
      </div>
    )

  const rows = data?.rows ?? []

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-fg-muted">
            {t('features.measurementResults.mode')}
          </span>
          <Select
            size="sm"
            value={mode}
            onChange={(event) =>
              setMode(
                event.target.value === 'latest_snapshot'
                  ? 'latest_snapshot'
                  : 'live',
              )
            }
          >
            <option value="live">
              {t('features.measurementResults.modeLive')}
            </option>
            <option value="latest_snapshot">
              {t('features.measurementResults.modeSnapshot')}
            </option>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-fg-muted">
            {t('features.measurementResults.datasets')}
          </span>
          <Select
            size="sm"
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            <option value="">
              {t('features.measurementResults.allDatasets')}
            </option>
            {(sources.data ?? []).map((dataset) => (
              <option key={dataset.datasetId} value={dataset.datasetId}>
                {dataset.displayId ?? dataset.name} · {dataset.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {data && rows.length === 0 && !result.isFetching ? (
        <EmptyState
          icon="table"
          title={t('features.measurementResults.empty')}
          description={t('features.measurementResults.emptyHint')}
        />
      ) : (
        <TableBox>
          <RegistryGrid
            label={data?.tableName ?? ''}
            rows={rows}
            columns={columns}
            getRowId={(row) =>
              `${row.datasetVersionId ?? row.datasetId}:${row.rowId}`
            }
            selectable={false}
          />
        </TableBox>
      )}
      {data ? (
        <div className="mt-3 space-y-1">
          <Muted>
            {t('features.measurementResults.summary', {
              rows: data.totalCount,
              datasets:
                data.sources.length === 1
                  ? t('features.measurementResults.oneDataset', { count: 1 })
                  : t('features.measurementResults.someDatasets', {
                      count: data.sources.length,
                    }),
            })}
          </Muted>
          {data.skipped.length > 0 ? (
            <Muted>
              {t('features.measurementResults.leftOut', {
                names: data.skipped
                  .map((item) => item.displayId ?? item.name)
                  .join(', '),
              })}
            </Muted>
          ) : null}
          {data.hasMore ? (
            <Muted>
              {t('features.measurementResults.more', {
                shown: rows.length,
                total: data.totalCount,
              })}
            </Muted>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
