import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Section,
} from '#/components/v3/ui/layout'
import { ObjectLink } from '#/components/v3/ui/object-link'
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
import { fetchAnalysisViews } from '#/lib/analysis-studio-data'
import { resolveDatasetRef } from '#/lib/chart-data'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'
import { useExperimentFiles } from './-files-tab'
import type { ExperimentFile } from './-files-tab'
import { useExperimentRecord } from '../$expId'
import { t } from '#/copy'

const PREVIEW_ROWS = 11
const PREVIEW_COLUMNS = 8

function cellText(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The instruments whose exports fed a dataset, as the board's Source column
 * names them: "PR-01, TB-02 exports". */
function sourceText(files: ExperimentFile[], identifier: string): string {
  const codes = files.flatMap((file) =>
    file.feeds
      .filter((f) => f.kind === 'dataset' && f.identifier === identifier)
      .flatMap((f) =>
        f.receipt.instrument
          ? [f.receipt.instrument.split(' ').at(-1) as string]
          : [],
      ),
  )
  return codes.length
    ? t('projects.expDatasets.exports', {
        list: [...new Set(codes)].join(', '),
      })
    : '—'
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
  const allColumns = resolved.data?.source.columns ?? []
  const columns = allColumns.slice(0, PREVIEW_COLUMNS)
  const flags = resolved.data?.flags ?? []
  const flagged = new Map(
    flags.map((f) => [`${f.rowId}:${f.fieldId}`, f] as const),
  )
  const all = resolved.data?.rows ?? []
  // A window of the table that includes the flagged row, so a reader sees the
  // value that needs a look among its neighbours.
  const rowNumber = new Map(all.map((row, i) => [row, i + 1] as const))
  const flaggedAt = all.findIndex((row) =>
    flags.some((f) => f.rowId === row[CHART_ROW_ID_KEY]),
  )
  const start =
    flaggedAt < 0
      ? 0
      : Math.max(0, Math.min(flaggedAt - 7, all.length - PREVIEW_ROWS))
  const shown = all.slice(start, start + PREVIEW_ROWS)
  return (
    <Section
      title={dataset.id}
      action={
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/datasets/$datasetId/snapshots"
                params={{ datasetId: dataset.uuid }}
              />
            }
          >
            {t('projects.expDatasets.snapshots')}
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <a
                href={`/api/export/dataset/${dataset.uuid}?format=csv`}
                aria-label={t('projects.expDatasets.downloadLabel', {
                  name: dataset.name,
                })}
              />
            }
          >
            {t('projects.expDatasets.download')}
          </Button>
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
            {t('projects.expDatasets.open')}
          </Button>
        </span>
      }
    >
      {resolved.isLoading ? (
        <p className="m-0 text-label text-fg-muted">
          {t('projects.expDatasets.reading')}
        </p>
      ) : shown.length === 0 ? (
        <EmptyState
          className="py-2"
          title={t('projects.expDatasets.noRows.title')}
          description={t('projects.expDatasets.noRows.body')}
        />
      ) : (
        <>
          <TableBox>
            <table
              aria-label={t('projects.expDatasets.rowsLabel', {
                id: dataset.id,
              })}
              className="num w-full border-collapse text-body"
            >
              <thead>
                <tr>
                  <th className="h-8 bg-surface-muted px-3 text-left text-label font-medium text-fg-muted">
                    {t('projects.expDatasets.row')}
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className="h-8 bg-surface-muted px-3 text-left text-label font-medium text-fg-muted"
                    >
                      {column.label}
                    </th>
                  ))}
                  <th className="h-8 bg-surface-muted px-3 text-left text-label font-medium text-fg-muted">
                    {t('projects.expDatasets.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => {
                  const rowId = row[CHART_ROW_ID_KEY] as string | undefined
                  const hit = flags.find((f) => f.rowId === rowId)
                  return (
                    <tr key={index} className="border-t border-border-subtle">
                      <td className="h-8 px-3 text-fg-muted">
                        {rowNumber.get(row)}
                      </td>
                      {columns.map((column) => {
                        const isFlagged = flagged.has(`${rowId}:${column.id}`)
                        return (
                          <td
                            key={column.id}
                            className={
                              isFlagged
                                ? 'h-8 px-3 font-medium text-danger-text'
                                : 'h-8 px-3'
                            }
                          >
                            {cellText(row[column.id])}
                          </td>
                        )
                      })}
                      <td className="h-8 px-3">
                        {hit ? (
                          <Status tone="bad">
                            {hit.kind === 'out_of_range'
                              ? t('projects.expDatasets.outOfRange')
                              : t('projects.expDatasets.flagged')}
                          </Status>
                        ) : (
                          <Status tone="ok">
                            {t('projects.expDatasets.valid')}
                          </Status>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableBox>
          <p className="mb-0 mt-2 text-label text-fg-muted">
            {t('projects.expDatasets.showing', {
              shown: shown.length,
              total: resolved.data?.totalCount ?? dataset.rows,
            })}
          </p>
        </>
      )}
    </Section>
  )
}

/** The newest committed import of a dataset: when, by whom, with which parser
 * and file hash. */
function useLatestImport(datasetId: string) {
  return useQuery({
    queryKey: ['ui-port', 'experiment-datasets', 'import', datasetId],
    queryFn: async () => {
      const imports = await notebookDataClient.list<{
        created_at: string
        created_by_user_id: string | null
        parser_id: string | null
        file_id: string | null
      }>(
        'dataset_imports',
        `?dataset_id=eq.${datasetId}&status=eq.committed&order=created_at.desc&limit=1&select=created_at,created_by_user_id,parser_id,file_id`,
      )
      const latest = imports.at(0)
      if (!latest) return null
      const [parser, file] = await Promise.all([
        latest.parser_id
          ? notebookDataClient.list<{ name: string }>(
              'parsers',
              `?id=eq.${latest.parser_id}&select=name`,
            )
          : Promise.resolve([]),
        latest.file_id
          ? notebookDataClient.list<{ checksum: string }>(
              'dataset_import_files',
              `?id=eq.${latest.file_id}&select=checksum`,
            )
          : Promise.resolve([]),
      ])
      return {
        importedAt: latest.created_at,
        by: latest.created_by_user_id,
        parser: parser.at(0)?.name ?? null,
        checksum: file.at(0)?.checksum ?? null,
      }
    },
    staleTime: 30_000,
  })
}

function DatasetFacts({
  dataset,
  files,
}: {
  dataset: DatasetListRow
  files: ExperimentFile[]
}) {
  const validation = datasetValidation(dataset)
  const provenance = useLatestImport(dataset.uuid)
  const resolved = useQuery({
    queryKey: ['ui-port', 'experiment-datasets', 'preview', dataset.uuid],
    queryFn: () =>
      resolveDatasetRef(notebookDataClient, { datasetId: dataset.uuid }),
    staleTime: 15_000,
  })
  const analyses = useQuery({
    queryKey: ['ui-port', 'experiment-datasets', 'analyses', dataset.uuid],
    queryFn: async () =>
      (await fetchAnalysisViews(notebookDataClient)).filter((view) =>
        view.charts.some((c) =>
          c.datasets.some((d) => d.datasetId === dataset.uuid),
        ),
      ),
  })
  const { userLabel } = useUserNames(
    provenance.data?.by ? [provenance.data.by] : [],
  )
  const sources = files.filter((file) =>
    file.feeds.some((f) => f.kind === 'dataset' && f.identifier === dataset.id),
  )
  const flag = resolved.data?.flags?.at(0)
  const column = resolved.data?.source.columns.find(
    (c) => c.id === flag?.fieldId,
  )
  const data = provenance.data
  return (
    <Inspector
      aria-label={t('projects.expDatasets.dataset')}
      className="w-[300px]"
    >
      <div className="flex flex-col gap-1">
        <span className="mono text-fg-muted">{dataset.id}</span>
        <Status tone={validation.tone}>{validation.label}</Status>
      </div>
      <DescriptionList
        labelWidth={90}
        items={[
          [t('projects.expDatasets.model'), dataset.model],
          [
            t('projects.expDatasets.rows'),
            dataset.rows.toLocaleString('en-GB'),
          ],
          [t('projects.expDatasets.validation'), validation.label],
          [
            t('projects.expDatasets.usedBy'),
            analyses.data?.length ? (
              <span key="used" className="flex flex-wrap gap-x-2">
                {analyses.data.map((view) => (
                  <ObjectLink
                    key={view.id}
                    kind="analysis"
                    id={view.id}
                    identifier={view.display_id ?? view.name}
                  />
                ))}
              </span>
            ) : (
              '—'
            ),
          ],
        ]}
      />
      {sources.length || data ? (
        <InspectorSection title={t('projects.expDatasets.provenance')}>
          <DescriptionList
            labelWidth={90}
            items={[
              [
                t('projects.expDatasets.sources'),
                sources.length ? (
                  <span key="src" className="flex flex-col">
                    {sources.map((file) => (
                      <span key={file.id}>{file.name}</span>
                    ))}
                  </span>
                ) : (
                  '—'
                ),
              ],
              ...(data
                ? ([
                    [
                      t('projects.expDatasets.imported'),
                      formatDate(data.importedAt),
                    ],
                    [
                      t('projects.expDatasets.triggeredBy'),
                      data.by ? userLabel(data.by) : '—',
                    ],
                    [t('projects.expDatasets.parser'), data.parser ?? '—'],
                    [
                      t('projects.expDatasets.sha'),
                      data.checksum ? (
                        <span key="sha" className="mono">
                          {data.checksum.slice(0, 4)}…{data.checksum.slice(-4)}
                        </span>
                      ) : (
                        '—'
                      ),
                    ],
                  ] as Array<[string, React.ReactNode]>)
                : []),
            ]}
          />
        </InspectorSection>
      ) : null}
      {flag ? (
        <InspectorSection title={t('projects.expDatasets.selected')}>
          <p className="m-0 text-label">
            {t('projects.expDatasets.flagNote', {
              label: column?.label ?? t('projects.expDatasets.aValue'),
              value: cellText(flag.evaluatedValue),
              reason: flag.reason.replace(/^Value [\d.]+ /, 'is '),
            })}
          </p>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/datasets/$datasetId/rows"
                params={{ datasetId: dataset.uuid }}
              />
            }
          >
            {t('projects.expDatasets.openRow')}
          </Button>
        </InspectorSection>
      ) : null}
    </Inspector>
  )
}

