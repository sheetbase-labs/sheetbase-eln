import { formatCount } from './format-numbers'

export type RegistryDensity = 'comfortable' | 'compact'

export interface RegistrySort {
  id: string
  desc: boolean
}

export type RegistryScalar = string | number | boolean
export type RegistryFilterOperator =
  | 'eq'
  | 'contains'
  | 'neq'
  | 'startsWith'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull'

export interface RegistryFilterValue {
  fieldId: string
  operator: RegistryFilterOperator
  values: RegistryScalar[]
}

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

export type RegistryValueFormat =
  | { kind: 'text' }
  | { kind: 'scientific'; unit?: string }
  | { kind: 'date'; dateStyle?: 'short' | 'medium' | 'long' }

/** Sheetbase-owned formatting used by registry column definitions. */
export function formatRegistryValue(
  value: unknown,
  format: RegistryValueFormat = { kind: 'text' },
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (format.kind === 'scientific') {
    const numeric = typeof value === 'number' ? value : Number(value)
    const rendered = Number.isFinite(numeric)
      ? formatCount(numeric)
      : String(value)
    return format.unit ? `${rendered} ${format.unit}` : rendered
  }
  if (format.kind === 'date') {
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: format.dateStyle ?? 'medium',
    }).format(date)
  }
  return String(value)
}
