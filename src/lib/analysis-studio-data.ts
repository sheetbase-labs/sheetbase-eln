/**
 * ANALYSIS-001 — Analysis Studio data layer.
 *
 * Typed wrappers over the saved-analysis-view PostgREST resource
 * (`api.analysis_views`) plus pure export helpers. Every read/write goes
 * through the same `/api/db` boundary and RLS as the rest of the application;
 * PostgreSQL remains authoritative (decisions 0019/0029/0034).
 *
 * The studio builds a `ChartSpec` (SCI-004) from typed controls, materialises
 * a read-only preview through the pure `materialiseLiveChart` path, and saves
 * a reproducible view with the source revisions captured at save time so a
 * later reader can detect a stale source. Exports carry explicit format,
 * dimensions, theme and provenance metadata.
 */
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import {
  fetchDatasetSummaries,
  datasetExplorerDataClient,
} from './dataset-explorer-data'
import type { ScientificTableWire } from './scientific-sheet-data'
import {
  validateChartSpec,
  applyFilters,
  materialiseChart,
  materialiseFacetedCharts,
  formatScientific,
} from './chart-spec'
import type {
  ChartColumn,
  ChartSpec,
  FacetedResult,
  MaterialisedChart,
  Transformation,
} from './chart-spec'

export type { FacetedResult }

// --- Safe limits ----------------------------------------------------------
//
// The studio confines interactive analysis to these limits so a browser
// session never builds an unbounded query. The hard row ceiling matches the
// `query_dataset` / scientific-table read ceiling; results beyond it are
// surfaced as an explicit excessive-size state rather than rendered silently.

export const ANALYSIS_MAX_FILTERS = 8
export const ANALYSIS_MAX_TRANSFORMATIONS = 4
export const ANALYSIS_MAX_RESULT_ROWS = 5000

export const analysisStudioDataClient = createDataClient()

export const analysisStudioQueryKeys = {
  views: ['analysis-views'] as const,
  datasets: ['analysis-datasets'] as const,
  view: (id: string) => ['analysis-view', id] as const,
}

// --- Source revision capture ---------------------------------------------

export interface SourceRevision {
  tableId: string
  schemaVersion: number
  datasetSchemaId: string | null
  datasetSchemaRevision: number | null
}

/**
 * Capture the source revisions for every dataset a ChartSpec references, so a
 * saved view records the exact table + schema revision it was built against.
 * A later load can compare these against the live metadata and surface a
 * stale-source state when the underlying dataset has evolved.
 */
export function captureSourceRevisions(
  tables: ScientificTableWire[],
  spec: ChartSpec,
): SourceRevision[] {
  const byId = new Map(tables.map((t) => [t.id, t]))
  return spec.datasets.map((ref) => {
    const table = byId.get(ref.tableId) ?? null
    return {
      tableId: ref.tableId,
      schemaVersion: table?.schema_version ?? 0,
      datasetSchemaId: table?.dataset_schema_id ?? null,
      datasetSchemaRevision: table?.dataset_schema_revision ?? null,
    }
  })
}

/**
 * Compare stored source revisions against the live dataset metadata. Returns
 * a human-readable stale detail when any referenced table has been revised
 * since the view was saved, or null when the sources are current.
 */
export function detectStaleSources(
  stored: SourceRevision[],
  tables: ScientificTableWire[],
): string | null {
  const byId = new Map(tables.map((t) => [t.id, t]))
  for (const rev of stored) {
    const table = byId.get(rev.tableId)
    if (!table) {
      return `Dataset ${rev.tableId.slice(0, 8)} is no longer available.`
    }
    if (table.schema_version !== rev.schemaVersion) {
      return `Dataset "${table.name}" was revised (schema v${rev.schemaVersion} → v${table.schema_version}) since this view was saved.`
    }
    if (
      rev.datasetSchemaRevision !== null &&
      table.dataset_schema_revision !== null &&
      table.dataset_schema_revision !== rev.datasetSchemaRevision
    ) {
      return `Dataset "${table.name}" schema was upgraded (revision ${rev.datasetSchemaRevision} → ${table.dataset_schema_revision}) since this view was saved.`
    }
  }
  return null
}

