import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  choiceFilter,
  customValueFields,
  dateFilter,
  textFilter,
} from '#/components/inventory/list-filter-fields'
import type { RegistryEntry, RegistryModel } from '#/lib/bio-registry'
import { t } from '#/copy'

/**
 * What the registry can be filtered by: the columns every entry has, then
 * whatever fields the shown entries' models add (each typed by its values).
 */
export function useRegistryFilterFields(
  models: readonly RegistryModel[],
  entries: readonly RegistryEntry[],
): readonly SheetbaseField[] {
  return useMemo(
    () => [
      textFilter('identifier', t('registry.columns.number')),
      textFilter('name', t('registry.columns.name')),
      choiceFilter(
        'kind',
        t('registry.columns.kind'),
        models.map((m) => ({ value: m.key, label: m.name })),
      ),
      choiceFilter('status', t('registry.columns.status'), [
        { value: 'active', label: t('registry.statuses.active') },
        { value: 'retired', label: t('registry.statuses.retired') },
      ]),
      dateFilter('added', t('registry.columns.added')),
      ...customValueFields(entries.map((e) => e.custom_fields)),
    ],
    [models, entries],
  )
}
