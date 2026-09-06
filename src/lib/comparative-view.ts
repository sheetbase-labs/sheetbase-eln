/**
 * VIEW-03 — Comparative inspection views (grouped time-series and
 * replicate distribution comparison) over canonical Dataset rows.
 *
 * A comparative view is an *inspection* configuration, not a second chart
 * engine: pure shaping functions group already-materialised canonical rows
 * by explicit source field IDs, and `promoteToChartSpec` hands the
 * configuration off into the canonical ChartSpec path (validated by
 * `validateChartSpec`, rendered by the existing chart renderer). No source
 * rows are copied into the config; only stable field IDs travel.
 *
 * Grouping is strictly by explicit field keys — never label-inferred joins.
 * Null group keys collect into a `(missing)` group; null/non-numeric values
 * are excluded from statistics and counted honestly (`nullCount`), mirroring
 * how `materialiseChart` drops non-numeric points instead of binning them
 * as zero.
 */

import { CHART_PALETTE, CHART_SPEC_VERSION } from './chart-spec'
import type { ChartColumn, ChartSpec } from './chart-spec'

export const COMPARATIVE_VIEW_TYPES = ['time_series', 'distribution'] as const
export type ComparativeViewType = (typeof COMPARATIVE_VIEW_TYPES)[number]

/** Version of the comparative-view envelope (no canonical spec module). */
export const COMPARATIVE_VIEW_CONFIG_VERSION = 1 as const

export const COMPARATIVE_VIEW_MISSING_LABEL = '(missing)'

/**
 * Inspection configuration. `datasetId` (+ optional pinned `versionId`) is
 * source identity only; `groupBy`/`facetBy` are explicit Dataset Schema
 * Version field IDs — never labels.
 */
export interface ComparativeViewConfig {
  configVersion: typeof COMPARATIVE_VIEW_CONFIG_VERSION
  datasetId: string
  /** Immutable Dataset Version pinned for frozen evidence (null = live). */
  versionId: string | null
  viewType: ComparativeViewType
  /** Required for `time_series`; unused for `distribution`. */
  timeField: string | null
  /** Measured value field, required for both view types. */
  valueField: string
  /** Explicit grouping fields (≥1). Faceting never infers beyond these. */
  groupBy: string[]
  /** Optional explicit small-multiple field; must not duplicate groupBy. */
  facetBy: string | null
}

export interface ComparativeGroupStats {
  n: number
  min: number
  max: number
  mean: number
  median: number
}

export interface ComparativeGroup {
  /** Deterministic key over the normalised group-by values. */
  key: string
  label: string
  /** Explicit facet value for this group, or null when unfaceted. */
  facet: string | null
  /** Rows in the group (including rows with null values). */
  count: number
  /** Rows excluded from statistics because the value was null/non-numeric. */
  nullCount: number
  /** Numeric values in row order (display shaping only, never analysis). */
  values: number[]
  stats: ComparativeGroupStats | null
}

export interface ShapedComparativeView {
  groups: ComparativeGroup[]
  /** Expected keys with no rows (empty-group handling). */
  emptyGroupKeys: string[]
  totalRows: number
  /** Rows excluded from every statistic because the value was null. */
  droppedNullValues: number
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Validate a comparative-view config. Returns human-readable errors; empty
 * means the config is promotable. Field IDs are checked for shape here —
 * ChartSpec UUID authority stays with `validateChartSpec` on promote.
 */
export function validateComparativeViewConfig(config: unknown): string[] {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return ['config must be an object']
  }
  const errors: string[] = []
  const c = config as Record<string, unknown>
  if (c.configVersion !== COMPARATIVE_VIEW_CONFIG_VERSION) {
    errors.push(
      `config.configVersion must be ${COMPARATIVE_VIEW_CONFIG_VERSION}`,
    )
  }
  if (!isNonEmptyString(c.datasetId)) {
    errors.push('config.datasetId is required')
  }
  if (
    c.versionId !== null &&
    c.versionId !== undefined &&
    !isNonEmptyString(c.versionId)
  ) {
    errors.push('config.versionId must be a stable version ID or null')
  }
  if (
    c.viewType !== 'time_series' &&
    (c.viewType as string) !== 'distribution'
  ) {
    errors.push(
      `config.viewType must be one of ${COMPARATIVE_VIEW_TYPES.join(', ')}`,
    )
  }
  if (c.viewType === 'time_series' && !isNonEmptyString(c.timeField)) {
    errors.push('config.timeField is required for time_series views')
  }
  if (!isNonEmptyString(c.valueField)) {
    errors.push('config.valueField is required')
  }
  if (!Array.isArray(c.groupBy) || c.groupBy.length === 0) {
    errors.push('config.groupBy must list at least one explicit field')
  } else {
    c.groupBy.forEach((field, i) => {
      if (!isNonEmptyString(field)) {
        errors.push(`config.groupBy[${i}] must be an explicit field ID`)
      }
    })
    const seen = new Set<string>()
    for (const field of c.groupBy) {
      if (typeof field === 'string') {
        if (seen.has(field)) errors.push(`config.groupBy duplicates ${field}`)
        seen.add(field)
      }
    }
  }
  if (c.facetBy !== null && c.facetBy !== undefined) {
    if (!isNonEmptyString(c.facetBy)) {
      errors.push('config.facetBy must be an explicit field ID or null')
    } else if (Array.isArray(c.groupBy) && c.groupBy.includes(c.facetBy)) {
      errors.push('config.facetBy must not duplicate a groupBy field')
    }
  }
  return errors
}

