import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Inspector, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'
import { resolveDatasetRef } from '#/lib/chart-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { useExperimentRecord } from '../$expId'

const PREVIEW_ROWS = 11
const PREVIEW_COLUMNS = 8

function cellText(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The first rows of the selected dataset, so a result can be read without
 * leaving the experiment. The full table, flags and history are on the dataset. */
function DatasetRowsPreview({ dataset }: { dataset: DatasetListRow }) {
  const resolved = useQuery({
    queryKey: ['ui-port', 'experiment-datasets', 'preview', dataset.uuid],
    queryFn: () =>
      resolveDatasetRef(notebookDataClient, { datasetId: dataset.uuid }),
    staleTime: 15_000,
  })
  const columns = (resolved.data?.source.columns ?? []).slice(
    0,
    PREVIEW_COLUMNS,
  )
  const rows = (resolved.data?.rows ?? []).slice(0, PREVIEW_ROWS)
  return (
    <Section
      title={dataset.id}
      action={
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/datasets/$datasetId"
              params={{ datasetId: dataset.uuid }}
            />
          }
        >
          Open dataset
        </Button>
      }
    >
      {resolved.isLoading ? (
        <p className="m-0 text-label text-fg-muted">Reading rows…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          className="py-2"
          title="No rows yet"
          description="Imported or planned rows appear here."
        />
      ) : (
        <>
          <TableBox>
            <table
              aria-label={`${dataset.id} rows`}
              className="num w-full border-collapse text-body"
            >
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className="h-8 bg-surface-muted px-3 text-left text-label font-medium text-fg-muted"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-border-subtle">
                    {columns.map((column) => (
                      <td key={column.id} className="h-8 px-3">
                        {cellText(row[column.id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
          <p className="mb-0 mt-2 text-label text-fg-muted">
            Showing {rows.length} of {resolved.data?.totalCount ?? dataset.rows}{' '}
            rows
          </p>
        </>
      )}
    </Section>
  )
}

function DatasetFacts({ dataset }: { dataset: DatasetListRow }) {
  const validation = datasetValidation(dataset)
  return (
    <Inspector aria-label="Dataset" className="w-[300px]">
      <div className="flex flex-col gap-1">
        <span className="mono text-fg-muted">{dataset.id}</span>
        <Status tone={validation.tone}>{validation.label}</Status>
      </div>
      <DescriptionList
        labelWidth={90}
        items={[
          ['Model', dataset.model],
          ['Rows', dataset.rows.toLocaleString('en-GB')],
          ['Updated', dataset.updated],
        ]}
      />
    </Inspector>
  )
}

/** The datasets this experiment produced: what each is, whether it validates,
 * and the first rows of the selected one. */
export function ExperimentDatasets({ expId }: { expId: string }) {
  const record = useExperimentRecord(expId)
  const identifier = record.data?.identifier
  const summaries = useDatasetSummaries()
  const datasets = (summaries.data ?? []).filter(
    (d) => identifier && d.experimentId === identifier && !d.archived,
  )
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked ?? datasets.at(0)?.uuid ?? null
  const selected = datasets.find((d) => d.uuid === selectedId)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setPicked,
  )
  const columns: RegistryColumn<DatasetListRow>[] = [
    {
      id: 'dataset',
      header: 'Dataset',
      cell: ({ row }) => (
        <>
          <span className="mono">{row.original.id}</span> {row.original.name}
        </>
      ),
    },
    { id: 'model', header: 'Model', accessorFn: (d) => d.model },
    {
      id: 'rows',
      header: 'Rows',
      meta: { cellClassName: 'num' },
      accessorFn: (d) => d.rows,
    },
    {
      id: 'validation',
      header: 'Validation',
      cell: ({ row }) => {
        const v = datasetValidation(row.original)
        return <Status tone={v.tone}>{v.label}</Status>
      },
    },
  ]
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <Section
          title="Datasets"
          count={datasets.length}
          action={
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/analysis/new"
                    search={{
                      mode: 'chart',
                      experiment: expId,
                      returnTo: `/experiments/${expId}/datasets`,
                    }}
                  />
                }
              >
                Analyse
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/import" search={{ experiment: expId }} />}
              >
                Import data
              </Button>
            </span>
          }
        >
          {datasets.length ? (
            <TableBox>
              <RegistryGrid
                label="Datasets"
                rows={datasets}
                columns={columns}
                getRowId={(d) => d.uuid}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                isLoading={summaries.isLoading}
              />
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title="No datasets yet"
              description="Datasets produced by this experiment appear here when they are linked."
            />
          )}
        </Section>
        {selected ? <DatasetRowsPreview dataset={selected} /> : null}
      </div>
      {selected ? <DatasetFacts dataset={selected} /> : null}
    </>
  )
}
