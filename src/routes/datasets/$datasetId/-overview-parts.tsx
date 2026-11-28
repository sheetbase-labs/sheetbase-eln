/**
 * The dataset Overview's own sections: the first rows, so the page shows what
 * the dataset holds without opening the grid, and its checks (value flags,
 * limits, units and the last import).
 */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { DatasetIssueActions } from '#/components/datasets/dataset-inspector'
import { RecordLinkValue } from '#/components/datasets/record-link-value'
import { toDatasetImportRow } from '#/components/datasets/dataset-import-row'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import { formatDatasetValue } from '#/components/datasets/value-action-presentation'
import { usePersonNames } from '#/components/models/person-names'
import { DescriptionList, Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import type { DatasetRowValues } from '#/lib/dataset-product'
import { fetchDatasetImports, importQueryKeys } from '#/lib/import/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { linkedRecordIds, useRecordLinkLabels } from '#/lib/record-link-labels'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/** How many rows and columns the Overview previews. */
const PREVIEW_ROWS = 5
const PREVIEW_COLUMNS = 6

interface PreviewField {
  field_id: string
  key: string
  label: string
  logical_type: string
}

interface PreviewPage {
  totalCount: number
  rows: { rowId: string; values: DatasetRowValues }[]
}

function useDatasetPreview(datasetId: string) {
  const schemaVersion = useQuery({
    queryKey: ['ui-port', 'dataset-schema-version', datasetId],
    queryFn: async () => {
      const rows = await notebookDataClient.list<{
        schema_version_id: string
      }>('datasets', `?id=eq.${datasetId}&select=schema_version_id`)

      return rows.at(0)?.schema_version_id ?? null
    },
  })

  const page = useQuery({
    queryKey: ['ui-port', 'dataset-preview-rows', datasetId],
    queryFn: () =>
      notebookDataClient.rpc<PreviewPage>('query_dataset_rows', {
        p_dataset_id: datasetId,
        p_limit: PREVIEW_ROWS,
        p_offset: 0,
      }),
  })

  const fields = useQuery({
    queryKey: ['ui-port', 'dataset-fields', schemaVersion.data],
    queryFn: () =>
      notebookDataClient.list<PreviewField>(
        'dataset_schema_version_fields',
        `?schema_version_id=eq.${schemaVersion.data}&order=display_order.asc&select=field_id,key,label,logical_type`,
      ),
    enabled: Boolean(schemaVersion.data),
  })

  return { page, fields }
}

/** Text and links read from the left; numbers, dates and times from the right. */
function readsLeft(logicalType: string): boolean {
  return logicalType === 'text' || logicalType === 'reference'
}

/**
 * The first few rows and columns, with the way to all of them. Cells read the
 * way the grid shows them: linked records by their ID, people by name.
 */
export function DatasetFirstRows({ dataset }: { dataset: DatasetListRow }) {
  const { page, fields } = useDatasetPreview(dataset.uuid)
  const rows = page.data?.rows ?? []
  const columns = (fields.data ?? []).slice(0, PREVIEW_COLUMNS)

  const linkIds = linkedRecordIds(
    rows.flatMap((row) =>
      columns
        .filter((f) => f.logical_type === 'reference')
        .map((f) => row.values[f.field_id]),
    ),
  )

  const labels = useRecordLinkLabels(linkIds).data ?? {}

  const people = usePersonNames(
    columns.some((f) => f.logical_type === 'person'),
  )

  return (
    <Section
      title={t('data.datasetOverview.firstRows')}
      count={
        rows.length
          ? t('data.datasetOverview.firstRowsCount', {
              shown: rows.length,
              total: dataset.rows,
            })
          : undefined
      }
      action={
        dataset.rows ? (
          <Link
            to="/datasets/$datasetId/rows"
            params={{ datasetId: dataset.uuid }}
            className="text-label text-link"
          >
            {t('data.datasetOverview.openAllRows')}
          </Link>
        ) : null
      }
    >
      {rows.length && columns.length ? (
        <TableBox>
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-border text-left text-label text-fg-muted">
                {columns.map((field) => (
                  <th
                    key={field.field_id}
                    className={cn(
                      'px-3 py-2 font-medium',
                      !readsLeft(field.logical_type) && 'text-right',
                    )}
                  >
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.rowId}
                  className="border-b border-border-subtle last:border-b-0"
                >
                  {columns.map((field) => (
                    <td
                      key={field.field_id}
                      className={cn(
                        'num max-w-[240px] truncate px-3 py-2',
                        !readsLeft(field.logical_type) && 'text-right',
                      )}
                    >
                      {field.logical_type === 'reference' ? (
                        <RecordLinkValue
                          value={row.values[field.field_id]}
                          labels={labels}
                        />
                      ) : (
                        formatDatasetValue(
                          field.logical_type,
                          row.values[field.field_id],
                          people,
                        )
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableBox>
      ) : page.isPending ? null : (
        <Muted>{t('data.datasetOverview.noRowsYet')}</Muted>
      )}
    </Section>
  )
}

/** Value flags, limits, units and the last import, in one place. */
export function DatasetChecks({ dataset }: { dataset: DatasetListRow }) {
  const imports = useQuery({
    queryKey: importQueryKeys.imports(dataset.uuid),
    queryFn: () => fetchDatasetImports(notebookDataClient, dataset.uuid),
  })

  const last = imports.data?.at(0)
  const lastRow = last ? toDatasetImportRow(last) : null

  return (
    <Section
      title={t('data.datasetOverview.checks')}
      count={dataset.issues || undefined}
    >
      <DescriptionList
        items={[
          [
            t('data.datasetOverview.valueFlags'),
            dataset.issues ? (
              <Status tone="warn">{dataset.issues}</Status>
            ) : (
              t('data.datasetOverview.noneOpen')
            ),
          ],
          [
            t('data.datasetOverview.outOfLimits'),
            dataset.outOfRange || t('data.datasetOverview.none'),
          ],
          [
            t('data.datasetOverview.missingUnits'),
            dataset.missingUnitFields.length
              ? dataset.missingUnitFields.join(', ')
              : t('data.datasetOverview.none'),
          ],
          [
            t('data.datasetOverview.lastImport'),
            lastRow
              ? t('data.datasetOverview.lastImportLine', {
                  when: lastRow.when,
                  count: lastRow.rows,
                  result: lastRow.result.label,
                })
              : t('data.datasetOverview.noImportYet'),
          ],
        ]}
      />
      {dataset.issues ? <DatasetIssueActions dataset={dataset} /> : null}
    </Section>
  )
}
