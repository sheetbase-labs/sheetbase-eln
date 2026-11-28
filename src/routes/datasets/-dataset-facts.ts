/**
 * The dataset's header facts for the shared record page: its structure, how
 * many rows it holds, who owns it and when it last changed.
 */
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import type { RecordFact } from '#/components/record-page/record-page'
import { formatDate } from '#/lib/notebook-data'
import { t } from '#/copy'

export function datasetFacts(
  dataset: DatasetListRow,
  userLabel: (userId: string) => string,
): RecordFact[] {
  return [
    { label: t('data.datasetPage.datasetSchema'), value: dataset.model },
    {
      label: t('data.datasetPage.rowsFact'),
      value: dataset.rows.toLocaleString('en-GB'),
      mono: true,
    },
    {
      label: t('data.datasetPage.owner'),
      value: dataset.createdByUserId ? userLabel(dataset.createdByUserId) : '—',
    },
    {
      label: t('data.datasetPage.updatedFact'),
      value: formatDate(dataset.updatedAt),
    },
  ]
}