// --- Saved view wire + persistence ---------------------------------------

export interface AnalysisViewWire {
  id: string
  workspace_id: string
  owner_user_id: string
  name: string
  version: number
  spec: ChartSpec
  source_revisions: SourceRevision[]
  export_settings: ExportSettings | null
  created_at: string
  updated_at: string
}

export interface ExportSettings {
  format: 'json' | 'csv' | 'svg'
  width: number
  height: number
  theme: 'light' | 'dark'
  includeProvenance: boolean
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'json',
  width: 1280,
  height: 720,
  theme: 'light',
  includeProvenance: true,
}

export interface SaveAnalysisViewInput {
  id?: string
  name: string
  spec: ChartSpec
  source_revisions: SourceRevision[]
  export_settings: ExportSettings | null
}

/**
 * Fetch every analysis view the caller can see in the active workspace. RLS
 * scopes the result; the caller never filters by workspace client-side.
 */
export async function fetchAnalysisViews(
  client: DataClient = analysisStudioDataClient,
): Promise<AnalysisViewWire[]> {
  return client.list<AnalysisViewWire>(
    'analysis_views',
    '?order=updated_at.desc',
  )
}

/**
 * Insert a new analysis view. The caller sends the full ChartSpec and the
 * captured source revisions so the stored row is self-contained. Returns the
 * inserted row with the server-assigned id and version.
 */
export async function createAnalysisView(
  client: DataClient,
  input: SaveAnalysisViewInput,
  workspaceId: string,
  userId: string,
): Promise<AnalysisViewWire> {
  return client.insert<AnalysisViewWire>('analysis_views', {
    workspace_id: workspaceId,
    owner_user_id: userId,
    name: input.name,
    spec: input.spec,
    source_revisions: input.source_revisions,
    export_settings: input.export_settings,
  })
}

/**
 * Update an existing analysis view's spec and source revisions. The
 * `bump_analysis_view_version` trigger increments `version` and `updated_at`
 * server-side, so the caller sends the full spec, not a patch.
 */
export async function updateAnalysisView(
  client: DataClient,
  id: string,
  input: SaveAnalysisViewInput,
): Promise<AnalysisViewWire> {
  const updated = await client.patch<AnalysisViewWire>(
    'analysis_views',
    `?id=eq.${encodeURIComponent(id)}`,
    {
      name: input.name,
      spec: input.spec,
      source_revisions: input.source_revisions,
      export_settings: input.export_settings,
    },
  )
  return updated[0]
}

/**
 * Save (upsert) an analysis view: insert when no id, update when an id is
 * present. The caller re-sends the full ChartSpec so the stored view stays
 * reproducible from its specification alone.
 */
export async function saveAnalysisView(
  client: DataClient,
  input: SaveAnalysisViewInput,
  workspaceId: string,
  userId: string,
): Promise<AnalysisViewWire> {
  if (input.id) {
    return updateAnalysisView(client, input.id, input)
  }
  return createAnalysisView(client, input, workspaceId, userId)
}

export async function deleteAnalysisView(
  client: DataClient,
  id: string,
): Promise<void> {
  await client.remove('analysis_views', `?id=eq.${encodeURIComponent(id)}`)
}

// --- Validation -----------------------------------------------------------

/**
 * Validate a ChartSpec intended for an analysis view. Wraps the SCI-004
 * structural validator and adds the analysis-studio safe-limit checks
 * (filter and transformation counts, result-size ceiling reported by the
 * caller). Returns field-level errors the UI surfaces honestly.
 */
