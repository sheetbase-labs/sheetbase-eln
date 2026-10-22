/**
 * SCI data layer — bridges ChartSpec / analysis definitions to canonical
 * Datasets (decision 0037).
 *
 * Every read goes through CORE-02 RPCs over the same-origin `/api/db`
 * boundary: `query_dataset_rows` for live rows and
 * `query_dataset_version_rows` for immutable Version evidence. Rows come
 * back keyed by stable Dataset Schema Version `field_id`, so runtime row
 * keys are exactly the `ChartColumn.id` values specs bind to. No generated
 * physical resource and no legacy scientific-table surface is consulted.
 *
 * Client-side analysis reads up to SCI_ANALYSIS_ROW_LIMIT rows. Display
 * sampling (`SCI_RENDER_POINT_CAP`) is applied after statistics. Above the
 * analysis limit the chart reports `dataset_too_large`.
 *
 * Lifecycle helpers (`freezeChart`, `unfreezeChart`) are thin typed
 * wrappers around the transactional SECURITY DEFINER RPCs. Binding frozen
 * evidence to submitted revisions happens server-side inside submission,
 * not through client calls.
 */
import { useQuery } from '@tanstack/react-query'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { queryDatasetVersionRows } from './dataset-product'
import type { DatasetVersionWire } from './dataset-product'
import { toBlock } from './notebook-data'
import type { BlockWire, NotebookBlock } from './notebook-data'
import {
  chartSpecReferencedFieldIds,
  chartUnitSymbol,
  materialiseChart,
  materialiseFacetedCharts,
} from './chart-spec'
import { CHART_ROW_ID_KEY } from './visualisation-pipeline'
import { fetchActiveDatasetFlags, filterRowsByFlags } from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'
import type {
  ChartColumn,
  ChartSpec,
  DatasetRef,
  FacetedChart,
  FrozenChart,
  MaterialisedChart,
} from './chart-spec'

/** Maximum rows fetched for live/frozen analysis. Display may sample. */
export const SCI_ANALYSIS_ROW_LIMIT = 100_000

/** query_dataset_rows / query_dataset_version_rows accept ≤1000 per call. */
const ROW_PAGE_SIZE = 1000

export const sciDataClient = createDataClient()

export const chartQueryKeys = {
  dataset: (datasetId: string) => ['sci-dataset', datasetId] as const,
  versionRows: (datasetVersionId: string) =>
    ['sci-dataset-version-rows', datasetVersionId] as const,
}

interface DatasetResourceWire {
  id: string
  workspace_id: string
  schema_version_id: string
  name: string
  lifecycle: 'active' | 'archived'
  revision: number | string
}

interface SchemaVersionNumberWire {
  id: string
  version: number
}

interface DatasetVersionFieldWire {
  field_id: string
  label: string
  logical_type: string
  quantity: unknown
}

/** A canonical Dataset resolved to chart-ready column metadata. */
export interface CanonicalDatasetSource {
  datasetId: string
  name: string
  workspaceId: string
  /** UUID of the Dataset Schema Version the dataset currently pins. */
  schemaVersionId: string
  schemaVersionNumber: number
  revision: number
  columns: ChartColumn[]
}
/**
 * Adapt an explorer-style canonical dataset wire (columns already keyed by
 * field_id) into the source shape SCI components consume.
 */
export function toCanonicalDatasetSource(dataset: {
  id: string
  name?: string
  workspace_id?: string
  schema_version_id?: string
  schema_version_number?: number | null
  schema_version?: number
  revision?: number | string
  columns: Array<{
    id: string
    label: string
    logical_type: string
    unit?: unknown
  }>
}): CanonicalDatasetSource {
  return {
    datasetId: dataset.id,
    name: dataset.name ?? dataset.id,
    workspaceId: dataset.workspace_id ?? '',
    schemaVersionId: dataset.schema_version_id ?? '',
    schemaVersionNumber:
      dataset.schema_version_number ?? dataset.schema_version ?? 1,
    revision: Number(dataset.revision),
    columns: dataset.columns.map((c) => ({
      id: c.id,
      label: c.label,
      logicalType: c.logical_type,
      unit: c.unit,
    })),
  }
}
export interface ResolvedDataset {
  source: CanonicalDatasetSource
  rows: Record<string, unknown>[]
  /** True when totalCount exceeded SCI_ANALYSIS_ROW_LIMIT and rows were cut. */
  truncated: boolean
  totalCount: number
  /** DSET-01.2 — active value flags; flagged values are excluded by default. */
  flags?: DatasetValueFlag[]
}

