/**
 * DATA-007 — Dataset Explorer data layer.
 *
 * Thin, typed wrappers over the scientific-table and dataset-schema surfaces
 * the Dataset Explorer reads. Every call goes through the same `/api/db`
 * boundary and RLS as the rest of the application; PostgreSQL remains
 * authoritative (decision 0019/0034).
 *
 * The explorer browses real scientific-table metadata: it lists the tables a
 * caller can see (`scientific_table_metadata` with no id), pages their rows
 * directly from the generated physical resources, and reads lineage from the
 * formula definition/dependency tables. Cross-sheet typed queries go through
 * `query_dataset`; the explorer exposes that path for schema-bound datasets.
 *
 * Saved views preserve a `DatasetViewSpec` (filters, sorting, grouping, field
 * selection, density) in local storage. The store treats persisted state as
 * untrusted browser input and re-validates it against the active dataset's
 * columns and the safe limits below, mirroring the registry view sanitiser.
 */
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import {
  fetchScientificDependencies,
  fetchScientificFormulas,
} from './scientific-sheet-data'
import type {
  FormulaDefinitionWire,
  FormulaDependencyWire,
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from './scientific-sheet-data'
import type {
  DatasetSchemaFieldWire,
  DatasetSchemaRelationshipWire,
  DatasetSchemaWire,
} from './dataset-schema-data'
import { fetchDatasetSchemaFields } from './dataset-schema-data'
import { CHART_SPEC_VERSION } from './chart-spec'
import type { ChartSpec } from './chart-spec'

// --- Safe limits ----------------------------------------------------------
//
// The explorer confines interactive query construction to these limits so a
// browser session never builds an unbounded cross-sheet query. The
// `query_dataset` RPC enforces a hard 5000-row ceiling server-side; these
// limits are the UI-side guardrails that keep the request shape reasonable
// before it reaches the RPC.

export const DATASET_MAX_FILTERS = 8
export const DATASET_MAX_TRANSFORMATIONS = 4
export const DATASET_MAX_PAGE_SIZE = 100
export const DATASET_PAGE_SIZES = [25, 50, 100] as const
export const DATASET_DEFAULT_PAGE_SIZE = 50
/** Hard server-side ceiling from `query_dataset`; surfaced honestly. */
export const DATASET_QUERY_HARD_LIMIT = 5000

export const datasetExplorerDataClient = createDataClient()

export const datasetExplorerQueryKeys = {
  summaries: ['dataset-explorer-summaries'] as const,
  rows: (tableId: string, queryId: string) =>
    ['dataset-explorer-rows', tableId, queryId] as const,
  rowCount: (tableId: string, queryId: string) =>
    ['dataset-explorer-row-count', tableId, queryId] as const,
  schemaFields: (schemaId: string) =>
    ['dataset-explorer-schema-fields', schemaId] as const,
  relationships: ['dataset-explorer-relationships'] as const,
  lineage: (tableId: string) => ['dataset-explorer-lineage', tableId] as const,
  links: (recordId: string) => ['dataset-explorer-links', recordId] as const,
}

// --- Dataset listing ------------------------------------------------------

/**
 * List every scientific table the caller can see. Calls
 * `scientific_table_metadata` with no id, which returns all RLS-visible
 * active tables with their columns and category options.
 */
export async function fetchDatasetSummaries(
  client: DataClient = datasetExplorerDataClient,
): Promise<ScientificTableWire[]> {
  return client.rpc<ScientificTableWire[]>('scientific_table_metadata', {
    p_table_id: null,
  })
}

// --- Paged row query over a physical resource -----------------------------

export interface DatasetRowQuery {
  pageIndex: number
  pageSize: number
  /** Sort descriptors; mapped to PostgREST `order`. */
  sorting: Array<{ id: string; desc: boolean }>
  /** Field-name → predicate value filters (eq semantics). */
  filters: Array<{ id: string; value: string }>
}

export interface DatasetRowPage {
  rows: ScientificRowWire[]
  /** Authoritative server total for the current filter, never page-inferred. */
  totalCount: number
}

/**
 * Build the PostgREST query string for a dataset row query. Filters map to
 * `<field>=eq.<value>` predicates; sorting maps to `order=<field>.<dir>`.
 * The default order keeps insertion order stable when no sort is set.
 */
export function buildDatasetRowQuery(query: DatasetRowQuery): string {
  const limit = Math.min(Math.max(1, query.pageSize), DATASET_MAX_PAGE_SIZE)
  const offset = Math.max(0, query.pageIndex) * limit
  const parts: string[] = ['select=*']
  if (query.sorting.length > 0) {
    parts.push(
      `order=${query.sorting
        .map((s) => `${encodeURIComponent(s.id)}.${s.desc ? 'desc' : 'asc'}`)
        .join(',')}`,
    )
  } else {
    parts.push('order=created_at.asc,id.asc')
  }
  for (const filter of query.filters.slice(0, DATASET_MAX_FILTERS)) {
    if (!filter.value) continue
    parts.push(
      `${encodeURIComponent(filter.id)}=eq.${encodeURIComponent(filter.value)}`,
    )
  }
  parts.push(`limit=${limit}`, `offset=${offset}`)
  return `?${parts.join('&')}`
}

/**
 * Fetch one page of rows plus the authoritative server total for the same
 * filter. The total uses `Prefer: count=exact` with a 0-0 range so at most
 * one row transfers; the page fetch returns the rows to render.
 */
export async function fetchDatasetRowPage(
  client: DataClient,
  table: ScientificTableWire,
  query: DatasetRowQuery,
): Promise<DatasetRowPage> {
  const resource = encodeURIComponent(table.resource_name)
  const activeFilters = query.filters
    .slice(0, DATASET_MAX_FILTERS)
    .filter((f) => f.value)
  const filterQuery = activeFilters.length
    ? `?select=${activeFilters
        .map(
          (f) =>
            `${encodeURIComponent(f.id)}=eq.${encodeURIComponent(f.value)}`,
        )
        .join('&')}`
    : ''
  const [rows, totalCount] = await Promise.all([
    client.list<ScientificRowWire>(resource, buildDatasetRowQuery(query)),
    filterQuery ? client.count(resource, filterQuery) : client.count(resource),
  ])
  return { rows, totalCount }
}

// --- Schema + relationships ----------------------------------------------

export interface DatasetSchemaDetail {
  schema: DatasetSchemaWire | null
  fields: DatasetSchemaFieldWire[]
}

/**
 * Resolve the bound dataset schema + fields for a table. Returns empty
 * fields and a null schema for legacy unbound sheets.
 */
export async function fetchDatasetSchemaDetail(
  client: DataClient,
  table: ScientificTableWire,
): Promise<DatasetSchemaDetail> {
  const schemaId = table.dataset_schema_id ?? null
  if (!schemaId) return { schema: null, fields: [] }
  // Fields and schema are independent — fetch in parallel to avoid
  // a sequential waterfall that adds a full round-trip of latency.
  const [fields, schemas] = await Promise.all([
    fetchDatasetSchemaFields(client, schemaId),
    client.list<DatasetSchemaWire>(
      'dataset_schemas',
      `?id=eq.${encodeURIComponent(schemaId)}&limit=1`,
    ),
  ])
  return { schema: schemas[0] ?? null, fields }
}

/** Relationships across the workspace, filtered to the bound schema. */
export async function fetchDatasetRelationshipsFor(
  client: DataClient,
  schemaId: string | null,
): Promise<DatasetSchemaRelationshipWire[]> {
  if (!schemaId) return []
  // Filter server-side via PostgREST `or` so we transfer only the
  // relationships that touch this schema, not the entire workspace set.
  const filter = `or=(source_schema_id.eq.${encodeURIComponent(schemaId)},target_schema_id.eq.${encodeURIComponent(schemaId)})`
  return client.list<DatasetSchemaRelationshipWire>(
    'dataset_schema_relationships',
    `?lifecycle=eq.active&${filter}&order=created_at.asc`,
  )
}

// --- Lineage + transformations -------------------------------------------

export interface DatasetLineage {
  formulas: FormulaDefinitionWire[]
  dependencies: FormulaDependencyWire[]
}

/**
 * Read the formula definitions and cross-sheet dependencies that describe
 * how the dataset's calculated columns are derived. These are the
 * transformations the Lineage tab and inspector surface.
 */
export async function fetchDatasetLineage(
  client: DataClient,
  tableId: string,
): Promise<DatasetLineage> {
  const [formulas, dependencies] = await Promise.all([
    fetchScientificFormulas(client, tableId),
    fetchScientificDependencies(client, tableId),
  ])
  return { formulas, dependencies }
}

// --- Saved views ----------------------------------------------------------

export type DatasetDensity = 'comfortable' | 'compact'

export interface DatasetViewSpec {
  query: DatasetRowQuery
  /** Column field names that are hidden; everything else is visible. */
  hiddenFields: string[]
  density: DatasetDensity
}

export interface DatasetSavedView {
  id: string
  name: string
  tableId: string
  spec: DatasetViewSpec
  updatedAt?: string
}

export interface DatasetSavedViewStore {
  list: (tableId: string) => DatasetSavedView[]
  save: (view: DatasetSavedView) => DatasetSavedView
  remove: (tableId: string, id: string) => void
}

export function datasetSavedViewStorageKey(
  workspaceId: string,
  userId: string,
): string {
  return ['sheetbase-dataset-views-v1', workspaceId, userId]
    .map(encodeURIComponent)
    .join(':')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDatasetRowQuery(value: unknown): value is DatasetRowQuery {
  if (!isRecord(value)) return false
  if (!Number.isInteger(value.pageIndex) || Number(value.pageIndex) < 0)
    return false
  if (!Number.isInteger(value.pageSize) || Number(value.pageSize) <= 0)
    return false
  if (!Array.isArray(value.sorting)) return false
  if (
    !value.sorting.every(
      (s) =>
        isRecord(s) && typeof s.id === 'string' && typeof s.desc === 'boolean',
    )
  )
    return false
  if (!Array.isArray(value.filters)) return false
  if (
    !value.filters.every(
      (f) =>
        isRecord(f) && typeof f.id === 'string' && typeof f.value === 'string',
    )
  )
    return false
  return true
}

function isDatasetViewSpec(value: unknown): value is DatasetViewSpec {
  if (!isRecord(value)) return false
  if (!isDatasetRowQuery(value.query)) return false
  if (!Array.isArray(value.hiddenFields)) return false
  if (!value.hiddenFields.every((f) => typeof f === 'string')) return false
  if (value.density !== 'comfortable' && value.density !== 'compact')
    return false
  return true
}

function isDatasetSavedView(value: unknown): value is DatasetSavedView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.tableId !== 'string'
  )
    return false
  return isDatasetViewSpec(value.spec)
}

