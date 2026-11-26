import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choicesFrom,
  dateFilter,
  numberFilter,
  textFilter,
  useRecordFilterFields,
} from '#/components/inventory/list-filter-fields'
import { t } from '#/copy'
import type { DatasetListRow } from './datasets-data'

/** A dataset's values under the ids `useDatasetFilterFields` offers. */
export function datasetFilterRecord(
  d: DatasetListRow,
): Record<string, unknown> {
  return {
    id: d.id,
    name: d.name,
    model: d.model,
    experiment: d.experimentId,
    project: d.projectId,
    owner: d.createdByUserId,
    rows: d.rows,
    issues: d.issues,
    updated: d.updatedAt,
  }
}

/** What the datasets list can be filtered by. */
export function useDatasetFilterFields(
  rows: readonly DatasetListRow[],
): readonly SheetbaseField[] {
  const { project, owner } = useRecordFilterFields()

  return useMemo(
    () => [
      textFilter('id', t('data.datasetsList.filter.id')),
      textFilter('name', t('data.datasetsList.filter.name')),
      choicesFrom(
        'model',
        t('data.datasetsList.filter.model'),
        rows,
        (d) => d.model,
      ),
      choicesFrom(
        'experiment',
        t('data.datasetsList.filter.experiment'),
        rows,
        (d) => d.experimentId,
      ),
      project,
      owner,
      numberFilter('rows', t('data.datasetsList.filter.rows')),
      numberFilter('issues', t('data.datasetsList.filter.issues')),
      dateFilter('updated', t('data.datasetsList.filter.updated')),
    ],
    [rows, project, owner],
  )
}