/**
 * Resolve one canonical Dataset plus its pinned schema-version fields.
 * Returns null when the dataset does not exist or is archived so callers
 * can surface a missing-dataset state.
 */
export async function fetchCanonicalDataset(
  client: DataClient,
  datasetId: string,
  datasetVersionId?: string,
): Promise<CanonicalDatasetSource | null> {
  const datasets = await client.list<DatasetResourceWire>(
    'datasets',
    `?id=eq.${encodeURIComponent(datasetId)}${datasetVersionId ? '' : '&lifecycle=eq.active'}&limit=1`,
  )
  const dataset = datasets.at(0)
  if (!dataset) return null
  if (datasetVersionId) {
    const versions = await client.list<DatasetVersionWire>(
      'dataset_versions',
      `?id=eq.${encodeURIComponent(datasetVersionId)}&dataset_id=eq.${encodeURIComponent(datasetId)}&limit=1`,
    )
    const version = versions.at(0)
    if (!version || version.dataset_id !== datasetId) return null
    dataset.schema_version_id = version.schema_version_id
    dataset.revision = version.source_dataset_revision
  }
  const [fields, versions] = await Promise.all([
    client.list<DatasetVersionFieldWire>(
      'dataset_schema_version_fields',
      `?schema_version_id=eq.${encodeURIComponent(dataset.schema_version_id)}&lifecycle=eq.active&order=display_order.asc`,
    ),
    client.list<SchemaVersionNumberWire>(
      'dataset_schema_versions',
      `?id=eq.${encodeURIComponent(dataset.schema_version_id)}&select=id,version&limit=1`,
    ),
  ])
  const pinnedSchemaVersion = versions.find(
    (v) => v.id === dataset.schema_version_id,
  )
  return {
    datasetId: dataset.id,
    name: dataset.name,
    workspaceId: dataset.workspace_id,
    schemaVersionId: dataset.schema_version_id,
    schemaVersionNumber:
      pinnedSchemaVersion === undefined ? 1 : pinnedSchemaVersion.version,
    revision: Number(dataset.revision),
    columns: fields.map((f) => ({
      id: f.field_id,
      label: f.label,
      logicalType: f.logical_type,
      unit: f.quantity,
    })),
  }
}

/** Fetch every page of live rows up to the hard client-side ceiling. */
async function fetchRowsPaged(
  fetchPage: (
    limit: number,
    offset: number,
  ) => Promise<{
    rows: Record<string, unknown>[]
    totalCount: number
  }>,
): Promise<{
  rows: Record<string, unknown>[]
  totalCount: number
  truncated: boolean
}> {
  const first = await fetchPage(ROW_PAGE_SIZE, 0)
  const totalCount = first.totalCount
  const rows = [...first.rows]
  let offset = rows.length
  while (offset < Math.min(totalCount, SCI_ANALYSIS_ROW_LIMIT)) {
    const page = await fetchPage(
      Math.min(ROW_PAGE_SIZE, SCI_ANALYSIS_ROW_LIMIT - offset),
      offset,
    )
    if (page.rows.length === 0 || page.totalCount !== totalCount)
      throw new Error('Dataset changed while paging; reload before analysing')
    rows.push(...page.rows)
    offset = rows.length
  }
  return { rows, totalCount, truncated: totalCount > SCI_ANALYSIS_ROW_LIMIT }
}

/**
 * Fetch a canonical Dataset's live rows (fieldId-keyed) up to
 * SCI_ANALYSIS_ROW_LIMIT. Shared by chart and analysis surfaces.
 */
