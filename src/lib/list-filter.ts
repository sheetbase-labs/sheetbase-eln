import { buildPredicate } from '@sheetbase-labs/sheetbase-shared'
import type {
  ConditionNode,
  FilterNode,
  GroupNode,
} from '@sheetbase-labs/sheetbase-shared'

import {
  completeFilter,
  isEmptyFilter,
  normaliseFilterParam,
} from '#/lib/search-filter'
import type { FilterParam } from '#/lib/search-filter'

/**
 * Filters on a record list. One tree (the same one Search uses) is held in the
 * `filter` URL parameter, so a pane, a shared link and the back button all
 * keep it. A list either applies it to the rows it holds (`filterRows`) or
 * hands it to the database (`filterToPostgrest`), and the API, MCP and
 * assistant take the same tree.
 */

/** What a list route adds to its `validateSearch`, so the parameter survives. */
// Router input is untrusted until the filter decoder has inspected it.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function filterSearch(raw: unknown): { filter?: FilterParam } {
  return { filter: normaliseFilterParam(raw) }
}

/** The finished conditions of a tree, or undefined when nothing is set. */
export function activeFilter(
  tree: GroupNode | null | undefined,
): GroupNode | undefined {
  return tree ? completeFilter(tree) : undefined
}

/** The rows a tree lets through; all of them when no filter is set. */
export function filterRows<T>(
  rows: readonly T[],
  tree: GroupNode | null | undefined,
  toRecord: (row: T) => Record<string, unknown>,
): readonly T[] {
  const active = activeFilter(tree)

  if (!active) return rows
  const matches = buildPredicate(active)

  return rows.filter((row) => matches(toRecord(row)))
}

/** How a filter field reaches the database: a column, or a JSON key as text. */
export interface PostgrestColumn {
  /** The PostgREST expression, e.g. `status` or `properties->>sampleType`. */
  column: string
  /**
   * Text columns match without regard to case; `exact` ones (ids, statuses)
   * and number, date and boolean ones compare as stored.
   */
  kind?: 'text' | 'exact' | 'number' | 'date' | 'boolean'
}

export type PostgrestColumns = Readonly<
  Record<string, PostgrestColumn | string>
>

const DAY_MS = 86_400_000

// PostgREST reads commas, parentheses and quotes inside a list: wrap the value.
function quote(value: unknown): string {
  const text = String(value ?? '')

  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function pattern(text: string): string {
  return text.replace(/[*%_\\]/g, (ch) => `\\${ch}`)
}

function listValues(value: ConditionNode['value']): unknown[] {
  if (Array.isArray(value)) return value

  return value === undefined || value === null ? [] : [value]
}

function condition(
  node: ConditionNode,
  columns: PostgrestColumns,
  now: number,
): string | undefined {
  const entry = columns[node.field]

  if (!entry) return undefined
  const { column, kind = 'text' } =
    typeof entry === 'string' ? { column: entry } : entry
  const value = node.value
  const scalar = Array.isArray(value) ? value[0] : value
  const text = String(scalar ?? '')

  switch (node.operator) {
    case 'isNull':
      return `${column}.is.null`
    case 'notNull':
      return `${column}.not.is.null`
    case 'eq':
      return kind === 'text'
        ? `${column}.ilike.${quote(pattern(text))}`
        : `${column}.eq.${quote(text)}`
    case 'neq':
      return kind === 'text'
        ? `${column}.not.ilike.${quote(pattern(text))}`
        : `${column}.neq.${quote(text)}`
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return `${column}.${node.operator}.${quote(text)}`
    case 'contains':
      return `${column}.ilike.${quote(`*${pattern(text)}*`)}`
    case 'startsWith':
      return `${column}.ilike.${quote(`${pattern(text)}*`)}`
    case 'endsWith':
      return `${column}.ilike.${quote(`*${pattern(text)}`)}`
    case 'in': {
      const items = listValues(value)

      return items.length
        ? `${column}.in.(${items.map(quote).join(',')})`
        : undefined
    }
    case 'between': {
      const [low, high] = listValues(value)

      if (low === undefined || high === undefined) return undefined

      return `and(${column}.gte.${quote(low)},${column}.lte.${quote(high)})`
    }
    case 'withinLastDays': {
      const days = Number(text)

      if (!Number.isFinite(days)) return undefined

      return `${column}.gte.${quote(new Date(now - days * DAY_MS).toISOString())}`
    }
    default:
      return undefined
  }
}

function group(
  node: FilterNode,
  columns: PostgrestColumns,
  now: number,
): string | undefined {
  if (node.type === 'condition') return condition(node, columns, now)
  const parts = node.children
    .map((child) => group(child, columns, now))
    .filter((part): part is string => part !== undefined)

  if (parts.length === 0) return undefined
  const body = parts.join(',')

  if (node.combinator === 'OR') return `or(${body})`

  if (node.combinator === 'NOT') return `not.and(${body})`

  return `and(${body})`
}

/**
 * The PostgREST clause for a tree (`and=(...)`), or undefined when nothing is
 * set. Fields the list did not map are left out.
 */
export function filterToPostgrest(
  tree: GroupNode | null | undefined,
  columns: PostgrestColumns,
  now: number = Date.now(),
): string | undefined {
  const active = activeFilter(tree)

  if (!active || isEmptyFilter(active)) return undefined
  const clause = group(active, columns, now)

  if (!clause) return undefined

  // One top-level `and=(...)` holds the whole tree, so it never clashes with
  // a list's own `or=` search clause.
  return `and=(${clause})`
}
