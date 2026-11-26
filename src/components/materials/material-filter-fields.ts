import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choicesFrom,
  dateFilter,
  textFilter,
} from '#/components/inventory/list-filter-fields'
import { t } from '#/copy'
import type { MaterialListRow } from './materials-data'

/** A lot's values under the ids `useMaterialFilterFields` offers. */
export function materialFilterRecord(
  m: MaterialListRow,
): Record<string, unknown> {
  return {
    id: m.id,
    name: m.name,
    supplier: m.supplier,
    lot: m.lot,
    catalogNo: m.catalogNo,
    location: m.location,
    status: m.status.label,
    expiry: m.expiry,
    received: m.received,
  }
}

/** What the materials list can be filtered by. */
export function useMaterialFilterFields(
  rows: readonly MaterialListRow[],
): readonly SheetbaseField[] {
  return useMemo(
    () => [
      textFilter('id', t('library.materials.page.filter.id')),
      textFilter('name', t('library.materials.page.filter.name')),
      choicesFrom(
        'supplier',
        t('library.materials.page.filter.supplier'),
        rows,
        (m) => m.supplier,
      ),
      textFilter('lot', t('library.materials.page.filter.lot')),
      textFilter('catalogNo', t('library.materials.page.filter.catalogNo')),
      textFilter('location', t('library.materials.page.filter.location')),
      choicesFrom(
        'status',
        t('library.materials.page.filter.status'),
        rows,
        (m) => m.status.label,
      ),
      dateFilter('expiry', t('library.materials.page.filter.expiry')),
      dateFilter('received', t('library.materials.page.filter.received')),
    ],
    [rows],
  )
}
