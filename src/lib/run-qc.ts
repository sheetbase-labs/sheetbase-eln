/**
 * Run quality control: a value tracked across runs, with its limits and the
 * Westgard rules that judge each new point (migration
 * 20261107011617_instrument_data_and_run_qc).
 *
 * Reads go straight to the tables under row-level security. Every change goes
 * through an RPC, and the rules are judged in the database, so a point sent in
 * by a pipeline, the API or a plate analysis is judged the same way. This
 * module only fetches, calls and lays a chart out.
 */
import type { DataClient } from '#/lib/data-client'

export const QC_RULES = ['1-3s', '2-2s', 'R-4s', '4-1s', '10x'] as const
export type QcRule = (typeof QC_RULES)[number]

export const QC_METRICS = [
  'z_prime',
  'signal_to_background',
  'positive_mean',
  'negative_mean',
  'blank_mean',
  'positive_cv',
  'negative_cv',
] as const
export type QcMetric = (typeof QC_METRICS)[number]

export interface QcSeriesRow {
  id: string
  name: string
  source_kind: 'plate_metric' | 'manual'
  design_id: string | null
  metric: QcMetric | null
  instrument_id: string | null
  unit: string | null
  mean: number | null
  sd: number | null
  baseline_n: number | null
  baseline_from: string | null
  baseline_to: string | null
  rules: QcRule[]
  enabled: boolean
  state: 'in_control' | 'out_of_control'
  state_changed_at: string
  created_by_user_id: string | null
  created_at: string
}

export interface QcPointRow {
  id: string
  series_id: string
  plate_run_id: string | null
  instrument_run_id: string | null
  value: number
  at: string
  label: string | null
  z: number | null
  violations: QcRule[]
  excluded: boolean
  acknowledged_at: string | null
  acknowledged_by_user_id: string | null
  note: string | null
}

export const qcKeys = {
  all: ['run-qc'] as const,
  series: (scope: string) => ['run-qc', 'series', scope] as const,
  points: (seriesId: string) => ['run-qc', 'points', seriesId] as const,
  designs: ['run-qc', 'designs'] as const,
}

const SERIES_COLUMNS =
  'id,name,source_kind,design_id,metric,instrument_id,unit,mean,sd,baseline_n,baseline_from,baseline_to,rules,enabled,state,state_changed_at,created_by_user_id,created_at'
const POINT_COLUMNS =
  'id,series_id,plate_run_id,instrument_run_id,value,at,label,z,violations,excluded,acknowledged_at,acknowledged_by_user_id,note'

/** The most points one chart draws: the newest, oldest first. */
export const QC_POINT_LIMIT = 300

export interface QcScope {
  instrumentId?: string
  designId?: string
}

export function scopeKey(scope: QcScope): string {
  return `${scope.instrumentId ?? ''}|${scope.designId ?? ''}`
}

export function fetchQcSeries(
  client: DataClient,
  scope: QcScope = {},
): Promise<QcSeriesRow[]> {
  const filter = [
    scope.instrumentId
      ? `&instrument_id=eq.${encodeURIComponent(scope.instrumentId)}`
      : '',
    scope.designId ? `&design_id=eq.${encodeURIComponent(scope.designId)}` : '',
  ].join('')
  return client.list<QcSeriesRow>(
    'qc_series',
    `?select=${SERIES_COLUMNS}${filter}&order=state.desc,name.asc&limit=500`,
  )
}

export async function fetchQcPoints(
  client: DataClient,
  seriesId: string,
): Promise<QcPointRow[]> {
  const rows = await client.list<QcPointRow>(
    'qc_points',
    `?select=${POINT_COLUMNS}&series_id=eq.${encodeURIComponent(seriesId)}&order=at.desc,id.desc&limit=${QC_POINT_LIMIT}`,
  )
  return rows.reverse()
}

export interface PlateDesignOption {
  id: string
  name: string
}

export function fetchPlateDesignOptions(
  client: DataClient,
): Promise<PlateDesignOption[]> {
  return client.list<PlateDesignOption>(
    'plate_designs',
    '?select=id,name&order=name.asc&limit=500',
  )
}

export function createQcSeries(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    metric?: QcMetric | null
    designId?: string | null
    instrumentId?: string | null
    unit?: string | null
    mean?: number | null
    sd?: number | null
  },
): Promise<QcSeriesRow> {
  return client.rpc<QcSeriesRow>('create_qc_series', {
    p_workspace_id: input.workspaceId,
    p_name: input.name.trim(),
    p_source_kind: input.designId ? 'plate_metric' : 'manual',
    p_metric: input.designId ? (input.metric ?? 'z_prime') : null,
    p_design_id: input.designId ?? null,
    p_instrument_id: input.instrumentId ?? null,
    p_unit: input.unit?.trim() || null,
    p_mean: input.mean ?? null,
    p_sd: input.sd ?? null,
  })
}