/**
 * Coerce a measure to a finite number. Mirrors the ChartSpec materialiser's
 * `toNumber` so inspection statistics never silently diverge from what the
 * promoted chart plots (booleans read as 1/0, numeric strings parse, every
 * other non-numeric reads as null and is counted, never binned as zero).
 */
export function toComparableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  return null
}

/** Deterministic summary over a non-empty numeric sample. */
export function summarizeValues(
  values: number[],
): ComparativeGroupStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median,
  }
}

/** Codepoint-order string sort so group order is environment-independent. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface GroupedRows {
  key: string
  label: string
  rowIndexes: number[]
}

/**
 * Group row indexes strictly by explicit field IDs. Null/undefined keys
 * collect into a `(missing)` part; order is deterministic (codepoint sort).
 * Never infers joins from labels — unknown field IDs simply read as
 * missing on every row.
 */
export function groupRowsByFields(
  rows: Record<string, unknown>[],
  fieldIds: string[],
): GroupedRows[] {
  const groups = new Map<string, { label: string; rowIndexes: number[] }>()
  rows.forEach((row, index) => {
    const parts = fieldIds.map((fieldId) => {
      const v = row[fieldId]
      return v === null || v === undefined ? null : String(v)
    })
    const key = JSON.stringify(parts)
    const label = parts
      .map((part) => (part === null ? COMPARATIVE_VIEW_MISSING_LABEL : part))
      .join(' · ')
    const existing = groups.get(key)
    if (existing) existing.rowIndexes.push(index)
    else groups.set(key, { label, rowIndexes: [index] })
  })
  return [...groups.entries()]
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([key, group]) => ({ key, ...group }))
}

/**
 * Shape canonical rows into comparative groups for inspection. Pure:
 * groups and facets derive only from the explicit `groupBy`/`facetBy`
 * fields of an already-validated config.
 *
 * `expectedKeys` declares groups the scientist expects (e.g. every
 * condition level); expected keys with no rows surface as empty groups and
 * are listed in `emptyGroupKeys` instead of vanishing silently.
 */
export function shapeComparativeView(
  rows: Record<string, unknown>[],
  config: ComparativeViewConfig,
  opts?: { expectedKeys?: Array<{ key: string; label: string }> },
): ShapedComparativeView {
  const grouped = groupRowsByFields(rows, config.groupBy)
  const byKey = new Map(grouped.map((g) => [g.key, g]))
  const expected = opts?.expectedKeys ?? []
  const emptyGroupKeys: string[] = []
  for (const { key } of expected) {
    if (!byKey.has(key)) emptyGroupKeys.push(key)
  }
  const orderedKeys = [
    ...grouped.map((g) => g.key),
    ...emptyGroupKeys.sort(compareKeys),
  ]
  let droppedNullValues = 0
  const groups: ComparativeGroup[] = orderedKeys.map((key) => {
    const group = byKey.get(key)
    const rowIndexes = group?.rowIndexes ?? []
    const label =
      group?.label ?? expected.find((e) => e.key === key)?.label ?? key
    const values: number[] = []
    let nullCount = 0
    let facet: string | null = null
    const facetParts = new Set<string | null>()
    for (const index of rowIndexes) {
      const row = rows[index]
      if (config.facetBy) {
        const raw = row[config.facetBy]
        facetParts.add(raw === null || raw === undefined ? null : String(raw))
      }
      const v = toComparableNumber(row[config.valueField])
      if (v === null) nullCount++
      else values.push(v)
    }
    // A facet labels the group only when every row agrees on it (a missing
    // facet counts as a value: mixing missing and present is mixed, not
    // uniform). Mixed groups report null rather than picking a facet.
    if (config.facetBy) {
      if (facetParts.size === 1) {
        const sole = [...facetParts][0]
        facet = sole ?? COMPARATIVE_VIEW_MISSING_LABEL
      } else {
        facet = null
      }
    }
    droppedNullValues += nullCount
    return {
      key,
      label,
      facet,
      count: rowIndexes.length,
      nullCount,
      values,
      stats: summarizeValues(values),
    }
  })
  return { groups, emptyGroupKeys, totalRows: rows.length, droppedNullValues }
}