/**
 * Re-validate a persisted view against the active dataset's columns and the
 * safe limits. Stale or hand-edited local storage cannot introduce fields,
 * sorts or filters the dataset does not expose, or blow past the limits.
 */
export function sanitizeDatasetView(
  view: DatasetSavedView,
  columns: ScientificColumnWire[],
): DatasetSavedView {
  const fieldNames = new Set(columns.map((c) => c.field_name))
  const sorting = view.spec.query.sorting
    .filter((s) => fieldNames.has(s.id))
    .slice(0, 4)
  const filters = view.spec.query.filters
    .filter((f) => fieldNames.has(f.id) && f.value !== '')
    .slice(0, DATASET_MAX_FILTERS)
  const hiddenFields = view.spec.hiddenFields.filter((f) => fieldNames.has(f))
  const pageSize = (DATASET_PAGE_SIZES as readonly number[]).includes(
    view.spec.query.pageSize,
  )
    ? view.spec.query.pageSize
    : DATASET_DEFAULT_PAGE_SIZE
  return {
    ...view,
    spec: {
      query: {
        pageIndex: 0,
        pageSize,
        sorting,
        filters,
      },
      hiddenFields,
      density: view.spec.density,
    },
  }
}

export function createDatasetSavedViewStore({
  workspaceId,
  userId,
  storage,
}: {
  workspaceId: string
  userId: string
  storage?: Storage
}): DatasetSavedViewStore {
  const key = datasetSavedViewStorageKey(workspaceId, userId)
  let resolvedStorage: Storage | null = storage ?? null
  if (!resolvedStorage && typeof window !== 'undefined') {
    try {
      resolvedStorage = window.localStorage
    } catch {
      resolvedStorage = null
    }
  }

  function readAll(): DatasetSavedView[] {
    if (!resolvedStorage) return []
    try {
      const parsed: unknown = JSON.parse(resolvedStorage.getItem(key) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter(isDatasetSavedView) : []
    } catch {
      return []
    }
  }

  function writeAll(views: DatasetSavedView[]) {
    try {
      resolvedStorage?.setItem(key, JSON.stringify(views))
    } catch {
      // Storage can be unavailable in private browsing or under a quota.
      // The current view still works; it simply cannot persist locally.
    }
  }

  return {
    list(tableId) {
      return readAll().filter((v) => v.tableId === tableId)
    },
    save(view) {
      const saved = { ...view, updatedAt: new Date().toISOString() }
      const views = readAll()
      const existing = views.findIndex((candidate) => candidate.id === view.id)
      if (existing >= 0) views[existing] = saved
      else views.push(saved)
      writeAll(views)
      return saved
    },
    remove(tableId, id) {
      writeAll(readAll().filter((v) => !(v.tableId === tableId && v.id === id)))
    },
  }
}

// --- Chart preview spec ---------------------------------------------------

/**
 * Build a default `ChartSpec` (SCI-004 model) from a dataset's columns so the
 * explorer can show a chart preview without a saved analysis. Picks the first
 * numeric column as y and the first categorical/date/text column as x; falls
 * back to a row-index x when no suitable x column exists. Returns null when
 * the dataset has no numeric column to plot.
 */
export function buildDefaultChartSpec(
  table: ScientificTableWire,
): ChartSpec | null {
  const numericColumns = table.columns.filter(
    (c) => c.logical_type === 'decimal' || c.logical_type === 'integer',
  )
  if (numericColumns.length === 0) return null

  // For scatter/line charts both axes must be numeric. Pick the first two
  // numeric columns as X and Y so points actually render. Fall back to a
  // category/date/text column for X only when there is a single numeric column.
  const x =
    numericColumns.length >= 2
      ? numericColumns[0]
      : (table.columns.find(
          (c) =>
            c.logical_type === 'category' ||
            c.logical_type === 'date' ||
            c.logical_type === 'text',
        ) ?? null)
  const y = numericColumns[numericColumns.length >= 2 ? 1 : 0]
  const series = table.columns.find(
    (c) =>
      c.logical_type === 'category' || c.logical_type === 'text',
  )
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ tableId: table.id }],
    fields: {
      x: x ? { columnId: x.id, fieldName: x.field_name } : null,
      y: { columnId: y.id, fieldName: y.field_name },
      series: series
        ? { columnId: series.id, fieldName: series.field_name }
        : null,
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
    display: {
      axes: {
        x: { label: x?.label ?? 'Row', scale: 'linear' },
        y: { label: y.label, scale: 'linear' },
      },
      series: [
        {
          identifier: 'all',
          label: 'all',
          color: '#006EDC',
        },
      ],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }
}

/**
 * Validate that a transformation list stays within the safe limits and uses
 * only the supported kinds. Surfaced as a recoverable error so the explorer
 * can reject an invalid spec without mutating source data.
 */
export function validateTransformations(
  transformations: readonly {
    kind: string
    params: unknown
  }[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (transformations.length > DATASET_MAX_TRANSFORMATIONS) {
    errors.push(
      `At most ${DATASET_MAX_TRANSFORMATIONS} transformations are allowed.`,
    )
  }
  for (const t of transformations) {
    if (t.kind !== 'aggregate' && t.kind !== 'bin' && t.kind !== 'normalise') {
      errors.push(`Unsupported transformation kind: ${String(t.kind)}.`)
    }
    if (
      typeof t.params !== 'object' ||
      t.params === null ||
      Array.isArray(t.params)
    ) {
      errors.push('Transformation params must be an object.')
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}