export async function fetchDatasetRows(
  client: DataClient,
  datasetId: string,
): Promise<{
  rows: Record<string, unknown>[]
  totalCount: number
  truncated: boolean
}> {
  return fetchRowsPaged((limit, offset) =>
    client
      .rpc<{
        rows: Array<{
          rowId: string
          revision: number
          values: Record<string, unknown>
        }>
        totalCount: number
      }>('query_dataset_rows', {
        p_dataset_id: datasetId,
        p_query: {},
        p_limit: limit,
        p_offset: offset,
      })
      .then((result) => ({
        rows: result.rows.map((row) => ({
          ...row.values,
          [CHART_ROW_ID_KEY]: row.rowId,
        })),
        totalCount: result.totalCount,
      })),
  )
}

/**
 * Resolve a spec's referenced dataset. The spec supports a single dataset;
 * only the first `datasetId` is resolved. Returns null when the spec has no
 * dataset yet so the caller can surface a missing-dataset state.
 */
export async function resolveChartDataset(
  client: DataClient,
  spec: ChartSpec | null | undefined,
): Promise<ResolvedDataset | null> {
  if (!spec || spec.datasets.length === 0) return null
  return resolveDatasetRef(client, spec.datasets[0])
}

/**
 * The rows a Dataset reference names: the live rows, or the frozen rows of the
 * snapshot when it pins a Dataset Version. Snapshot columns come from that
 * Version's schema. The existing snapshot exploration policy includes all
 * values, not current live flags; freeze records this policy explicitly.
 */
export async function resolveDatasetRef(
  client: DataClient,
  ref: DatasetRef,
): Promise<ResolvedDataset | null> {
  const source = await fetchCanonicalDataset(
    client,
    ref.datasetId,
    ref.datasetVersionId,
  )
  if (!source) return null
  if (ref.datasetVersionId) {
    const paged = await fetchDatasetVersionRows(client, ref.datasetVersionId)
    return { source, ...paged, flags: [] }
  }
  const [paged, flags] = await Promise.all([
    fetchDatasetRows(client, source.datasetId),
    fetchActiveDatasetFlags(client, source.datasetId),
  ])
  return { source, ...paged, flags }
}

/** A snapshot's rows (fieldId-keyed) up to SCI_ANALYSIS_ROW_LIMIT. */
export async function fetchDatasetVersionRows(
  client: DataClient,
  datasetVersionId: string,
): Promise<{
  rows: Record<string, unknown>[]
  totalCount: number
  truncated: boolean
}> {
  return fetchRowsPaged((limit, offset) =>
    queryDatasetVersionRows(client, datasetVersionId, limit, offset).then(
      (page) => ({
        rows: page.rows.map((row) => ({
          ...row.values,
          [CHART_ROW_ID_KEY]: row.rowId,
        })),
        totalCount: page.totalCount,
      }),
    ),
  )
}

/**
 * The field ids a spec binds. A flagged value in any of them excludes the row
 * from the chart (DSET-01.2), so every materialisation path shares this list
 * rather than re-deriving it.
 */
export function chartUsedFieldIds(spec: ChartSpec): string[] {
  return [
    ...new Set([
      ...Object.values(spec.fields).flatMap((binding) =>
        binding ? [binding.fieldId] : [],
      ),
      ...chartSpecReferencedFieldIds(spec),
    ]),
  ]
}

/**
 * Materialise a live chart from a spec + resolved canonical dataset.
 * Surfaces `missing_dataset`, `missing_field`, `empty_dataset`,
 * `log_scale_invalid` and `dataset_too_large` states honestly instead of
 * plotting.
 */
