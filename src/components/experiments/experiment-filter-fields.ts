import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choiceFilter,
  dateFilter,
  textFilter,
  useRecordFilterFields,
} from '#/components/inventory/list-filter-fields'
import { t } from '#/copy'
import { experimentStatusOptions } from './experiments-data'

/** What the experiments list can be filtered by (see `EXPERIMENT_FILTER_COLUMNS`). */
export function useExperimentFilterFields(): readonly SheetbaseField[] {
  const { project, owner } = useRecordFilterFields()

  return useMemo(
    () => [
      textFilter('identifier', t('projects.experimentsList.filter.id')),
      textFilter('title', t('projects.experimentsList.filter.title')),
      choiceFilter(
        'status',
        t('projects.searchFilter.fields.status'),
        experimentStatusOptions(),
      ),
      project,
      owner,
      {
        ...owner,
        id: 'assignee',
        label: t('projects.experimentsList.filter.assignee'),
      },
      dateFilter('plannedEnd', t('projects.experimentsList.filter.plannedEnd')),
      dateFilter('created', t('projects.searchFilter.fields.created')),
      dateFilter('updated', t('projects.searchFilter.fields.updated')),
    ],
    [project, owner],
  )
}
