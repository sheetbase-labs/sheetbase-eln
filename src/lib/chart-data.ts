/**
 * SCI-004 — Chart dataset resolver and lifecycle helpers (decision 0029).
 *
 * Bridges a `ChartSpec` to the stable scientific-table dataset it references:
 * fetches the table metadata + rows through the same `scientific-sheet-data`
 * client the sheet block uses, materialises the series via the pure
 * `materialiseChart` in `chart-spec`, and detects stale HyperFormula
 * calculations so a live chart never silently plots stale numbers.
 *
 * Frozen charts skip resolution: their `FrozenChart.data` is the
 * authoritative materialised snapshot, so `materialiseFrozenChart` returns
 * it directly with state `ok`.
 *
 * Lifecycle helpers (`freezeChart`, `unfreezeChart`, `bindChartRevision`)
 * are thin typed wrappers around the transactional SECURITY DEFINER RPCs so
 * the UI and REST paths share one mutation surface and durable event/audit
 * attribution stays canonical.
 */
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import {
  scientificDataClient,
  fetchAllScientificRows,
  fetchScientificCalculationResults,
  fetchScientificTable,
  scientificQueryKeys,
} from '#/lib/scientific-sheet-data'
import type {
  FormulaResultWire,
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import { toBlock } from '#/lib/notebook-data'
import type { BlockWire, NotebookBlock } from '#/lib/notebook-data'
import { materialiseChart } from '#/lib/chart-spec'
import type {
  ChartColumn,
  ChartSpec,
  FrozenChart,
  MaterialisedChart,
} from '#/lib/chart-spec'

export const chartQueryKeys = {
  dataset: (tableId: string) => ['chart-dataset', tableId] as const,
  calcResults: (tableId: string) => ['chart-calc-results', tableId] as const,
}

export interface ResolvedDataset {
  table: ScientificTableWire
  columns: ScientificColumnWire[]
  rows: ScientificRowWire[]
}

/**
 * Resolve a chart's referenced dataset. The spec currently supports a
 * single dataset (the array is forward-compatible); only the first
 * `tableId` is resolved. Returns null when the spec has no dataset yet so
 * the caller can surface a missing-dataset state.
 */
export async function resolveChartDataset(
  client: DataClient,
  spec: ChartSpec | null | undefined,
): Promise<ResolvedDataset | null> {
  if (!spec || spec.datasets.length === 0) return null
  const tableId = spec.datasets[0].tableId
  const table = await fetchScientificTable(client, tableId)
  if (!table) return null
  const rows = await fetchAllScientificRows(client, table)
  return { table, columns: table.columns, rows }
}

function toChartColumns(columns: ScientificColumnWire[]): ChartColumn[] {
  return columns.map((c) => ({
    id: c.id,
    fieldName: c.field_name,
    label: c.label,
    logicalType: c.logical_type,
    unit: c.unit,
  }))
}

/**
 * Detect whether any HyperFormula calculation result for the chart's
 * dataset is stale (or pending/failed/unavailable) for the columns the
 * chart plots. A live chart must not silently plot stale numbers; the
 * caller surfaces a `stale` state instead.
 */
export function detectStaleCalculations(
  results: FormulaResultWire[],
  spec: ChartSpec,
): { stale: boolean; detail: string } {
  if (results.length === 0) return { stale: false, detail: '' }
  const plottedColumnIds = new Set<string>()
  const collect = (binding: { columnId: string } | null) => {
    if (binding) plottedColumnIds.add(binding.columnId)
  }
  collect(spec.fields.x)
  collect(spec.fields.y)
  collect(spec.fields.series)
  if (spec.overlays.errorBars) collect(spec.overlays.errorBars)
  const bad = results.filter(
    (r) =>
      plottedColumnIds.has(r.target_column_id) &&
      r.calculation_status !== 'current',
  )
  if (bad.length === 0) return { stale: false, detail: '' }
  const detail =
    bad[0].calculation_status === 'stale'
      ? 'A plotted formula is stale. Recalculate the dataset before relying on this chart.'
      : `A plotted formula is ${bad[0].calculation_status}.`
  return { stale: true, detail }
}

/**
 * Materialise a live chart from a spec + resolved dataset + calculation
 * results. Surfaces `missing_dataset`, `missing_field`, `empty_dataset`,
 * `log_scale_invalid` and `stale` states honestly instead of plotting.
 */
export function materialiseLiveChart(
  spec: ChartSpec,
  dataset: ResolvedDataset | null,
  calcResults: FormulaResultWire[] | null,
): MaterialisedChart {
  if (!dataset) {
    return {
      state: { kind: 'missing_dataset' },
      columns: [],
      rows: [],
      series: [],
      xLabel: spec.display.axes.x.label ?? spec.fields.x?.fieldName ?? 'x',
      yLabel: spec.display.axes.y.label ?? spec.fields.y.fieldName,
      xUnit: spec.display.axes.x.unit,
      yUnit: spec.display.axes.y.unit,
    }
  }
  const columns = toChartColumns(dataset.columns)
  const materialised = materialiseChart(spec, columns, dataset.rows)
  if (calcResults && calcResults.length > 0) {
    const { stale, detail } = detectStaleCalculations(calcResults, spec)
    if (stale && materialised.state.kind === 'ok') {
      return { ...materialised, state: { kind: 'stale', detail } }
    }
  }
  return materialised
}

/**
 * Materialise a frozen chart from its immutable snapshot. The frozen data
 * is authoritative; no live resolution or stale detection applies.
 */
export function materialiseFrozenChart(frozen: FrozenChart): MaterialisedChart {
  const columns: ChartColumn[] = frozen.data.columns.map((c) => ({
    id: c.columnId,
    fieldName: c.fieldName,
    label: c.label,
    logicalType: c.logicalType,
    unit: c.unit,
  }))
  return {
    state: { kind: 'ok' },
    columns,
    rows: frozen.data.rows,
    series: frozen.data.series.map((s) => ({
      identifier: s.identifier,
      label: s.label,
      color: s.color,
      points: s.points,
    })),
    xLabel: columns[0]?.label ?? 'x',
    yLabel: columns[1]?.label ?? 'y',
    xUnit:
      typeof columns[0]?.unit === 'object' &&
      columns[0]?.unit &&
      'symbol' in columns[0].unit
        ? String((columns[0].unit as { symbol: string }).symbol)
        : undefined,
    yUnit:
      typeof columns[1]?.unit === 'object' &&
      columns[1]?.unit &&
      'symbol' in columns[1].unit
        ? String((columns[1].unit as { symbol: string }).symbol)
        : undefined,
  }
}

/**
 * React hook that resolves a live chart's dataset and calculation results
 * and returns the materialised chart. Frozen charts should use
 * `materialiseFrozenChart` directly (no live re-read). The hook is enabled
 * only when a spec with at least one dataset exists.
 */
export function useLiveChartDataset(spec: ChartSpec | null | undefined) {
  const tableId = spec?.datasets[0]?.tableId ?? ''
  const datasetQuery = useQuery({
    queryKey: chartQueryKeys.dataset(tableId),
    queryFn: () => resolveChartDataset(scientificDataClient, spec),
    enabled: Boolean(tableId),
    staleTime: 0,
  })
  const calcQuery = useQuery({
    queryKey: chartQueryKeys.calcResults(tableId),
    queryFn: () =>
      fetchScientificCalculationResults(scientificDataClient, tableId),
    enabled: Boolean(tableId),
    staleTime: 0,
  })
  return { datasetQuery, calcQuery }
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

export interface BindChartRevisionArgs {
  blockId: string
  revisionId: string
  expectedVersion: number
}

export async function bindChartRevision(
  client: DataClient,
  args: BindChartRevisionArgs,
): Promise<NotebookBlock> {
  const row = await client.rpc<BlockWire>('bind_chart_revision', {
    p_block_id: args.blockId,
    p_revision_id: args.revisionId,
    p_expected_version: args.expectedVersion,
  })
  return toBlock(row)
}

export { scientificQueryKeys }
