import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import { useFieldSources } from '#/components/search/use-search-fields'
import { matchOptions } from '#/lib/search-fields'
import type { SearchOption } from '#/lib/search-fields'
import { t } from '#/copy'

/**
 * The columns a list offers to filter by. A list names the ones it has, with
 * the type that decides the operators and the value picker: text gets
 * "contains", numbers and dates get ranges, a status or a person gets a list
 * to choose from. Project and Person look themselves up as the person types.
 */

export const textFilter = (id: string, label: string): SheetbaseField => ({
  id,
  label,
  dataType: 'text',
})

export const numberFilter = (
  id: string,
  label: string,
  unit?: string,
): SheetbaseField => ({ id, label, dataType: 'number', unit })

export const dateFilter = (id: string, label: string): SheetbaseField => ({
  id,
  label,
  dataType: 'date',
})

export const flagFilter = (id: string, label: string): SheetbaseField => ({
  id,
  label,
  dataType: 'boolean',
})

/** A column with a fixed set of values: a status, a kind, a stage. */
export function choiceFilter(
  id: string,
  label: string,
  options: readonly SearchOption[],
): SheetbaseField {
  return {
    id,
    label,
    dataType: 'text',
    loadOptions: async (query: string) => matchOptions(options, query, 50),
  }
}

/** The fields every record list can add: Project and Owner. */
export function useRecordFilterFields(): {
  project: SheetbaseField
  owner: SheetbaseField
} {
  const sources = useFieldSources()

  return useMemo(
    () => ({
      project: {
        id: 'project',
        label: t('projects.searchFilter.fields.project'),
        dataType: 'text',
        loadOptions: sources.loadProjects,
      },
      owner: {
        id: 'owner',
        label: t('projects.searchFilter.fields.owner'),
        dataType: 'text',
        loadOptions: sources.loadOwners,
      },
    }),
    [sources],
  )
}
