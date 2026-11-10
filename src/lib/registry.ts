import { z } from 'zod'

import type {
  DataGridFilterOperator,
  DataGridFilterValue,
  DataGridScalar,
} from './data-grid'

export { formatDataGridValue as formatRegistryValue } from './data-grid'

export type { DataGridValueFormat as RegistryValueFormat } from './data-grid'

export type RegistryDensity = 'comfortable' | 'compact'

export interface RegistrySort {
  id: string
  desc: boolean
}

export type RegistryScalar = DataGridScalar

export type RegistryFilterOperator = DataGridFilterOperator

export type RegistryFilterValue = DataGridFilterValue

/**
 * The complete server-owned query contract for a registry result page.
 * Consumers translate this value to their REST/RPC query; the composition
 * deliberately never loads or transforms the full registry in the browser.
 */
export interface RegistryQuery {
  pageIndex: number
  pageSize: number
  sorting: RegistrySort[]
  grouping: string[]
  filters: RegistryFilterValue[]
}

export interface RegistryViewState {
  query: RegistryQuery
  columnVisibility: Record<string, boolean>
  density: RegistryDensity
}

export interface RegistrySavedView {
  id: string
  name: string
  state: RegistryViewState
  updatedAt?: string
}

export interface RegistrySavedViewStore {
  list: () => RegistrySavedView[]
  save: (view: RegistrySavedView) => RegistrySavedView
  remove: (id: string) => void
}

export interface RegistryViewPolicy {
  sortColumnIds: readonly string[]
  visibilityColumnIds: readonly string[]
  filterIds: readonly string[]
  groupingIds: readonly string[]
  pageSizes: readonly number[]
  fallbackPageSize: number
}

export const DEFAULT_REGISTRY_QUERY: RegistryQuery = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  grouping: [],
  filters: [],
}

export function registrySavedViewStorageKey(
  registryId: string,
  workspaceId: string,
  userId: string,
): string {
  return ['sheetbase-registry-views-v1', registryId, workspaceId, userId]
    .map(encodeURIComponent)
    .join(':')
}

/** Every operator a registry filter may name, as the grid spells them. */
const FILTER_OPERATORS = [
  'eq',
  'contains',
  'neq',
  'startsWith',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'in',
  'notIn',
  'isNull',
  'isNotNull',
] as const satisfies readonly DataGridFilterOperator[]

const filterOperatorSchema = z.enum(FILTER_OPERATORS)
const filterScalarSchema = z.union([z.string(), z.number(), z.boolean()])

/** One filter, as a URL or a saved view carries it. */
const registryFilterSchema = z.object({
  fieldId: z.string(),
  operator: filterOperatorSchema,
  values: z.array(filterScalarSchema).max(20),
})

/** The one-letter tag each scalar is encoded with. */
const scalarTagSchema = z.union([
  z.number().transform(() => 'n'),
  z.boolean().transform(() => 'b'),
  z.string().transform(() => 's'),
])

function encodeFilterScalar(value: RegistryScalar): string {
  const tag = scalarTagSchema.parse(value)

  return `${tag}:${encodeURIComponent(String(value))}`
}

/** Encode filters as compact, typed and independently readable URL state. */
export function encodeRegistryFilters(filters: RegistryFilterValue[]): string {
  return filters
    .map(
      (filter) =>
        `${encodeURIComponent(filter.fieldId)}:${filter.operator}:${filter.values.map(encodeFilterScalar).join(',')}`,
    )
    .join('|')
}

/** One encoded scalar (`n:10`, `b:false`, `s:available`), or null if malformed. */
function decodeFilterScalar(encoded: string): RegistryScalar | null {
  if (encoded.slice(1, 2) !== ':') return null

  const type = encoded.slice(0, 1)
  const scalar = decodeURIComponent(encoded.slice(2))

  if (type === 'n') {
    const numeric = Number(scalar)

    return Number.isFinite(numeric) ? numeric : null
  }

  if (type === 'b') {
    if (scalar === 'true') return true

    if (scalar === 'false') return false

    return null
  }

  return type === 's' ? scalar : null
}

/** One encoded filter (`status:eq:s:available`), or null if malformed. */
function decodeFilterEntry(entry: string): RegistryFilterValue | null {
  const fieldEnd = entry.indexOf(':')
  const operatorEnd = entry.indexOf(':', fieldEnd + 1)

  if (fieldEnd <= 0 || operatorEnd < 0) return null

  const operator = filterOperatorSchema.safeParse(
    entry.slice(fieldEnd + 1, operatorEnd),
  )

  if (!operator.success) return null

  const encoded = entry.slice(operatorEnd + 1)
  const values: RegistryScalar[] = []

  for (const item of encoded ? encoded.split(',') : []) {
    const scalar = decodeFilterScalar(item)

    if (scalar === null) return null
    values.push(scalar)
  }

  const parsed = registryFilterSchema.safeParse({
    fieldId: decodeURIComponent(entry.slice(0, fieldEnd)),
    operator: operator.data,
    values,
  })

  return parsed.success ? parsed.data : null
}

