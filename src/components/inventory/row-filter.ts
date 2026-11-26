/* oxlint-disable anti-slop/no-object-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- This module reads whatever rows a list holds: it is generic over their shape by design, and narrows each stored value once through `filterCell`. */
import { useCallback, useMemo } from 'react'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import { t } from '#/copy'
import { filterCell } from '#/lib/list-filter'
import type { FilterCell, FilterRecord } from '#/lib/list-filter'
import { fieldFromCells } from './column-filter'
import {
  customValueFields,
  customValueRecord,
  useRecordFilterFields,
} from './list-filter-fields'
import { useClientFilter } from './use-list-filter'
import type { ClientFilter } from './use-list-filter'

/**
 * A filter that follows the rows. Every value a row holds becomes a field,
 * typed by what the rows hold: a number, a date, a yes/no, a short list to pick
 * from, or text. A key that names a project or a person gets the lookup picker,
 * and a record's model fields (`customFields`) are added the same way. Nothing
 * is listed per page: a new column on the rows is a new filter.
 *
 * `options` only names what the keys cannot say for themselves, and must keep
 * one identity (a module-level constant).
 */
export interface RowFilterOptions {
  /** Display names for keys whose own name reads badly. */
  labels?: Readonly<Record<string, string>>
  /** How a key's values read in its picker (a status code as its name). */
  valueLabels?: Readonly<Record<string, (value: string) => string>>
  /** Keys that are plumbing, not data a person would filter by. */
  hide?: readonly string[]
}

const COMMON_LABELS = new Map([
  ['identifier', t('common.filter.id')],
  ['display_id', t('common.filter.id')],
  ['title', t('common.filter.title')],
  ['name', t('common.filter.name')],
  ['status', t('common.filter.status')],
  ['state', t('common.filter.status')],
  ['lifecycle', t('common.filter.status')],
  ['tags', t('common.filter.tags')],
  ['version', t('common.filter.version')],
  ['createdAt', t('common.filter.created')],
  ['created_at', t('common.filter.created')],
  ['updatedAt', t('common.filter.updated')],
  ['updated_at', t('common.filter.updated')],
])

const PROJECT_KEY = /^project_?id$/i

const OWNER_KEY =
  /^(created_?by(_?user)?_?id|owner(_?user)?_?id|lead_?user_?id|user_?id)$/i

/** Keys that name a row's identity or bookkeeping, never something to filter. */
const BOOKKEEPING_KEY = /(^|_)(uuid|etag)$|^(metadata|structure)_?version$/i
const ID_KEY = /(^id$|_id$|[a-z]Id$)/
const CUSTOM_KEYS = new Set(['customFields', 'custom_fields'])

/** "storage_temp" and "storageTemp" both read "Storage temp". */
function readable(key: string): string {
  const spaced = key
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function labelOf(key: string, options: RowFilterOptions | undefined): string {
  if (PROJECT_KEY.test(key)) return t('common.filter.project')

  if (OWNER_KEY.test(key)) return t('common.filter.owner')

  return options?.labels?.[key] ?? COMMON_LABELS.get(key) ?? readable(key)
}

function isPlumbing(key: string, options: RowFilterOptions | undefined) {
  if (key.startsWith('_') || CUSTOM_KEYS.has(key)) return true

  if (BOOKKEEPING_KEY.test(key) || options?.hide?.includes(key)) return true

  return ID_KEY.test(key) && !PROJECT_KEY.test(key) && !OWNER_KEY.test(key)
}

function customOf(row: object): Readonly<Record<string, unknown>> | undefined {
  for (const [key, value] of Object.entries(row))
    if (CUSTOM_KEYS.has(key) && typeof value === 'object')
      // SAFETY: A `customFields` value is a record's stored model values: an object keyed by field key.
      return value as Readonly<Record<string, unknown>> | undefined

  return undefined
}

/** A row's values under the ids `useRowFilter` offers. */
function rowRecord(row: object): FilterRecord {
  const own: [string, FilterCell][] = Object.entries(row).map(
    ([key, value]) => [key, filterCell(value)],
  )

  return { ...Object.fromEntries(own), ...customValueRecord(customOf(row)) }
}

/** The fields the rows offer: one per value they hold, plus model fields. */
function rowFields(
  rows: readonly object[],
  options: RowFilterOptions | undefined,
  project: SheetbaseField,
  owner: SheetbaseField,
): SheetbaseField[] {
  const keys = new Set<string>()
  const records = rows.map(rowRecord)

  for (const row of rows) for (const key of Object.keys(row)) keys.add(key)

  const fields = [...keys].flatMap((key): SheetbaseField[] => {
    if (isPlumbing(key, options)) return []
    const label = labelOf(key, options)

    if (PROJECT_KEY.test(key)) return [{ ...project, id: key, label }]

    if (OWNER_KEY.test(key)) return [{ ...owner, id: key, label }]

    const field = fieldFromCells(
      key,
      label,
      records.map((record) => record[key]),
      rows.length,
      options?.valueLabels?.[key],
    )

    return field ? [field] : []
  })

  // Two keys can read alike (`updated` and `updatedAt`): the first one stays.
  const named = new Set<string>()

  const unique = fields.filter((field) => {
    if (named.has(field.label)) return false
    named.add(field.label)

    return true
  })

  return [...unique, ...customValueFields(rows.map(customOf))]
}

/**
 * The list's filter and the rows it leaves, from the rows themselves. `rows`
 * are what the tab and search left; `all` (default: the same) is what the
 * fields learn their types and words from.
 */
export function useRowFilter<T extends object>(
  rows: readonly T[],
  all: readonly T[] = rows,
  options?: RowFilterOptions,
): ClientFilter<T> {
  const { project, owner } = useRecordFilterFields()

  const fields = useMemo(
    () => rowFields(all, options, project, owner),
    [all, options, project, owner],
  )

  const toRecord = useCallback((row: T) => rowRecord(row), [])

  return useClientFilter(fields, rows, toRecord)
}