export function materialiseLiveChart(
  spec: ChartSpec,
  dataset: ResolvedDataset | null,
): MaterialisedChart {
  if (!dataset) {
    return {
      state: { kind: 'missing_dataset' },
      columns: [],
      rows: [],
      series: [],
      xLabel: spec.display.axes.x.label ?? 'x',
      yLabel: spec.display.axes.y.label ?? 'y',
      xUnit: spec.display.axes.x.unit,
      yUnit: spec.display.axes.y.unit,
      droppedPoints: 0,
    }
  }
  if (dataset.truncated) {
    return {
      state: {
        kind: 'dataset_too_large',
        rowCount: dataset.totalCount,
        limit: SCI_ANALYSIS_ROW_LIMIT,
      },
      columns: [],
      rows: [],
      series: [],
      xLabel: spec.display.axes.x.label ?? 'x',
      yLabel: spec.display.axes.y.label ?? 'y',
      xUnit: spec.display.axes.x.unit,
      yUnit: spec.display.axes.y.unit,
      droppedPoints: 0,
    }
  }
  // DSET-01.2 — exclude a row when any field the chart uses is flagged.
  const rows = filterRowsByFlags(
    dataset.rows,
    dataset.flags ?? [],
    chartUsedFieldIds(spec),
  )
  return materialiseChart(spec, dataset.source.columns, rows)
}

/**
 * Materialise a frozen chart. Legacy snapshots (no Dataset Version) replay
 * stored series. SCI-04 evidence rematerialises from pinned Version rows
 * through the same `materialiseChart` pipeline as live rendering.
 */
export function materialiseFrozenChart(frozen: FrozenChart): MaterialisedChart {
  const columns: ChartColumn[] = frozen.data.columns.map((c) => ({
    id: c.fieldId,
    label: c.label,
    logicalType: c.logicalType,
    unit: c.unit,
  }))
  const series = frozen.data.series.map((s) => ({
    identifier: s.identifier,
    label: s.label,
    color: s.color,
    points: s.points,
  }))
  return {
    state: { kind: 'ok' },
    columns,
    rows: frozen.data.rows,
    series,
    droppedPoints: series.reduce(
      (acc, s) => acc + s.points.filter((p) => p.y === null).length,
      0,
    ),
    xLabel: columns[0]?.label ?? 'x',
    yLabel: columns[1]?.label ?? 'y',
    xUnit: chartUnitSymbol(columns[0]?.unit),
    yUnit: chartUnitSymbol(columns[1]?.unit),
  }
}

export function frozenPinsDatasetVersion(frozen: FrozenChart): string | null {
  const versionId = frozen.datasetProvenance[0]?.datasetVersionId
  return typeof versionId === 'string' && versionId.length > 0
    ? versionId
    : null
}

export function reconstructFrozenVisualisation(input: {
  spec: ChartSpec
  frozen: FrozenChart
  rows: Record<string, unknown>[]
  flags?: DatasetValueFlag[]
}): {
  chart: MaterialisedChart
  facets: { panels: FacetedChart[]; total: number } | null
} {
  const columns: ChartColumn[] = input.frozen.data.columns.map((column) => ({
    id: column.fieldId,
    label: column.label,
    logicalType: column.logicalType,
    unit: column.unit,
  }))
  const rows = filterRowsByFlags(
    input.rows,
    input.flags ?? [],
    chartUsedFieldIds(input.spec),
  )
  const chart = materialiseChart(input.spec, columns, rows)
  if (!input.spec.fields.facet) return { chart, facets: null }
  const facets = materialiseFacetedCharts(input.spec, columns, rows)
  return { chart, facets }
}

/**
 * Build the facet panels for a frozen faceted chart from its pinned series.
 * Returns null when the snapshot is not faceted; the base materialisation
 * supplies shared labels/columns so each panel renders like the live one.
 */
export function materialiseFrozenFacets(
  frozen: FrozenChart,
): { panels: FacetedChart[]; total: number } | null {
  const facets = frozen.data.facets
  if (!facets || facets.length === 0) return null
  const base = materialiseFrozenChart(frozen)
  return {
    total: frozen.data.facetsTotal ?? facets.length,
    panels: facets.map((facet) => ({
      value: facet.value,
      chart: { ...base, series: facet.series },
    })),
  }
}

/**
 * Fetch the pinned input rows of a frozen analysis from its immutable
 * Dataset Version, verifying the pinned row count. Throws when the Version
 * outgrew the client ceiling — frozen reconstruction then reports an honest
 * failure rather than partial statistics.
 */
