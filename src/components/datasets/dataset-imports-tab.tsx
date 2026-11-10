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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { classifyDatasetTabAccess } from '#/components/datasets/dataset-detail-tabs'
import { fetchDatasetImports, importQueryKeys } from '#/lib/import/data'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import {
  INSTRUMENT_FLAG_LABELS,
  toDatasetImportRow,
} from './dataset-import-row'

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
          <TableBox>
            <Table aria-label={t('data.datasetImportsTab.imports')}>
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">
                    {t('data.datasetImportsTab.when')}
                  </TableHead>
                  <TableHead>{t('data.datasetImportsTab.file')}</TableHead>
                  <TableHead align="right">
                    {t('data.datasetImportsTab.rows')}
                  </TableHead>
                  <TableHead>{t('data.datasetImportsTab.parser')}</TableHead>
                  <TableHead>{t('data.datasetImportsTab.result')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="first:pl-3">{row.when}</TableCell>
                    <TableCell>
                      {row.importFileId ? (
                        <Link
                          to="/import/$importId"
                          params={{ importId: row.importFileId }}
                          search={row.resumeSearch}
                          className="text-link"
                        >
                          {row.file}
                        </Link>
                      ) : (
                        row.file
                      )}
                    </TableCell>
                    <TableCell align="right" className="num">
                      {row.rows}
                    </TableCell>
                    <TableCell>{row.parser}</TableCell>
                    <TableCell>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <Status tone={row.result.tone}>
                          {row.result.label}
                        </Status>
                        {row.instrumentFlags.length ? (
                          <span
                            title={row.instrumentFlags
                              .map((flag) => INSTRUMENT_FLAG_LABELS[flag])
                              .join(' ')}
                          >
                            <Status tone="warn">
                              {t('data.datasetImportsTab.flagged')}
                            </Status>
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
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
