import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choiceFilter,
  dateFilter,
  textFilter,
  useRecordFilterFields,
} from '#/components/inventory/list-filter-fields'
import { t } from '#/copy'

const SAMPLE_STATUSES = [
  'available',
  'reserved',
  'frozen',
  'quarantined',
  'expired',
  'hold_exceeded',
  'consumed',
  'disposed',
].map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' '),
}))

/** What the sample list can be filtered by (see `SAMPLE_FILTER_COLUMNS`). */
export function useSampleFilterFields(): readonly SheetbaseField[] {
  const { project, owner } = useRecordFilterFields()

  return useMemo(
    () => [
      textFilter('identifier', t('library.samples.list.id')),
      textFilter('name', t('library.samples.list.name')),
      textFilter('type', t('library.samples.list.type')),
      textFilter('location', t('library.samples.list.location')),
      choiceFilter('status', t('library.samples.list.status'), SAMPLE_STATUSES),
      project,
      owner,
      dateFilter('created', t('projects.searchFilter.fields.created')),
      dateFilter('updated', t('projects.searchFilter.fields.updated')),
    ],
    [project, owner],
  )
}
