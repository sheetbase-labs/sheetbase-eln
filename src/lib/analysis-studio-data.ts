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
import { createDataClient, DataClientError } from './data-client'
import type { DataClient } from './data-client'
import { serializeChartSvg as serializePackageChartSvg } from '@sheetbase-labs/sheetbase-explorer'
import {
  fetchDatasetSummaries,
  datasetExplorerDataClient,
} from './dataset-explorer-data'
import { chartUsedFieldIds } from './chart-data'
import { isDuplicateLinkError } from './scientific-records'
import type { CanonicalDatasetSource } from './chart-data'
import { filterRowsByFlags } from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'
import {
  validateChartSpec,
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
import { applyTransformations as applyVisualisationTransforms } from './visualisation-pipeline'

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
  sourceStatus: (id: string) => ['analysis-view', id, 'source-status'] as const,
  citations: (id: string) => ['analysis-view', id, 'citations'] as const,
}

// --- Source revision capture ---------------------------------------------

export interface SourceRevision {
  datasetId: string
  /** Numeric version of the Dataset Schema Version the source pins. */
  schemaVersionNumber: number
  /** Live dataset revision at capture time. */
  revision: number
}

/**
 * Capture the source revisions for every dataset a ChartSpec references, so a
 * saved view records the exact table + schema revision it was built against.
 * A later load can compare these against the live metadata and surface a
 * stale-source state when the underlying dataset has evolved.
 */