/** The datasets this experiment produced: what each is, whether it validates,
 * and the first rows of the selected one. */
export function ExperimentDatasets({ expId }: { expId: string }) {
  const record = useExperimentRecord(expId)
  const identifier = record.data?.identifier
  const summaries = useDatasetSummaries()
  const files = useExperimentFiles(expId)
  const datasets: Array<DatasetListRow & { source: string }> = (
    summaries.data ?? []
  )
    .filter((d) => identifier && d.experimentId === identifier && !d.archived)
    .map((d) => ({ ...d, source: sourceText(files.data ?? [], d.id) }))
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked ?? datasets.at(0)?.uuid ?? null
  const selected = datasets.find((d) => d.uuid === selectedId)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setPicked,
  )
  const columns: RegistryColumn<DatasetListRow & { source: string }>[] = [
    {
      id: 'dataset',
      header: t('projects.expDatasets.dataset'),
      cell: ({ row }) => (
        <>
          <span className="mono">{row.original.id}</span> {row.original.name}
        </>
      ),
    },
    {
      id: 'model',
      header: t('projects.expDatasets.model'),
      accessorFn: (d) => d.model,
    },
    {
      id: 'rows',
      header: t('projects.expDatasets.rows'),
      meta: { cellClassName: 'num' },
      accessorFn: (d) => d.rows,
    },
    {
      id: 'validation',
      header: t('projects.expDatasets.validation'),
      cell: ({ row }) => {
        const v = datasetValidation(row.original)
        return <Status tone={v.tone}>{v.label}</Status>
      },
    },
    {
      id: 'source',
      header: t('projects.expDatasets.source'),
      accessorFn: (d) => d.source,
    },
  ]
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <Section
          title={t('projects.expDatasets.datasets')}
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
                {t('projects.expDatasets.analyse')}
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/import" search={{ experiment: expId }} />}
              >
                {t('projects.expDatasets.import')}
              </Button>
            </span>
          }
        >
          {datasets.length ? (
            <TableBox>
              <RegistryGrid
                label={t('projects.expDatasets.datasets')}
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
              title={t('projects.expDatasets.none.title')}
              description={t('projects.expDatasets.none.body')}
            />
          )}
        </Section>
        {selected ? <DatasetRowsPreview dataset={selected} /> : null}
      </div>
      {selected ? (
        <DatasetFacts dataset={selected} files={files.data ?? []} />
      ) : null}
    </>
  )
}
