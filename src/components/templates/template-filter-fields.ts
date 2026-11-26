import type { FilterRecord } from '#/lib/list-filter'
import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choicesFrom,
  numberFilter,
  textFilter,
  useRecordFilterFields,
} from '#/components/inventory/list-filter-fields'
import { t } from '#/copy'
import type { TemplateRow } from './templates-data'
import { templateLifecycle } from './templates-data'

/** A template's values under the ids `useTemplateFilterFields` offers. */
export function templateFilterRecord(row: TemplateRow): FilterRecord {
  return {
    key: row.displayId ?? row.key,
    name: row.name,
    lifecycle: templateLifecycle(row.lifecycle).label,
    owner: row.createdByUserId,
    sections: row.sectionCount,
    inUse: row.inUse,
  }
}

/** What the templates list can be filtered by. */
export function useTemplateFilterFields(
  rows: readonly TemplateRow[],
): readonly SheetbaseField[] {
  const { owner } = useRecordFilterFields()

  return useMemo(
    () => [
      textFilter('key', t('library.templates.list.filter.key')),
      textFilter('name', t('library.templates.list.filter.name')),
      choicesFrom(
        'lifecycle',
        t('library.templates.list.filter.status'),
        rows,
        (r) => templateLifecycle(r.lifecycle).label,
      ),
      owner,
      numberFilter('sections', t('library.templates.list.filter.sections')),
      numberFilter('inUse', t('library.templates.list.filter.inUse')),
    ],
    [rows, owner],
  )
}