export async function fetchFrozenAnalysisRows(
  client: DataClient,
  datasetVersionId: string,
  expectedRowCount: number,
  exclusionPolicy?: 'include_flagged' | 'exclude_bound_fields',
): Promise<{
  rows: Record<string, unknown>[]
  totalCount: number
  matchesProvenance: boolean
  flags: DatasetValueFlag[]
}> {
  if (expectedRowCount > SCI_ANALYSIS_ROW_LIMIT) {
    throw new Error(
      `Dataset Version holds ${expectedRowCount} rows, above the ${SCI_ANALYSIS_ROW_LIMIT}-row reconstruction ceiling`,
    )
  }
  const paged = await fetchRowsPaged((limit, offset) =>
    queryDatasetVersionRows(client, datasetVersionId, limit, offset).then(
      (page) => ({
        rows: page.rows.map((row) => ({
          ...row.values,
          [CHART_ROW_ID_KEY]: row.rowId,
        })),
        totalCount: page.totalCount,
      }),
    ),
  )
  return {
    rows: paged.rows,
    totalCount: paged.totalCount,
    flags:
      exclusionPolicy === 'exclude_bound_fields'
        ? await client.rpc<DatasetValueFlag[]>(
            'analysis_dataset_version_flags',
            {
              p_dataset_version_id: datasetVersionId,
            },
          )
        : [],
    matchesProvenance:
      !paged.truncated && paged.totalCount === expectedRowCount,
  }
}

/**
 * React hook that resolves a live chart's canonical dataset and returns the
 * materialised result. Frozen charts should use `materialiseFrozenChart`
 * directly (no live re-read). Enabled only when a spec references a dataset.
 */
export function useLiveChartDataset(spec: ChartSpec | null | undefined) {
  const datasetId = spec?.datasets[0]?.datasetId ?? ''
  const datasetVersionId = spec?.datasets[0]?.datasetVersionId ?? null
  const datasetQuery = useQuery({
    queryKey: [
      chartQueryKeys.dataset(datasetId),
      spec?.filters.length ?? 0,
      datasetVersionId,
    ],
    queryFn: () => resolveChartDataset(sciDataClient, spec),
    enabled: Boolean(datasetId),
  })
  return { datasetQuery }
}

export function useFrozenPinnedRows(frozen: FrozenChart | null) {
  const versionId = frozen ? frozenPinsDatasetVersion(frozen) : null
  const expected = frozen?.datasetProvenance[0]?.rowCount ?? 0
  const query = useQuery({
    queryKey: [
      ...chartQueryKeys.versionRows(versionId ?? ''),
      expected,
      frozen?.exclusionPolicy,
    ],
    queryFn: () =>
      fetchFrozenAnalysisRows(
        sciDataClient,
        versionId!,
        expected,
        frozen?.exclusionPolicy,
      ),
    enabled: Boolean(versionId),
  })
  return query
}

// ---------------------------------------------------------------------------
// Lifecycle RPCs — transactional SECURITY DEFINER functions. Each returns
// the updated block so the caller can reconcile; the route bumps the cache.
// ---------------------------------------------------------------------------

export interface FreezeChartArgs {
  blockId: string
  expectedVersion: number
}

export async function freezeChart(
  client: DataClient,
  args: FreezeChartArgs,
): Promise<NotebookBlock> {
  const row = await client.rpc<BlockWire>('freeze_chart', {
    p_block_id: args.blockId,
    p_expected_version: args.expectedVersion,
  })
  return toBlock(row)
}

export interface UnfreezeChartArgs {
  blockId: string
  expectedVersion: number
}

export async function unfreezeChart(
  client: DataClient,
  args: UnfreezeChartArgs,
): Promise<NotebookBlock> {
  const row = await client.rpc<BlockWire>('unfreeze_chart', {
    p_block_id: args.blockId,
    p_expected_version: args.expectedVersion,
  })
  return toBlock(row)
}
