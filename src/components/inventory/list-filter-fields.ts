import { useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import { useFieldSources } from '#/components/search/use-search-fields'
import { matchOptions } from '#/lib/search-fields'
import type { SearchOption } from '#/lib/search-fields'
import { t } from '#/copy'
import { cellKind, filterCell } from '#/lib/list-filter'
import type { FilterRecord } from '#/lib/list-filter'

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

/** "storage_temp" reads "Storage temp". */
function humanKey(key: string): string {
  const spaced = key.replaceAll(/[_-]+/g, ' ').trim()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The fields a model adds to its records, read from the values a list holds:
 * each key becomes a filter field typed by what it stores (a number, a date, a
 * yes/no, or text). A key whose values are all empty is left out.
 */
export function customValueFields(
  // A model's stored field values are any JSON; `filterCell` reads each one.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  rows: readonly (Readonly<Record<string, unknown>> | null | undefined)[],
  prefix = 'fields.',
): SheetbaseField[] {
  const seen = new Map<string, SheetbaseField['dataType']>()

  for (const values of rows) {
    if (!values) continue

    for (const [key, value] of Object.entries(values)) {
      if (seen.has(key)) continue
      const kind = cellKind(filterCell(value))

      if (kind !== 'none') seen.set(key, kind)
    }
  }

  return [...seen].map(([key, dataType]) => ({
    id: `${prefix}${key}`,
    label: humanKey(key),
    dataType,
  }))
}

/** A row's model values under the same ids `customValueFields` gave them. */
export function customValueRecord(
  // A model's stored field values are any JSON; `filterCell` reads each one.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  values: Readonly<Record<string, unknown>> | null | undefined,
  prefix = 'fields.',
): FilterRecord {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      `${prefix}${key}`,
      filterCell(value),
    ]),
  )
}

/**
 * A choice field whose options are the distinct values the rows hold: a
 * status, a supplier, a location. Sorted, so the picker reads the same order
 * every time.
 */
export function choicesFrom<T>(
  id: string,
  label: string,
  rows: readonly T[],
  valueOf: (row: T) => string | null | undefined,
): SheetbaseField {
  const values = new Set<string>()

  for (const row of rows) {
    const value = valueOf(row)

    if (value) values.add(value)
  }

  return choiceFilter(
    id,
    label,
    [...values]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  )
}