export function validateAnalysisSpec(
  spec: unknown,
  resultRowCount = 0,
): { ok: true } | { ok: false; errors: string[] } {
  const specErrors = validateChartSpec(spec)
  const errors = specErrors.map((e) => `${e.field ?? 'spec'}: ${e.message}`)
  if (spec && typeof spec === 'object' && 'filters' in spec) {
    const filters = spec.filters
    if (Array.isArray(filters) && filters.length > ANALYSIS_MAX_FILTERS) {
      errors.push(
        `At most ${ANALYSIS_MAX_FILTERS} filters are allowed in an analysis view.`,
      )
    }
  }
  if (spec && typeof spec === 'object' && 'transformations' in spec) {
    const transformations = spec.transformations
    if (
      Array.isArray(transformations) &&
      transformations.length > ANALYSIS_MAX_TRANSFORMATIONS
    ) {
      errors.push(
        `At most ${ANALYSIS_MAX_TRANSFORMATIONS} transformations are allowed.`,
      )
    }
  }
  if (resultRowCount > ANALYSIS_MAX_RESULT_ROWS) {
    errors.push(
      `Result set (${resultRowCount} rows) exceeds the ${ANALYSIS_MAX_RESULT_ROWS}-row analysis limit. Filter or aggregate the data before plotting.`,
    )
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

// --- Transformation application (pure) -----------------------------------

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

/** Read a string param with a fallback, type-guarding the unknown value. */
function strParam(
  params: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return typeof params[key] === 'string' ? params[key] : fallback
}

/**
 * Apply an `aggregate` transformation to a set of rows. Groups by the x field
 * (and the series field when the spec maps one) and reduces the y field with
 * the chosen function. Produces one row per group with the same field names so
 * the result stays plottable by `materialiseChart`.
 *
 * Supported params: `{ function: 'mean' | 'sum' | 'min' | 'max' | 'count',
 * yField: string, xField: string, seriesField?: string }`.
 */
function applyAggregate(
  rows: Record<string, unknown>[],
  params: Record<string, unknown>,
  spec: ChartSpec,
): Record<string, unknown>[] {
  const fn = strParam(params, 'function', 'mean')
  const xField = strParam(params, 'xField', spec.fields.x?.fieldName ?? 'x')
  const yField = strParam(params, 'yField', spec.fields.y.fieldName)
  const seriesFieldRaw = strParam(
    params,
    'seriesField',
    spec.fields.series?.fieldName ?? '',
  )
  const seriesField = seriesFieldRaw || null
  const groups = new Map<
    string,
    { x: unknown; series: unknown; ys: number[] }
  >()
  for (const row of rows) {
    const x = row[xField]
    const series = seriesField ? row[seriesField] : null
    const key = `${String(x ?? '—')}::${String(series ?? '—')}`
    const y = toNumber(row[yField])
    if (!groups.has(key)) {
      groups.set(key, { x, series, ys: [] })
    }
    if (y !== null) groups.get(key)!.ys.push(y)
  }
  const out: Record<string, unknown>[] = []
  for (const g of groups.values()) {
    let reduced: number
    if (fn === 'count') {
      reduced = g.ys.length
    } else if (g.ys.length === 0) {
      reduced = 0
    } else if (fn === 'sum') {
      reduced = g.ys.reduce((a, b) => a + b, 0)
    } else if (fn === 'min') {
      reduced = Math.min(...g.ys)
    } else if (fn === 'max') {
      reduced = Math.max(...g.ys)
    } else {
      // mean (default)
      reduced = g.ys.reduce((a, b) => a + b, 0) / g.ys.length
    }
    const row: Record<string, unknown> = { [xField]: g.x, [yField]: reduced }
    if (seriesField) row[seriesField] = g.series
    out.push(row)
  }
  return out
}

/**
 * Apply a `normalise` transformation to a set of rows. Scales the y field
 * within each series group so the chart can compare series on a common axis.
 *
 * Supported params: `{ method: 'percent_of_max' | 'z_score',
 * yField: string, seriesField?: string }`.
 */
function applyNormalise(
  rows: Record<string, unknown>[],
  params: Record<string, unknown>,
  spec: ChartSpec,
): Record<string, unknown>[] {
  const method = strParam(params, 'method', 'percent_of_max')
  const yField = strParam(params, 'yField', spec.fields.y.fieldName)
  const seriesFieldRaw = strParam(
    params,
    'seriesField',
    spec.fields.series?.fieldName ?? '',
  )
  const seriesField = seriesFieldRaw || null
  // Group values by series for per-series normalisation.
  const bySeries = new Map<string, number[]>()
  for (const row of rows) {
    const y = toNumber(row[yField])
    if (y === null) continue
    const key = seriesField ? String(row[seriesField] ?? '—') : 'all'
    if (!bySeries.has(key)) bySeries.set(key, [])
    bySeries.get(key)!.push(y)
  }
  const stats = new Map<string, { max: number; mean: number; sd: number }>()
  for (const [key, ys] of bySeries) {
    if (ys.length === 0) {
      stats.set(key, { max: 0, mean: 0, sd: 0 })
      continue
    }
    const max = Math.max(...ys)
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length
    const variance =
      ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length || 1)
    stats.set(key, { max, mean, sd: Math.sqrt(variance) })
  }
  return rows.map((row) => {
    const y = toNumber(row[yField])
    if (y === null) return row
    const key = seriesField ? String(row[seriesField] ?? '—') : 'all'
    const s = stats.get(key) ?? { max: 0, mean: 0, sd: 0 }
    let normalised: number
    if (method === 'z_score') {
      normalised = s.sd > 0 ? (y - s.mean) / s.sd : 0
    } else {
      // percent_of_max (default)
      normalised = s.max > 0 ? (y / s.max) * 100 : 0
    }
    return { ...row, [yField]: normalised }
  })
}

/**
 * Apply a chain of transformations in order. `bin` is accepted (stored
 * reproducibly) but not yet reduced — binned rows pass through unchanged so
 * the spec stays valid and forward-compatible. The caller surfaces this
 * honestly via the validation path.
 */
export function applyTransformations(
  rows: Record<string, unknown>[],
  transformations: readonly Transformation[],
  spec: ChartSpec,
): Record<string, unknown>[] {
  let current = rows
  for (const t of transformations) {
    if (t.kind === 'aggregate') {
      current = applyAggregate(current, t.params, spec)
    } else if (t.kind === 'normalise') {
      current = applyNormalise(current, t.params, spec)
    }
    // 'bin' is a no-op pass-through until bin rendering lands.
  }
  return current
}

/**
 * Materialise an analysis chart from a spec + columns + rows. Wraps the
 * shared SCI-004 `materialiseChart` but applies the spec's transformations
 * (aggregation, normalisation) to the filtered rows first, so the preview
 * reflects the typed controls the user built. Pure: never mutates the input
 * rows or the source dataset.
 */
export function materialiseAnalysisChart(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
): MaterialisedChart {
  const filtered = applyFilters(rows, spec.filters)
  const transformed = applyTransformations(filtered, spec.transformations, spec)
  // materialiseChart re-applies filters; pass a spec copy with no filters so
  // the already-filtered+transformed rows are plotted as-is.
  const specForMaterialise: ChartSpec = { ...spec, filters: [] }
  return materialiseChart(specForMaterialise, columns, transformed)
}

/**
 * Facet the analysis preview into small multiples. Runs the same
 * filter+transform pipeline as `materialiseAnalysisChart`, then partitions
 * by the spec's facet column (capped at MAX_FACETS, honestly reported).
 */
export function materialiseAnalysisFacets(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
): FacetedResult {
  const filtered = applyFilters(rows, spec.filters)
  const transformed = applyTransformations(filtered, spec.transformations, spec)
  return materialiseFacetedCharts(
    { ...spec, filters: [] },
    columns,
    transformed,
  )
}

// --- Export helpers -------------------------------------------------------

export interface ExportProvenance {
  viewName: string
  viewId: string | null
  viewVersion: number | null
  exportedAt: string
  exportedBy: string
  sourceRevisions: SourceRevision[]
  spec: ChartSpec
}

/**
 * Build the provenance metadata block for an export. Included when the
 * export settings request it; always available to the caller.
 */
export function buildExportProvenance(
  view: { name: string; id: string | null; version: number | null },
  user: { id: string; name: string },
  sourceRevisions: SourceRevision[],
  spec: ChartSpec,
): ExportProvenance {
  return {
    viewName: view.name,
    viewId: view.id,
    viewVersion: view.version,
    exportedAt: new Date().toISOString(),
    exportedBy: user.name,
    sourceRevisions,
    spec,
  }
}

/**
 * Serialise an analysis view to a self-contained JSON document with explicit
 * format, dimensions, theme and provenance metadata. The document is the
 * reproducible artefact: feeding its `spec` back into the studio rebuilds the
 * same chart.
 */
export function exportViewJson(
  spec: ChartSpec,
  settings: ExportSettings,
  provenance: ExportProvenance | null,
): string {
  const document = {
    format: 'sheetbase-analysis-view',
    formatVersion: 1,
    settings: {
      format: settings.format,
      width: settings.width,
      height: settings.height,
      theme: settings.theme,
      includeProvenance: settings.includeProvenance,
    },
    spec,
    provenance: settings.includeProvenance ? provenance : null,
  }
  return JSON.stringify(document, null, 2)
}

/**
 * Serialise the materialised chart's underlying rows to CSV. The data table
 * is the accessible alternative to the visual; the CSV carries the exact
 * rows the chart plots so the export is verifiable without the visual.
 */
export function exportDataCsv(materialised: MaterialisedChart): string {
  const header = ['series', 'x', 'y', 'yError']
  const lines: string[] = [header.join(',')]
  for (const s of materialised.series) {
    for (const p of s.points) {
      lines.push(
        [
          csvField(s.label),
          csvField(p.x === null ? '' : formatScientific(p.x)),
          csvField(p.y === null ? '' : formatScientific(p.y)),
          csvField(
            p.yError === null || p.yError === undefined
              ? ''
              : formatScientific(p.yError),
          ),
        ].join(','),
      )
    }
  }
  return lines.join('\n')
}

function csvField(value: string): string {
  if (value === '') return ''
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Serialise the chart's SVG element to a standalone SVG document string with
 * explicit width/height and a provenance comment. The caller passes the
 * rendered SVG element so the export matches what the user saw.
 */
export function exportChartSvg(
  svgEl: SVGSVGElement | null,
  settings: ExportSettings,
  provenance: ExportProvenance | null,
): string {
  if (!svgEl) {
    return `<!-- Sheetbase Analysis Studio: no chart rendered at export time -->`
  }
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(settings.width))
  clone.setAttribute('height', String(settings.height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (settings.theme === 'dark') {
    clone.setAttribute('data-theme', 'dark')
  }
  const serialised = new XMLSerializer().serializeToString(clone)
  const comment = provenance
    ? `\n<!-- Sheetbase Analysis Studio export\nview: ${provenance.viewName}${provenance.viewId ? ` (${provenance.viewId.slice(0, 8)})` : ''} v${provenance.viewVersion ?? '?'}\nexported by ${provenance.exportedBy} at ${provenance.exportedAt}\nsources: ${provenance.sourceRevisions.map((r) => r.tableId.slice(0, 8)).join(', ')}\n-->\n`
    : ''
  return `${comment}${serialised}`
}

// --- Dataset listing (shared with the explorer) ---------------------------

export { fetchDatasetSummaries, datasetExplorerDataClient }
