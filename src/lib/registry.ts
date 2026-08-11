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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const FILTER_OPERATORS = new Set<RegistryFilterOperator>([
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
])

function isRegistryFilter(value: unknown): value is RegistryFilterValue {
  return (
    isRecord(value) &&
    typeof value.fieldId === 'string' &&
    FILTER_OPERATORS.has(value.operator as RegistryFilterOperator) &&
    Array.isArray(value.values) &&
    value.values.length <= 20 &&
    value.values.every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  )
}

function encodeFilterScalar(value: RegistryScalar): string {
  const type =
    typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's'
  return `${type}:${encodeURIComponent(String(value))}`
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

/** Decode untrusted filter URL state using the registry query bounds. */
export function decodeRegistryFilters(value: unknown): RegistryFilterValue[] {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
    return []
  try {
    const entries = value.split('|')
    if (entries.length > 20) return []
    const filters: RegistryFilterValue[] = entries.map((entry) => {
      const fieldEnd = entry.indexOf(':')
      const operatorEnd = entry.indexOf(':', fieldEnd + 1)
      if (fieldEnd <= 0 || operatorEnd < 0) throw new Error('Invalid filter')
      const values = entry.slice(operatorEnd + 1)
      return {
        fieldId: decodeURIComponent(entry.slice(0, fieldEnd)),
        operator: entry.slice(
          fieldEnd + 1,
          operatorEnd,
        ) as RegistryFilterOperator,
        values: values
          ? values.split(',').map((encoded): RegistryScalar => {
              const type = encoded.slice(0, 1)
              if (encoded.slice(1, 2) !== ':')
                throw new Error('Invalid filter value')
              const scalar = decodeURIComponent(encoded.slice(2))
              if (type === 'n') {
                const numeric = Number(scalar)
                if (!Number.isFinite(numeric))
                  throw new Error('Invalid numeric filter value')
                return numeric
              }
              if (type === 'b') {
                if (scalar !== 'true' && scalar !== 'false')
                  throw new Error('Invalid boolean filter value')
                return scalar === 'true'
              }
              if (type !== 's') throw new Error('Invalid filter value type')
              return scalar
            })
          : [],
      }
    })
    return filters.every(isRegistryFilter) ? filters : []
  } catch {
    return []
  }
}

/** Versioned, database-agnostic URL representation of registry query state. */
export function encodeRegistryQuery(query: RegistryQuery): string {
  return encodeURIComponent(JSON.stringify({ v: 1, q: query }))
}

/** Decode untrusted URL state with deliberately small syntactic bounds. */
export function decodeRegistryQuery(value: unknown): RegistryQuery | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
    return null
  try {
    const envelope: unknown = JSON.parse(decodeURIComponent(value))
    if (!isRecord(envelope) || envelope.v !== 1 || !isRecord(envelope.q))
      return null
    const query = envelope.q
    if (
      !Number.isInteger(query.pageIndex) ||
      Number(query.pageIndex) < 0 ||
      Number(query.pageIndex) > 10_000 ||
      !Number.isInteger(query.pageSize) ||
      Number(query.pageSize) < 1 ||
      Number(query.pageSize) > 500 ||
      !Array.isArray(query.sorting) ||
      query.sorting.length > 4 ||
      !query.sorting.every(
        (sort) =>
          isRecord(sort) &&
          typeof sort.id === 'string' &&
          sort.id.length <= 100 &&
          typeof sort.desc === 'boolean',
      ) ||
      !Array.isArray(query.grouping) ||
      query.grouping.length > 4 ||
      !query.grouping.every(
        (group) => typeof group === 'string' && group.length <= 100,
      ) ||
      !Array.isArray(query.filters) ||
      query.filters.length > 20 ||
      !query.filters.every(isRegistryFilter)
    )
      return null
    return query as unknown as RegistryQuery
  } catch {
    return null
  }
}

function isSavedView(value: unknown): value is RegistrySavedView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string'
  ) {
    return false
  }
  const state = value.state
  if (!isRecord(state) || !isRecord(state.query)) return false
  if (!isRecord(state.columnVisibility)) return false
  const query = state.query
  const sortingValid =
    Array.isArray(query.sorting) &&
    query.sorting.every(
      (sort) =>
        isRecord(sort) &&
        typeof sort.id === 'string' &&
        typeof sort.desc === 'boolean',
    )
  const groupingValid =
    Array.isArray(query.grouping) &&
    query.grouping.every((group) => typeof group === 'string')
  const filtersValid =
    Array.isArray(query.filters) &&
    query.filters.every((filter) => isRegistryFilter(filter))
  const visibilityValid = Object.values(state.columnVisibility).every(
    (visible) => typeof visible === 'boolean',
  )
  return (
    Number.isInteger(query.pageIndex) &&
    Number(query.pageIndex) >= 0 &&
    Number.isInteger(query.pageSize) &&
    Number(query.pageSize) > 0 &&
    sortingValid &&
    groupingValid &&
    filtersValid &&
    visibilityValid &&
    (state.density === 'comfortable' || state.density === 'compact')
  )
}

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
      return Array.isArray(parsed) ? parsed.filter(isSavedView) : []
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