/** Decode untrusted filter URL state using the registry query bounds. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the decode step: the filter arrives as a raw URL parameter, and the grammar checked below decides what it holds.
export function decodeRegistryFilters(value: unknown): RegistryFilterValue[] {
  const encoded = z.string().min(1).max(4096).safeParse(value)

  if (!encoded.success) return []

  const entries = encoded.data.split('|')

  if (entries.length > 20) return []

  const filters: RegistryFilterValue[] = []

  try {
    for (const entry of entries) {
      const filter = decodeFilterEntry(entry)

      if (filter === null) return []
      filters.push(filter)
    }
  } catch {
    return []
  }

  return filters
}

/** Versioned, database-agnostic URL representation of registry query state. */
export function encodeRegistryQuery(query: RegistryQuery): string {
  return encodeURIComponent(JSON.stringify({ v: 1, q: query }))
}

const registryQuerySchema = z.object({
  pageIndex: z.number().int().min(0).max(10_000),
  pageSize: z.number().int().min(1).max(500),
  sorting: z
    .array(z.object({ id: z.string().max(100), desc: z.boolean() }))
    .max(4),
  grouping: z.array(z.string().max(100)).max(4),
  filters: z.array(registryFilterSchema).max(20),
})

/** A stored view's query: the same shape, with the URL's page bounds removed. */
const storedQuerySchema = z.object({
  pageIndex: z.number().int().min(0),
  pageSize: z.number().int().min(1),
  sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })),
  grouping: z.array(z.string()),
  filters: z.array(registryFilterSchema),
})

/** Decode untrusted URL state with deliberately small syntactic bounds. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the decode step: the query arrives as a raw URL parameter, and `registryQuerySchema` below decides what it holds.
export function decodeRegistryQuery(value: unknown): RegistryQuery | null {
  const encoded = z.string().min(1).max(4096).safeParse(value)

  if (!encoded.success) return null

  let envelope: unknown

  try {
    envelope = JSON.parse(decodeURIComponent(encoded.data))
  } catch {
    return null
  }

  const parsed = z
    .object({ v: z.literal(1), q: registryQuerySchema })
    .safeParse(envelope)

  return parsed.success ? parsed.data.q : null
}

/** A saved view as local storage may carry it, including stale fields. */
const savedViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.object({
    query: storedQuerySchema,
    columnVisibility: z.record(z.string(), z.boolean()),
    density: z.enum(['comfortable', 'compact']),
  }),
  updatedAt: z.string().optional(),
})

/**
 * Treat persisted view state as untrusted browser input. This keeps stale or
 * edited local storage from emitting fields the current registry does not
 * expose. The receiving API must enforce the same allow-list.
 */
export function sanitizeRegistryView(
  view: RegistrySavedView,
  policy: RegistryViewPolicy,
): RegistrySavedView {
  const sortableColumns = new Set(policy.sortColumnIds)
  const hideableColumns = new Set(policy.visibilityColumnIds)
  const filters = new Set(policy.filterIds)
  const groups = new Set(policy.groupingIds)
  const pageSizes = new Set(policy.pageSizes)

  return {
    ...view,
    state: {
      ...view.state,
      query: {
        ...view.state.query,
        pageIndex: 0,
        pageSize: pageSizes.has(view.state.query.pageSize)
          ? view.state.query.pageSize
          : policy.fallbackPageSize,
        sorting: view.state.query.sorting.filter((sort) =>
          sortableColumns.has(sort.id),
        ),
        grouping: view.state.query.grouping.filter((group) =>
          groups.has(group),
        ),
        filters: view.state.query.filters.filter((filter) =>
          filters.has(filter.fieldId),
        ),
      },
      columnVisibility: Object.fromEntries(
        Object.entries(view.state.columnVisibility).filter(([id]) =>
          hideableColumns.has(id),
        ),
      ),
    },
  }
}

export function createRegistrySavedViewStore({
  registryId,
  workspaceId,
  userId,
  storage,
}: {
  registryId: string
  workspaceId: string
  userId: string
  storage?: Storage
}): RegistrySavedViewStore {
  const key = registrySavedViewStorageKey(registryId, workspaceId, userId)
  let resolvedStorage: Storage | null = storage ?? null

  if (!resolvedStorage && typeof window !== 'undefined') {
    try {
      resolvedStorage = window.localStorage
    } catch {
      resolvedStorage = null
    }
  }

  function list(): RegistrySavedView[] {
    if (!resolvedStorage) return []

    try {
      const parsed: unknown = JSON.parse(resolvedStorage.getItem(key) ?? '[]')

      if (!Array.isArray(parsed)) return []

      return parsed.flatMap((view) => {
        const saved = savedViewSchema.safeParse(view)

        return saved.success ? [saved.data] : []
      })
    } catch {
      return []
    }
  }

  function write(views: RegistrySavedView[]) {
    try {
      resolvedStorage?.setItem(key, JSON.stringify(views))
    } catch {
      // Storage can be unavailable in private browsing or under a quota.
      // The current view still works; it simply cannot persist locally.
    }
  }

  return {
    list,
    save(view) {
      const saved = { ...view, updatedAt: new Date().toISOString() }
      const views = list()
      const existing = views.findIndex((candidate) => candidate.id === view.id)

      if (existing >= 0) views[existing] = saved
      else views.push(saved)
      write(views)

      return saved
    },
    remove(id) {
      write(list().filter((view) => view.id !== id))
    },
  }
}