function columnLabel(
  columns: ChartColumn[] | undefined,
  fieldId: string,
): string {
  return columns?.find((c) => c.id === fieldId)?.label ?? fieldId
}

/**
 * Promote an inspection config into a canonical ChartSpec — the hand-off.
 * Time-series views become `line` charts (x = time, series = first group
 * field); distribution views become `box` plots (x = null, series = first
 * group field); an explicit facet maps to `fields.facet` in both cases.
 * Throws on an invalid config; the returned spec passes `validateChartSpec`
 * (asserted in tests through the canonical validator, not a parallel one).
 */
export function promoteToChartSpec(
  config: ComparativeViewConfig,
  columns?: ChartColumn[],
): ChartSpec {
  const errors = validateComparativeViewConfig(config)
  if (errors.length > 0) {
    throw new Error(`Invalid comparative view config: ${errors.join('; ')}`)
  }
  const seriesField = config.groupBy[0] ?? null
  const facetField = config.facetBy ?? null
  const yLabel = columnLabel(columns, config.valueField)
  if (config.viewType === 'distribution') {
    const seriesLabel = seriesField ? columnLabel(columns, seriesField) : 'all'
    return {
      specVersion: CHART_SPEC_VERSION,
      type: 'box',
      datasets: [{ datasetId: config.datasetId }],
      fields: {
        x: null,
        y: { fieldId: config.valueField },
        series: seriesField ? { fieldId: seriesField } : null,
        color: null,
        size: null,
        facet: facetField ? { fieldId: facetField } : null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: {
          x: { label: seriesLabel, scale: 'linear' },
          y: { label: yLabel, scale: 'linear' },
        },
        series: [{ identifier: 'all', label: 'all', color: CHART_PALETTE[0] }],
        legend: { visible: true },
      },
      overlays: { errorBars: null },
    }
  }
  const xField = config.timeField as string
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'line',
    datasets: [{ datasetId: config.datasetId }],
    fields: {
      x: { fieldId: xField },
      y: { fieldId: config.valueField },
      series: seriesField ? { fieldId: seriesField } : null,
      color: null,
      size: null,
      facet: facetField ? { fieldId: facetField } : null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: columnLabel(columns, xField), scale: 'linear' },
        y: { label: yLabel, scale: 'linear' },
      },
      series: [{ identifier: 'all', label: 'all', color: CHART_PALETTE[0] }],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }
}
const NUMERIC_TYPES: ReadonlySet<string> = new Set(['decimal', 'integer'])
const GROUPABLE_TYPES: ReadonlySet<string> = new Set([
  'category',
  'text',
  'boolean',
])

/**
 * Build a default inspection config from explicit source columns: the first
 * numeric column measures, the next numeric column carries time, and the
 * first categorical column groups. Returns null when the source has no
 * numeric measure or no explicit grouping field (nothing comparative to
 * inspect, and an empty groupBy is never promotable).
 */
export function buildDefaultComparativeViewConfig(source: {
  datasetId: string
  versionId?: string | null
  columns: Array<{ id: string; logicalType: string }>
}): ComparativeViewConfig | null {
  const numerics = source.columns.filter((c) =>
    NUMERIC_TYPES.has(c.logicalType),
  )
  const groupable = source.columns.find((c) =>
    GROUPABLE_TYPES.has(c.logicalType),
  )
  if (numerics.length === 0 || !groupable) return null
  const valueField = numerics[0].id
  const timeField =
    numerics.find((c) => c.id !== valueField)?.id ?? numerics[0].id
  return {
    configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
    datasetId: source.datasetId,
    versionId: source.versionId ?? null,
    viewType: 'time_series',
    timeField,
    valueField,
    groupBy: [groupable.id],
    facetBy: null,
  }
}