export function captureSourceRevisions(
  sources: CanonicalDatasetSource[],
  spec: ChartSpec,
): SourceRevision[] {
  const byId = new Map(sources.map((s) => [s.datasetId, s]))
  return spec.datasets.map((ref) => {
    const source = byId.get(ref.datasetId)
    return {
      datasetId: ref.datasetId,
      schemaVersionNumber: source?.schemaVersionNumber ?? 0,
      revision: source?.revision ?? 0,
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
  sources: CanonicalDatasetSource[],
): string | null {
  const byId = new Map(sources.map((s) => [s.datasetId, s]))
  for (const rev of stored) {
    const source = byId.get(rev.datasetId)
    if (!source) {
      return `Dataset ${rev.datasetId.slice(0, 8)} is no longer available.`
    }
    if (source.schemaVersionNumber !== rev.schemaVersionNumber) {
      return `Dataset "${source.name}" moved to schema v${source.schemaVersionNumber} (saved against v${rev.schemaVersionNumber}).`
    }
    if (source.revision !== rev.revision) {
      return `Dataset "${source.name}" was revised (r${rev.revision} → r${source.revision}) since this view was saved.`
    }
  }
  return null
}

// --- Stale-source status, resolution and citations (R5-STUDIO-03) ---------
//
// The canonical comparison lives in the database
// (`api.analysis_view_source_status`), because "newer" is defined against the
// frozen-source contract rather than against whatever a browser session happened
// to load: a source is stale when its live schema version number or dataset
// revision differs from the pinned pair, and removed when the dataset no longer
// resolves in the workspace. `detectStaleSources` above stays for callers that
// hold both sides in memory (the read-only route); the studio resolves through
// the RPC so the resolution is recorded server-side.

export type AnalysisSourceStatus = 'current' | 'stale' | 'removed'

export interface AnalysisSourceState {
  datasetId: string
  datasetName: string
  displayId: string | null
  pinned: { schemaVersionNumber: number; revision: number }
  live: { schemaVersionNumber: number; revision: number } | null
  status: AnalysisSourceStatus
  detail: string
}

export interface AnalysisViewSourceStatus {
  viewId: string
  displayId: string | null
  name: string
  version: number
  state: 'current' | 'stale'
  staleCount: number
  removedCount: number
  sources: AnalysisSourceState[]
  /** Records that cite the view through the existing citation records. */
  citedByCount: number
  /** Citing records that are locked (an approve-for-record signature). */
  citedByLockedCount: number
  /** The last explicit `keep` that still applies to the pinned revisions. */
  acknowledged: {
    at: string
    actorUserId: string
    viewVersion: number
    revisions: SourceRevision[]
  } | null
}

export interface AnalysisViewCitation {
  linkId: string
  sourceRecordId: string
  identifier: string
  title: string
  recordStatus: string
  linkedAt: string
  locked: boolean
  lockedAt: string | null
  signed: boolean
  signedAt: string | null
  signerUserId: string | null
}

export type AnalysisSourceResolution = 'keep' | 'update'

export interface ResolveAnalysisViewSourcesInput {
  viewId: string
  /** The version the caller read; the server refuses a stale expectation. */
  expectedVersion: number
  resolution: AnalysisSourceResolution
  /** Optional note recorded with the decision in the history path. */
  justification?: string | null
}

export interface ResolveAnalysisViewSourcesResult {
  resolution: AnalysisSourceResolution
  state: 'current' | 'stale'
  acknowledged: boolean
  version: number
  revisions: SourceRevision[]
}

/**
 * The canonical staleness answer for one saved view: per-source status,
 * whether the view is cited, and the last recorded `keep`.
 */
export async function fetchAnalysisViewSourceStatus(
  client: DataClient,
  viewId: string,
): Promise<AnalysisViewSourceStatus> {
  return client.rpc<AnalysisViewSourceStatus>('analysis_view_source_status', {
    p_view_id: viewId,
  })
}

/** The records citing this view, with their signed/locked state. */
export async function fetchAnalysisViewCitations(
  client: DataClient,
  viewId: string,
): Promise<AnalysisViewCitation[]> {
  return client.rpc<AnalysisViewCitation[]>('analysis_view_citations', {
    p_view_id: viewId,
  })
}

/**
 * Resolve a stale source deliberately. `keep` leaves the pins untouched and
 * records the decision; `update` re-pins to the live version and is refused for
 * a view cited by a record (a cited analysis keeps the sources it cited).
 */
export async function resolveAnalysisViewSources(
  client: DataClient,
  input: ResolveAnalysisViewSourcesInput,
): Promise<ResolveAnalysisViewSourcesResult> {
  return client.rpc<ResolveAnalysisViewSourcesResult>(
    'resolve_analysis_view_sources',
    {
      p_view_id: input.viewId,
      p_expected_version: input.expectedVersion,
      p_resolution: input.resolution,
      p_justification: input.justification ?? null,
    },
  )
}

export interface AnalysisViewWire {
  id: string
  workspace_id: string
  owner_user_id: string
  name: string
  display_id: string | null
  version: number
  spec: ChartSpec
  source_revisions: SourceRevision[]
  export_settings: ExportSettings | null
  created_at: string
  updated_at: string
}

export interface ExportSettings {
  format: 'json' | 'csv' | 'svg' | 'png'
  width: number
  height: number
  theme: 'light' | 'dark'
  includeProvenance: boolean
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  // A figure is exported to be used in a document, so an image is the default;
  // the data and the spec stay one choice away.
  format: 'png',
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
 *
 * PostgREST answers a PATCH that matches no row with an empty representation
 * and no error, so a view deleted since the list was read would otherwise look
 * updated. The write is only reported as saved when the row came back.
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
  if (updated.length === 0) {
    throw new DataClientError(
      'analysis_view_missing',
      'This view no longer exists — it was deleted, or you can no longer see it. Saving again creates a new view.',
      404,
    )
  }
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

/**
 * Record that a notebook cites a saved analysis view. A citation is a
 * `record_links` row (`target_kind` and `link_type` 'analysis') whose
 * `target_identifier` is the view's stable `display_id`; Cited by, the
 * experiment Results tab and the cited-update guard all read exactly that row.
 * Citing the same view twice is a no-op: the unique link already says it.
 */
export async function recordAnalysisCitation(
  client: DataClient,
  sourceRecordId: string,
  view: Pick<AnalysisViewWire, 'display_id'>,
): Promise<void> {
  if (!view.display_id) return
  try {
    await client.rpc('create_record_link', {
      p_source_record_id: sourceRecordId,
      p_target_kind: 'analysis',
      p_target_identifier: view.display_id,
      p_link_type: 'analysis',
      p_target_record_id: null,
    })
  } catch (error) {
    if (!isDuplicateLinkError(error)) throw error
  }
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

export function applyTransformations(
  rows: Record<string, unknown>[],
  transformations: readonly Transformation[],
  spec: ChartSpec,
): Record<string, unknown>[] {
  return applyVisualisationTransforms(rows, transformations, spec).rows
}

/**
 * Materialise an analysis chart. Transforms now live inside
 * `materialiseChart`, so the studio uses the same pipeline as Notebook charts.
 * `flags` carries the dataset's active value flags: a row is left out when any
 * field the spec binds is flagged, exactly as `materialiseLiveChart` does, so
 * the studio preview/export cannot plot a value the UI excludes from analyses.
 */
export function materialiseAnalysisChart(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
  flags: readonly DatasetValueFlag[] = [],
): MaterialisedChart {
  const chartRows =
    flags.length === 0
      ? rows
      : filterRowsByFlags(rows, flags, chartUsedFieldIds(spec))
  return materialiseChart(spec, columns, chartRows)
}

/**
 * Facet the analysis preview into small multiples, under the same flag rule.
 */
export function materialiseAnalysisFacets(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
  flags: readonly DatasetValueFlag[] = [],
): FacetedResult {
  const chartRows =
    flags.length === 0
      ? rows
      : filterRowsByFlags(rows, flags, chartUsedFieldIds(spec))
  return materialiseFacetedCharts(spec, columns, chartRows)
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
 * rows the chart plots so the export is verifiable without the visual. When
 * `provenance` is supplied (the export setting requests it) the header block
 * names the view, its version, the exporter and the pinned source revisions,
 * so the CSV is reproducible on its own.
 */
export function exportDataCsv(
  materialised: MaterialisedChart,
  provenance: ExportProvenance | null = null,
): string {
  const lines: string[] = []
  if (provenance) {
    // The version line states what was exported. An ad-hoc export has no
    // stored version, and the header says so by leaving it out rather than
    // printing a placeholder as if it were the version.
    const version =
      provenance.viewVersion === null ? '' : ` v${provenance.viewVersion}`
    const view = `${provenance.viewName}${
      provenance.viewId ? ` (${provenance.viewId.slice(0, 8)})` : ''
    }${version}`
    const sources = provenance.sourceRevisions
      .map((revision) => revision.datasetId.slice(0, 8))
      .join(', ')
    lines.push(
      '# Sheetbase Analysis Studio export',
      `# view: ${view.replace(/\s+/g, ' ')}`,
      `# exported by ${provenance.exportedBy} at ${provenance.exportedAt}`,
      `# sources: ${sources || 'none'}`,
    )
  }
  lines.push(['series', 'x', 'y', 'yError'].join(','))
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
 * Resolve the theme variables an SVG references into concrete declarations.
 * The figure draws with `var(--text)`, `var(--series-a)`… so a standalone
 * document must inline them; the probe carries the v3 scope and the requested
 * theme class so Light and Dark resolve to the values the app would render.
 */
function resolveThemeDeclarations(
  svg: string,
  theme: 'light' | 'dark',
): string {
  if (typeof document === 'undefined') return ''
  const names = new Set<string>(['--surface'])
  for (const match of svg.matchAll(/var\(\s*(--[a-z0-9-]+)/gi))
    names.add(match[1])
  const probe = document.createElement('div')
  probe.className =
    theme === 'dark' ? 'sheetbase-scope dark' : 'sheetbase-scope'
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe)
  const rootComputed = getComputedStyle(document.documentElement)
  const declarations: string[] = []
  for (const name of names) {
    const value =
      computed.getPropertyValue(name).trim() ||
      rootComputed.getPropertyValue(name).trim()
    if (value) declarations.push(`${name}:${value}`)
  }
  probe.remove()
  return declarations.join(';')
}

/**
 * Serialise the chart's SVG element to a standalone SVG document string with
 * explicit width/height, the themed colours inlined and a provenance comment.
 * The caller passes the rendered SVG element so the export matches what the
 * user saw; the theme setting changes the exported colours, and the
 * provenance comment is emitted only when the settings request it.
 */
export function exportChartSvg(
  svgEl: SVGSVGElement | null,
  settings: ExportSettings,
  provenance: ExportProvenance | null,
): string {
  if (!svgEl) {
    return `<!-- Sheetbase Analysis Studio: no chart rendered at export time -->`
  }
  // The figure is drawn by sheetbase-explorer, so serialise it through the
  // package's export helper, then stamp the export preset's dimensions and
  // provenance on top of the returned document.
  const routed = svgEl.parentElement
    ? serializePackageChartSvg(svgEl.parentElement)
    : undefined
  const base = routed ?? new XMLSerializer().serializeToString(svgEl)
  const parsed = new DOMParser().parseFromString(base, 'image/svg+xml')
  const root = parsed.documentElement
  root.setAttribute('width', String(settings.width))
  root.setAttribute('height', String(settings.height))
  root.setAttribute('viewBox', `0 0 ${settings.width} ${settings.height}`)
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const declarations = resolveThemeDeclarations(base, settings.theme)
  if (declarations) {
    const style = parsed.createElementNS(svgNamespace, 'style')
    style.textContent = `:root{${declarations}}`
    root.insertBefore(style, root.firstChild)
  }
  // An opaque surface under the figure, so a dark export is not transparent
  // and the Light/Dark setting changes the background the rasteriser keeps.
  const background = parsed.createElementNS(svgNamespace, 'rect')
  background.setAttribute('x', '0')
  background.setAttribute('y', '0')
  background.setAttribute('width', String(settings.width))
  background.setAttribute('height', String(settings.height))
  background.setAttribute('fill', 'var(--surface, #ffffff)')
  root.insertBefore(background, root.firstChild)
  const serialised = new XMLSerializer().serializeToString(root)
  const comment =
    settings.includeProvenance && provenance
      ? `\n<!-- Sheetbase Analysis Studio export\nview: ${provenance.viewName}${provenance.viewId ? ` (${provenance.viewId.slice(0, 8)})` : ''} v${provenance.viewVersion ?? '?'}\nexported by ${provenance.exportedBy} at ${provenance.exportedAt}\nsources: ${provenance.sourceRevisions.map((r) => r.datasetId.slice(0, 8)).join(', ')}\n-->\n`
      : ''
  return `${comment}${serialised}`
}

// --- Dataset listing (shared with the explorer) ---------------------------

export { fetchDatasetSummaries, datasetExplorerDataClient }