export function trackPlateAssayQc(
  client: DataClient,
  designId: string,
  instrumentId: string | null,
): Promise<QcSeriesRow[]> {
  return client.rpc<QcSeriesRow[]>('track_plate_assay_qc', {
    p_design_id: designId,
    p_instrument_id: instrumentId,
  })
}

export function setQcBaseline(
  client: DataClient,
  seriesId: string,
  limits: { mean: number; sd: number } | { firstN: number },
): Promise<QcSeriesRow> {
  return client.rpc<QcSeriesRow>('set_qc_baseline', {
    p_series_id: seriesId,
    p_mean: 'mean' in limits ? limits.mean : null,
    p_sd: 'sd' in limits ? limits.sd : null,
    p_first_n: 'firstN' in limits ? limits.firstN : null,
  })
}

export function updateQcSeries(
  client: DataClient,
  seriesId: string,
  patch: { name?: string; rules?: QcRule[]; enabled?: boolean },
): Promise<QcSeriesRow> {
  return client.rpc<QcSeriesRow>('update_qc_series', {
    p_series_id: seriesId,
    p_name: patch.name ?? null,
    p_rules: patch.rules ?? null,
    p_enabled: patch.enabled ?? null,
  })
}

export function deleteQcSeries(
  client: DataClient,
  seriesId: string,
): Promise<void> {
  return client.rpc<void>('delete_qc_series', { p_series_id: seriesId })
}

export function recordQcPoint(
  client: DataClient,
  input: { seriesId: string; value: number; label?: string | null },
): Promise<QcPointRow> {
  return client.rpc<QcPointRow>('record_qc_point', {
    p_series_id: input.seriesId,
    p_value: input.value,
    p_at: null,
    p_label: input.label?.trim() || null,
    p_instrument_run_id: null,
  })
}

export function acknowledgeQcPoint(
  client: DataClient,
  input: { pointId: string; note: string; exclude: boolean },
): Promise<QcPointRow> {
  return client.rpc<QcPointRow>('acknowledge_qc_point', {
    p_point_id: input.pointId,
    p_note: input.note.trim() || null,
    p_exclude: input.exclude,
  })
}

// ---------------------------------------------------------------------------
// Chart layout
// ---------------------------------------------------------------------------

/** How far a point sits from the limits, in the words the chart colours by. */
export type QcZone = 'centre' | 'warn' | 'out' | 'none'

export function zoneOf(point: Pick<QcPointRow, 'z' | 'violations'>): QcZone {
  if (point.z === null) return 'none'
  if (point.violations.length > 0) return 'out'
  return Math.abs(point.z) > 2 ? 'warn' : 'centre'
}

export interface QcChartLayout {
  /** Value range drawn, with a little room beyond the ±3 SD lines. */
  lo: number
  hi: number
  ticks: number[]
}

/** The value range a chart needs: the ±3 SD lines when there are limits, else the data. */
export function chartRange(
  series: Pick<QcSeriesRow, 'mean' | 'sd'>,
  points: readonly Pick<QcPointRow, 'value' | 'excluded'>[],
): QcChartLayout {
  const values = points.map((p) => p.value)
  let lo = values.length ? Math.min(...values) : 0
  let hi = values.length ? Math.max(...values) : 1
  if (series.mean !== null && series.sd !== null && series.sd > 0) {
    lo = Math.min(lo, series.mean - 3 * series.sd)
    hi = Math.max(hi, series.mean + 3 * series.sd)
  }
  if (hi === lo) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.06
  lo -= pad
  hi += pad
  const ticks =
    series.mean !== null && series.sd !== null && series.sd > 0
      ? [-3, -2, -1, 0, 1, 2, 3].map((k) => series.mean! + k * series.sd!)
      : [lo, (lo + hi) / 2, hi]
  return { lo, hi, ticks }
}

/** Points that broke a rule and have not been looked at. */
export function openBreaches(points: readonly QcPointRow[]): QcPointRow[] {
  return points.filter(
    (p) => p.violations.length > 0 && p.acknowledged_at === null && !p.excluded,
  )
}

/** The metric of a plate series in the words a scientist uses is in the copy catalogue. */
export function qcMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
