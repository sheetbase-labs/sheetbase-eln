/**
 * R5-SURF-01 — the dataset Imports tab.
 *
 * Result shape: one row per committed (or failed) import receipt from
 * `api.dataset_import_list` (DSET-02.3 / DSET-05.4), read through the same
 * `/api/db` boundary as every other screen — never a browser table read. Each
 * receipt already carries the frozen file, parser and outcome provenance the
 * commit wrote, so the tab shows When · File · Rows · Parser · Result without
 * joining the mutable parser catalogue.
 *
 * States are explicit: loading, denied (a non-member read), error, and the
 * honest empty state for a dataset that has never been imported into.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { classifyDatasetTabAccess } from '#/components/datasets/dataset-detail-tabs'
import { fetchDatasetImports, importQueryKeys } from '#/lib/import/data'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import {
  INSTRUMENT_FLAG_LABELS,
  toDatasetImportRow,
} from './dataset-import-row'
import type { DatasetImportRow } from './dataset-import-row'

function ImportsTable({ rows }: { rows: DatasetImportRow[] }) {
  const columns = useMemo<RegistryColumn<DatasetImportRow>[]>(
    () => [
      {
        id: 'when',
        header: t('data.datasetImportsTab.when'),
        accessorFn: (row) => row.when,
        enableHiding: false,
        cell: ({ row }) => row.original.when,
      },
      {
        id: 'file',
        header: t('data.datasetImportsTab.file'),
        accessorFn: (row) => row.file,
        cell: ({ row }) =>
          row.original.importFileId ? (
            <Link
              to="/import/$importId"
              params={{ importId: row.original.importFileId }}
              search={row.original.resumeSearch}
              className="text-link"
            >
              {row.original.file}
            </Link>
          ) : (
            row.original.file
          ),
      },
      {
        id: 'rows',
        header: t('data.datasetImportsTab.rows'),
        accessorFn: (row) => row.rows,
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => <span className="num">{row.original.rows}</span>,
      },
      {
        id: 'parser',
        header: t('data.datasetImportsTab.parser'),
        accessorFn: (row) => row.parser,
        cell: ({ row }) => row.original.parser,
      },
      {
        id: 'result',
        header: t('data.datasetImportsTab.result'),
        accessorFn: (row) => row.result.label,
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Status tone={row.original.result.tone}>
              {row.original.result.label}
            </Status>
            {row.original.instrumentFlags.length ? (
              <span
                title={row.original.instrumentFlags
                  .map((flag) => INSTRUMENT_FLAG_LABELS[flag])
                  .join(' ')}
              >
                <Status tone="warn">
                  {t('data.datasetImportsTab.flagged')}
                </Status>
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.datasetImportsTab.imports')}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        selectable={false}
      />
    </TableBox>
  )
}

export function DatasetImportsTab({
  datasetId,
  client = notebookDataClient,
}: {
  datasetId: string
  client?: DataClient
}) {
  const query = useQuery({
    queryKey: importQueryKeys.imports(datasetId),
    queryFn: () => fetchDatasetImports(client, datasetId),
  })

  const access = classifyDatasetTabAccess(query.error)

  if (query.isLoading) {
    return (
      <div className="px-4 py-6 md:px-6" aria-busy="true">
        <p className="text-body text-fg-muted">
          {t('data.datasetImportsTab.loadingImports')}
        </p>
      </div>
    )
  }

  if (access) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="upload"
          title={
            access === 'denied'
              ? t('data.datasetImportsTab.importsAvailable')
              : t('data.datasetImportsTab.importsCouldLoaded')
          }
          description={
            access === 'denied'
              ? t('data.datasetImportsTab.importReceiptsBelongDataset')
              : t('data.datasetImportsTab.importReceiptsCouldRead')
          }
          action={
            access === 'error' ? (
              <Button variant="primary" onClick={() => void query.refetch()}>
                {t('common.actions.tryAgain')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const rows = (query.data ?? []).map(toDatasetImportRow)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto px-4 py-5 md:px-6">
      <Section title={t('data.datasetImportsTab.imports')} count={rows.length}>
        {rows.length ? (
          <ImportsTable rows={rows} />
        ) : (
          <EmptyState
            icon="upload"
            title={t('data.datasetImportsTab.importsYet')}
            description={t('data.datasetImportsTab.rowsEnterDatasetImport')}
            action={
              <Button
                variant="primary"
                nativeButton={false}
                render={<Link to="/import" search={{ dataset: datasetId }} />}
              >
                {t('data.datasetImportsTab.importFile')}
              </Button>
            }
          />
        )}
      </Section>
    </div>
  )
}
