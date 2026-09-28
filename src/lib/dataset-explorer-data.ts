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
import type { RegistryFilterValue } from './registry'

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
  summaries: (includeArchived = false) =>
    ['dataset-explorer-summaries', includeArchived] as const,
  /** NAV-02: lifecycle of one Dataset by stable ID, regardless of archive state. */
  lifecycle: (datasetId: string) =>
    ['dataset-explorer-dataset-lifecycle', datasetId] as const,
  rows: (datasetId: string, queryId: string) =>
    ['dataset-explorer-rows', datasetId, queryId] as const,
  rowCount: (datasetId: string, queryId: string) =>
    ['dataset-explorer-row-count', datasetId, queryId] as const,
  schemaFields: (schemaId: string) =>
    ['dataset-explorer-schema-fields', schemaId] as const,
  relationships: ['dataset-explorer-relationships'] as const,
  lineage: (datasetId: string) =>
    ['dataset-explorer-lineage', datasetId] as const,
  links: (recordId: string) => ['dataset-explorer-links', recordId] as const,
  versions: (datasetId: string) =>
    ['dataset-explorer-versions', datasetId] as const,
  dependencies: (datasetId: string) =>
    ['dataset-explorer-dependencies', datasetId] as const,
  schemaContext: (schemaVersionId: string) =>
    ['dataset-explorer-schema-context', schemaVersionId] as const,
}

export interface CanonicalDatasetWire extends ScientificTableWire {
  workspace_id?: string
  schema_version_id?: string
  description?: string | null
  revision?: number
  schema_definition_id?: string | null
  schema_version_number?: number | null
}

interface DatasetResourceWire {
  id: string
  workspace_id: string
  schema_version_id: string
  name: string
  description: string | null
  lifecycle: 'active' | 'archived'
  revision: number
}

interface DatasetVersionFieldWire {
  field_id: string
  schema_version_id: string
  key: string
  label: string
  logical_type: ScientificColumnWire['logical_type']
  nullable: boolean
  quantity: unknown
  validation: Record<string, unknown>
  lifecycle: 'active' | 'retired'
  display_order: number
}

// --- Dataset listing ------------------------------------------------------

/**
 * NAV-02: read one Dataset's lifecycle by stable ID, regardless of archive
 * state. Deep links (Sheet provenance) carry only the stable UUID — the
 * explorer uses this to flip itself to the archived view instead of
 * silently selecting a different active Dataset.
 */
export async function fetchDatasetLifecycleById(
  client: DataClient = datasetExplorerDataClient,
  datasetId: string,
): Promise<'active' | 'archived' | 'retired' | null> {
  const rows = await client.list<{
    lifecycle: 'active' | 'archived' | 'retired'
  }>('datasets', `?id=eq.${encodeURIComponent(datasetId)}&select=lifecycle`)
  return rows.at(0)?.lifecycle ?? null
}

export interface DatasetDeepLinkSelectionInput {
  /** Dataset summaries currently listed (already lifecycle-filtered). */
  datasets: ReadonlyArray<{ id: string }>
  /** Stable Dataset ID requested by the deep link, if any. */
  requestedDatasetId: string | null
  /**
   * Lifecycle of the requested Dataset as resolved by
   * `fetchDatasetLifecycleById`. `undefined` while the lookup has not run
   * or is still in flight; `null` when the Dataset does not exist.
   */
  requestedLifecycle: 'active' | 'archived' | 'retired' | null | undefined
  /** Whether the summaries list has loaded for the current filter. */
  summariesLoaded: boolean
}

export interface DatasetDeepLinkSelection {
  /** Dataset to select; `null` when nothing can honestly be selected. */
  selectedDatasetId: string | null
  /** Switch the explorer URL to `archived: true` for the requested Dataset. */
  flipToArchived: boolean
}

/**
 * NAV-02: archive-aware deep-link selection. A deep link carries only the
 * stable Dataset ID; the destination must select that exact Dataset —
 * flipping to the archived view when it is archived/retired — and never
 * fall back to a different active Dataset behind the caller's back.
 */
export function resolveDatasetDeepLinkSelection({
  datasets,
  requestedDatasetId,
  requestedLifecycle,
  summariesLoaded,
}: DatasetDeepLinkSelectionInput): DatasetDeepLinkSelection {
  if (!requestedDatasetId) {
    return {
      selectedDatasetId: datasets.at(0)?.id ?? null,
      flipToArchived: false,
    }
  }
  if (datasets.some((dataset) => dataset.id === requestedDatasetId)) {
    return { selectedDatasetId: requestedDatasetId, flipToArchived: false }
  }
  if (!summariesLoaded) {
    return { selectedDatasetId: null, flipToArchived: false }
  }
  if (requestedLifecycle === undefined) {
    // Lifecycle lookup still in flight: hold the requested selection.
    return { selectedDatasetId: null, flipToArchived: false }
  }
  if (requestedLifecycle === null) {
    // The requested Dataset does not exist: fall back to the list default.
    return {
      selectedDatasetId: datasets.at(0)?.id ?? null,
      flipToArchived: false,
    }
  }
  if (requestedLifecycle !== 'active') {
    // Archived/retired: keep selecting the requested Dataset, but in the
    // archived view where the list actually contains it.
    return { selectedDatasetId: null, flipToArchived: true }
  }
  // Active but absent from the list (e.g. raced creation): fall back.
  return {
    selectedDatasetId: datasets.at(0)?.id ?? null,
    flipToArchived: false,
  }
}

