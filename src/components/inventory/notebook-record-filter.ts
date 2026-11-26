import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import type { NotebookRecord } from '#/lib/notebook-data'
import { t } from '#/copy'
import {
  choicesFrom,
  customValueFields,
  customValueRecord,
  dateFilter,
  textFilter,
  useRecordFilterFields,
} from './list-filter-fields'

/** A record's values under the ids `useNotebookRecordFilterFields` offers. */
export function notebookRecordFilterRecord(
  r: NotebookRecord,
): Record<string, unknown> {
  return {
    identifier: r.identifier,
    title: r.title,
    status: r.status,
    project: r.projectId,
    owner: r.createdByUserId,
    tags: r.tags.join(' '),
    created: r.createdAt,
    updated: r.updatedAt,
    ...customValueRecord(r.customFields),
  }
}

/**
 * What a list of records can be filtered by: the columns every record has,
 * then each field its model adds, typed by the values the rows hold.
 */
export function useNotebookRecordFilterFields(
  rows: readonly NotebookRecord[],
  statusLabel: (status: string) => string = (status) => status,
): readonly SheetbaseField[] {
  const { project, owner } = useRecordFilterFields()

  return useMemo(
    () => [
      textFilter('identifier', t('common.filter.id')),
      textFilter('title', t('common.filter.title')),
      {
        ...choicesFrom(
          'status',
          t('common.filter.status'),
          rows,
          (r) => r.status,
        ),
        loadOptions: async (query: string) =>
          [...new Set(rows.map((r) => r.status))]
            .sort()
            .map((value) => ({ value, label: statusLabel(value) }))
            .filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
      },
      project,
      owner,
      textFilter('tags', t('common.filter.tags')),
      dateFilter('created', t('common.filter.created')),
      dateFilter('updated', t('common.filter.updated')),
      ...customValueFields(rows.map((r) => r.customFields)),
    ],
    [rows, statusLabel, project, owner],
  )
}