/** List canonical Datasets and the active fields pinned to each version. */
export async function fetchDatasetSummaries(
  client: DataClient = datasetExplorerDataClient,
  options: { includeArchived?: boolean } = {},
): Promise<CanonicalDatasetWire[]> {
  const lifecycleFilter = options.includeArchived ? '' : 'lifecycle=eq.active&'
  const datasets = await client.list<DatasetResourceWire>(
    'datasets',
    `?${lifecycleFilter}order=created_at.desc`,
  )
  const versionIds = [
    ...new Set(datasets.map((item) => item.schema_version_id)),
  ]
  const [fields, versions] = await Promise.all([
    versionIds.length
      ? client.list<DatasetVersionFieldWire>(
          'dataset_schema_version_fields',
          `?schema_version_id=in.(${versionIds.map(encodeURIComponent).join(',')})&lifecycle=eq.active&order=display_order.asc`,
        )
      : Promise.resolve([]),
    versionIds.length
      ? client.list<{
          id: string
          schema_id: string
          version: number
        }>(
          'dataset_schema_versions',
          `?id=in.(${versionIds.map(encodeURIComponent).join(',')})&select=id,schema_id,version`,
        )
      : Promise.resolve([]),
  ])
  const definitionIds = [...new Set(versions.map((item) => item.schema_id))]
  const definitions = definitionIds.length
    ? await client.list<{ id: string; name: string; key: string }>(
        'dataset_schema_definitions',
        `?id=in.(${definitionIds.map(encodeURIComponent).join(',')})&select=id,name,key`,
      )
    : []
  const versionById = new Map(versions.map((item) => [item.id, item]))
  const definitionById = new Map(definitions.map((item) => [item.id, item]))
  return datasets.map((dataset) => {
    const version = versionById.get(dataset.schema_version_id)
    const definition = version
      ? definitionById.get(version.schema_id)
      : undefined
    return {
      ...dataset,
      resource_name: '',
      schema_version: version?.version ?? 1,
      schema_definition_id: version?.schema_id ?? null,
      schema_version_number: version?.version ?? null,
      dataset_schema_id: version?.schema_id ?? null,
      record_id: undefined,
      dataset_schema: definition
        ? {
            id: definition.id,
            slug: definition.key,
            name: definition.name,
            revision: version?.version ?? 1,
            status: 'published',
            latest_published_revision: version?.version ?? null,
          }
        : null,
      columns: fields
        .filter(
          (field) => field.schema_version_id === dataset.schema_version_id,
        )
        .map((field) => ({
          id: field.field_id,
          field_name: field.field_id,
          label: field.label,
          display_order: field.display_order,
          logical_type: field.logical_type,
          nullable: field.nullable,
          unit: field.quantity,
          validation: field.validation,
          width: null,
          options: [],
        })),
    }
  })
}

// --- Paged canonical Dataset row query ------------------------------------

export interface DatasetRowQuery {
  pageIndex: number
  pageSize: number
  /** Sort descriptors; mapped to PostgREST `order`. */
  sorting: Array<{ id: string; desc: boolean }>
  /** Field-name → predicate value filters (eq semantics). */
  filters: RegistryFilterValue[]
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
export function buildDatasetRowQuery(
  query: DatasetRowQuery,
  columns: readonly ScientificColumnWire[],
): string {
  const fields = new Set(columns.map((column) => column.field_name))
  const limit = Math.min(Math.max(1, query.pageSize), DATASET_MAX_PAGE_SIZE)
  const offset = Math.max(0, query.pageIndex) * limit
  const parts: string[] = ['select=*']
  if (query.sorting.length > 0) {
    const sorting = query.sorting.map((sort) => {
      if (!fields.has(sort.id))
        throw new Error(`Unsupported dataset sort field: ${sort.id}`)
      return `${encodeURIComponent(sort.id)}.${sort.desc ? 'desc' : 'asc'}`
    })
    if (!query.sorting.some((sort) => sort.id === 'id')) sorting.push('id.asc')
    parts.push(`order=${sorting.join(',')}`)
  } else {
    parts.push('order=created_at.asc,id.asc')
  }
  for (const filter of query.filters.slice(0, DATASET_MAX_FILTERS)) {
    if (
      !fields.has(filter.fieldId) ||
      filter.operator !== 'eq' ||
      filter.values.length !== 1
    ) {
      throw new Error(
        `Unsupported dataset filter: ${filter.fieldId}/${filter.operator}`,
      )
    }
    const value = filter.values[0]
    if (value === '') continue
    parts.push(
      `${encodeURIComponent(filter.fieldId)}=eq.${encodeURIComponent(String(value))}`,
    )
  }
  parts.push(`limit=${limit}`, `offset=${offset}`)
  return `?${parts.join('&')}`
}

/** Fetch one canonical page. No generated physical resource is consulted. */
export async function fetchDatasetRowPage(
  client: DataClient,
  table: CanonicalDatasetWire,
  query: DatasetRowQuery,
  includeCount = true,
): Promise<DatasetRowPage> {
  const fieldIds = new Set(table.columns.map((field) => field.id))
  for (const filter of query.filters.slice(0, DATASET_MAX_FILTERS)) {
    if (!fieldIds.has(filter.fieldId) || filter.values.length !== 1)
      throw new Error(`Unsupported dataset filter: ${filter.fieldId}`)
  }
  const sort = query.sorting.at(0)
  if (sort && !fieldIds.has(sort.id))
    throw new Error(`Unsupported dataset sort field: ${sort.id}`)
  const limit = Math.min(Math.max(1, query.pageSize), DATASET_MAX_PAGE_SIZE)
  const result = await client.rpc<{
    rows: Array<{
      rowId: string
      revision: number
      values: Record<string, unknown>
    }>
    totalCount: number
  }>('query_dataset_rows', {
    p_dataset_id: table.id,
    p_query: {
      filters: query.filters.slice(0, DATASET_MAX_FILTERS).map((filter) => ({
        fieldId: filter.fieldId,
        operator: filter.operator,
        value: filter.values[0],
      })),
      ...(sort
        ? { sort: { fieldId: sort.id, direction: sort.desc ? 'desc' : 'asc' } }
        : {}),
    },
    p_limit: limit,
    p_offset: Math.max(0, query.pageIndex) * limit,
  })
  return {
    rows: result.rows.map((row) => ({
      id: row.rowId,
      version: row.revision,
      ...row.values,
    })),
    totalCount: includeCount ? result.totalCount : 0,
  }
}

/** Determine the next offset page from the authoritative first-page count. */
export function getNextDatasetPageParam(
  lastPage: DatasetRowPage,
  pages: DatasetRowPage[],
  pageSize: number,
): number | undefined {
  const loaded = pages.reduce((count, page) => count + page.rows.length, 0)
  const total = pages[0]?.totalCount ?? 0
  return lastPage.rows.length < pageSize || loaded >= total
    ? undefined
    : pages.length
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
  datasetId: string,
): Promise<DatasetLineage> {
  const [formulas, dependencies] = await Promise.all([
    fetchScientificFormulas(client, datasetId),
    fetchScientificDependencies(client, datasetId),
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
  datasetId: string
  spec: DatasetViewSpec
  updatedAt?: string
}

export interface DatasetSavedViewStore {
  list: (datasetId: string) => DatasetSavedView[]
  save: (view: DatasetSavedView) => DatasetSavedView
  remove: (datasetId: string, id: string) => void
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
        isRecord(f) &&
        typeof f.fieldId === 'string' &&
        f.operator === 'eq' &&
        Array.isArray(f.values) &&
        f.values.every(
          (item) =>
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean',
        ),
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
    typeof value.datasetId !== 'string'
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
    .filter(
      (f) =>
        fieldNames.has(f.fieldId) && f.operator === 'eq' && f.values[0] !== '',
    )
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
    list(datasetId) {
      return readAll().filter((v) => v.datasetId === datasetId)
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
    remove(datasetId, id) {
      writeAll(
        readAll().filter((v) => !(v.datasetId === datasetId && v.id === id)),
      )
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
    (c) => c.logical_type === 'category' || c.logical_type === 'text',
  )
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ datasetId: table.id }],
    fields: {
      x: x ? { fieldId: x.id } : null,
      y: { fieldId: y.id },
      series: series ? { fieldId: series.id } : null,
      color: null,
      size: null,
      facet: null,
      facetRow: null,
      facetCol: null,
      shape: null,
      group: null,
      label: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
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
    overlays: { errorBars: null, fit: null, references: [] },
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

// --- Snapshot summaries and comparison (DSET-03.1/03.2) -------------------

export interface DatasetVersionChange {
  added: number
  removed: number
  changed: number
}

export interface DatasetVersionRetention {
  reason: string
  keptUntil: string | null
}

export interface DatasetVersionSummary {
  id: string
  label: string
  createdAt: string
  createdByUserId: string | null
  sourceDatasetRevision: number
  rowCount: number
  change: DatasetVersionChange | null
  retention: DatasetVersionRetention
}

export async function listDatasetVersionSummaries(
  client: DataClient,
  datasetId: string,
): Promise<DatasetVersionSummary[]> {
  return client.rpc<DatasetVersionSummary[]>('dataset_version_list', {
    p_dataset_id: datasetId,
  })
}

export async function compareDatasetVersions(
  client: DataClient,
  versionA: string,
  versionB: string,
  limit = 100,
  offset = 0,
): Promise<{
  counts: DatasetVersionChange
  columns: Array<{ fieldId: string; kind: string }>
  rows: Array<{ rowId: string; kind: string }>
}> {
  return client.rpc('compare_dataset_versions', {
    p_version_a: versionA,
    p_version_b: versionB,
    p_limit: limit,
    p_offset: offset,
  })
}
