/**
 * SCI-04 visualisation pipeline: filters, transforms, summaries, error
 * bars, sampling and point provenance. Pure TypeScript. Never mutates the
 * source Dataset.
 *
 * Transforms here are a bounded visualisation set. They are not a second
 * formula engine; HyperFormula remains the Sheet calculation mechanism.
 */

import {
  fitQuality,
  linearMeanConfidenceBand,
  meanConfidenceInterval,
  olsFit,
  polyEval,
  summaryStats,
} from './stats'
import type { SummaryStats } from './stats'
import type {
  ChartFilter,
  ChartSpec,
  ErrorBarBasis,
  FrozenChartPoint,
  MaterialisedChart,
  MaterialisedSeries,
  Transformation,
} from './chart-spec'

export const CHART_ROW_ID_KEY = '__sheetbaseRowId'
export const CHART_RECORD_ID_KEY = '__sheetbaseRecordId'

export const FIELD_TRANSFORM_KINDS = [
  'log10',
  'ln',
  'sqrt',
  'abs',
  'percentage',
  'difference',
  'ratio',
] as const
export type FieldTransformKind = (typeof FIELD_TRANSFORM_KINDS)[number]

export const SCI_RENDER_POINT_CAP = 4000

export function toNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function unitHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

export function rowMatchesFilterSci04(
  row: Record<string, unknown>,
  filter: ChartFilter,
): boolean {
  const value = row[filter.fieldId]
  if (filter.op === 'is_null') {
    return value === null || value === undefined || value === ''
  }
  if (filter.op === 'not_null') {
    return value !== null && value !== undefined && value !== ''
  }
  const num = toNumeric(value)
  switch (filter.op) {
    case 'eq':
      return value === filter.value
    case 'ne':
      return value !== filter.value
    case 'gt':
      return num !== null && filter.value !== null && num > Number(filter.value)
    case 'gte':
      return (
        num !== null && filter.value !== null && num >= Number(filter.value)
      )
    case 'lt':
      return num !== null && filter.value !== null && num < Number(filter.value)
    case 'lte':
      return (
        num !== null && filter.value !== null && num <= Number(filter.value)
      )
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(value)
    case 'between': {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) return false
      if (
        typeof filter.value[0] === 'string' &&
        typeof filter.value[1] === 'string' &&
        typeof value === 'string'
      ) {
        return value >= filter.value[0] && value <= filter.value[1]
      }
      const lo = toNumeric(filter.value[0])
      const hi = toNumeric(filter.value[1])
      return (
        num !== null && lo !== null && hi !== null && num >= lo && num <= hi
      )
    }
    default:
      return false
  }
}

export function applyFiltersSci04(
  rows: Record<string, unknown>[],
  filters: ChartFilter[],
): Record<string, unknown>[] {
  if (filters.length === 0) return rows
  return rows.filter((row) =>
    filters.every((filter) => rowMatchesFilterSci04(row, filter)),
  )
}

function strParam(
  params: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return typeof params[key] === 'string' ? params[key] : fallback
}

function applyAggregate(
  rows: Record<string, unknown>[],
  params: Record<string, unknown>,
  spec: ChartSpec,
): Record<string, unknown>[] {
  const fn = strParam(params, 'function', 'mean')
  const xField = strParam(params, 'xField', spec.fields.x?.fieldId ?? 'x')
  const yField = strParam(params, 'yField', spec.fields.y.fieldId)
  const seriesFieldRaw = strParam(
    params,
    'seriesField',
    spec.fields.series?.fieldId ?? spec.fields.color?.fieldId ?? '',
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
    const y = toNumeric(row[yField])
    if (!groups.has(key)) groups.set(key, { x, series, ys: [] })
    if (y !== null) groups.get(key)!.ys.push(y)
  }
  const out: Record<string, unknown>[] = []
  for (const group of groups.values()) {
    let reduced: number
    if (fn === 'count') reduced = group.ys.length
    else if (group.ys.length === 0) reduced = Number.NaN
    else if (fn === 'sum') reduced = group.ys.reduce((a, b) => a + b, 0)
    else if (fn === 'min') reduced = Math.min(...group.ys)
    else if (fn === 'max') reduced = Math.max(...group.ys)
    else if (fn === 'median') {
      const sorted = [...group.ys].sort((a, b) => a - b)
      const mid = (sorted.length - 1) / 2
      reduced =
        sorted.length % 2 === 1
          ? sorted[mid]
          : (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2
    } else {
      reduced = group.ys.reduce((a, b) => a + b, 0) / group.ys.length
    }
    const next: Record<string, unknown> = {
      [xField]: group.x,
      [yField]: reduced,
    }
    if (seriesField) next[seriesField] = group.series
    out.push(next)
  }
  return out
}

function applyNormalise(
  rows: Record<string, unknown>[],
  params: Record<string, unknown>,
  spec: ChartSpec,
): Record<string, unknown>[] {
  const method = strParam(params, 'method', 'percent_of_max')
  const yField = strParam(params, 'yField', spec.fields.y.fieldId)
  const seriesFieldRaw = strParam(
    params,
    'seriesField',
    spec.fields.series?.fieldId ?? '',
  )
  const seriesField = seriesFieldRaw || null
  const bySeries = new Map<string, number[]>()
  for (const row of rows) {
    const y = toNumeric(row[yField])
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
    const variance = ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length
    stats.set(key, { max, mean, sd: Math.sqrt(variance) })
  }
  return rows.map((row) => {
    const y = toNumeric(row[yField])
    if (y === null) return row
    const key = seriesField ? String(row[seriesField] ?? '—') : 'all'
    const s = stats.get(key) ?? { max: 0, mean: 0, sd: 0 }
    let normalised: number
    if (method === 'z_score') normalised = s.sd > 0 ? (y - s.mean) / s.sd : 0
    else if (method === 'reference') {
      const ref = toNumeric(params.reference)
      normalised = ref !== null && ref !== 0 ? y / ref : Number.NaN
    } else normalised = s.max > 0 ? (y / s.max) * 100 : 0
    return { ...row, [yField]: normalised }
  })
}

function applyFieldTransform(
  rows: Record<string, unknown>[],
  kind: FieldTransformKind,
  params: Record<string, unknown>,
  spec: ChartSpec,
): { rows: Record<string, unknown>[]; invalid: number; reasons: string[] } {
  const fieldId = strParam(params, 'fieldId', spec.fields.y.fieldId)
  let invalid = 0
  const reasons: string[] = []
  const next = rows.map((row) => {
    const y = toNumeric(row[fieldId])
    if (y === null) return row
    let value: number | null
    switch (kind) {
      case 'log10':
        value = y > 0 ? Math.log10(y) : null
        break
      case 'ln':
        value = y > 0 ? Math.log(y) : null
        break
      case 'sqrt':
        value = y >= 0 ? Math.sqrt(y) : null
        break
      case 'abs':
        value = Math.abs(y)
        break
      case 'percentage':
        value = y * 100
        break
      case 'difference': {
        const ref = toNumeric(params.reference)
        value = ref === null ? null : y - ref
        break
      }
      case 'ratio': {
        const ref = toNumeric(params.reference)
        value = ref === null || ref === 0 ? null : y / ref
        break
      }
      default: {
        const _exhaustive: never = kind
        return _exhaustive
      }
    }
  if (value === null || !Number.isFinite(value)) {
      invalid++
      reasons.push(reasonForInvalidTransform(kind, y, params))
      return { ...row, [fieldId]: null }
    }
    return { ...row, [fieldId]: value }
  })
  return { rows: next, invalid, reasons }
}

function reasonForInvalidTransform(
  kind: FieldTransformKind,
  _y: number,
  params: Record<string, unknown>,
): string {
  if (kind === 'log10' || kind === 'ln') return `${kind} of non-positive value`
  if (kind === 'sqrt') return 'square root of a negative value'
  if (kind === 'ratio') {
    const ref = toNumeric(params.reference)
    if (ref === 0) return 'ratio with a zero denominator'
    return 'ratio missing a numeric reference'
  }
  if (kind === 'difference') return 'difference missing a numeric reference'
  return `${kind} produced a non-numeric result`
}

export function applyTransformations(
  rows: Record<string, unknown>[],
  transformations: readonly Transformation[],
  spec: ChartSpec,
): {
  rows: Record<string, unknown>[]
  transformInvalid: number
  reasons: string[]
} {
  let current = rows
  let transformInvalid = 0
  const reasons: string[] = []
  for (const transformation of transformations) {
    if (transformation.kind === 'aggregate') {
      current = applyAggregate(current, transformation.params, spec)
    } else if (transformation.kind === 'normalise') {
      current = applyNormalise(current, transformation.params, spec)
    } else if (
      (FIELD_TRANSFORM_KINDS as readonly string[]).includes(transformation.kind)
    ) {
      const applied = applyFieldTransform(
        current,
        transformation.kind as FieldTransformKind,
        transformation.params,
        spec,
      )
      current = applied.rows
      transformInvalid += applied.invalid
      for (const reason of applied.reasons) {
        if (!reasons.includes(reason)) reasons.push(reason)
      }
    }
  }
  return { rows: current, transformInvalid, reasons }
}

export function formatAxisTitle(label: string, unit?: string): string {
  if (!unit) return label
  if (label.includes(`(${unit})`)) return label
  return `${label} (${unit})`
}

export function formatScientificNumber(
  value: number | null | undefined,
  kind: 'auto' | 'decimal' | 'sigfig' | 'scientific' | 'percent' = 'auto',
  digits = 3,
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'
  if (kind === 'percent')
    return `${(value * 100).toFixed(Math.min(digits, 6))}%`
  if (kind === 'scientific')
    return value
      .toExponential(Math.max(0, digits - 1))
      .replace('e+', 'e')
      .replace('e-0', 'e-')
  if (kind === 'decimal') return value.toFixed(digits)
  if (kind === 'sigfig') return Number(value.toPrecision(digits)).toString()
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e4 || abs < 1e-3) {
    return value.toExponential(2).replace('e+', 'e').replace('e-0', 'e-')
  }
  if (Number.isInteger(value)) return value.toString()
  return Number(value.toPrecision(3)).toString()
}

export function orderCategories(
  values: string[],
  mode: 'natural' | 'alpha' | 'numeric' | 'explicit',
  explicit?: string[],
): string[] {
  const unique = Array.from(new Set(values))
  if (mode === 'explicit' && explicit && explicit.length > 0) {
    const rest = unique
      .filter((value) => !explicit.includes(value))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return [...explicit.filter((value) => unique.includes(value)), ...rest]
  }
  if (mode === 'numeric') {
    return unique.sort((a, b) => {
      const an = toNumeric(a)
      const bn = toNumeric(b)
      if (an !== null && bn !== null) return an - bn
      if (an !== null) return -1
      if (bn !== null) return 1
      return a < b ? -1 : a > b ? 1 : 0
    })
  }
  if (mode === 'alpha') {
    return unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }
  return unique
}

export function seriesKeyForRow(
  row: Record<string, unknown>,
  spec: ChartSpec,
): string {
  const seriesId = spec.fields.series?.fieldId ?? spec.fields.color?.fieldId
  if (!seriesId) return 'all'
  return String(row[seriesId] ?? '—')
}

export function deterministicSample<T>(
  items: T[],
  cap: number,
): { items: T[]; sampled: boolean; stride: number } {
  if (items.length <= cap) return { items, sampled: false, stride: 1 }
  const stride = Math.ceil(items.length / cap)
  const sampled: T[] = []
  for (let i = 0; i < items.length; i += stride) sampled.push(items[i])
  return { items: sampled, sampled: true, stride }
}

export interface GroupedSummary {
  key: string
  x: unknown
  series: string
  stats: SummaryStats
  interval: { lo: number; hi: number; basis: ErrorBarBasis }
}

export function groupedNumericSummaries(
  rows: Record<string, unknown>[],
  spec: ChartSpec,
  yField: string,
  xField: string | null,
): GroupedSummary[] {
  const groups = new Map<string, { x: unknown; series: string; ys: number[] }>()
  const order: string[] = []
  for (const row of rows) {
    const series = seriesKeyForRow(row, spec)
    const x = xField ? row[xField] : series
    const key = `${String(x ?? '—')}::${series}`
    const y = toNumeric(row[yField])
    if (!groups.has(key)) {
      groups.set(key, { x, series, ys: [] })
      order.push(key)
    }
    if (y !== null) groups.get(key)!.ys.push(y)
  }
  const basis: ErrorBarBasis = spec.overlays.errorBars?.basis ?? 'sd'
  const multiplier = spec.overlays.errorBars?.multiplier ?? 1
  const out: GroupedSummary[] = []
  for (const key of order) {
    const group = groups.get(key)!
    const stats = summaryStats(group.ys)
    if (!stats) continue
    let lo = stats.mean
    let hi = stats.mean
    if (basis === 'sd' && stats.sd !== null) {
      lo = stats.mean - multiplier * stats.sd
      hi = stats.mean + multiplier * stats.sd
    } else if ((basis === 'se' || basis === 'sem') && stats.se !== null) {
      lo = stats.mean - multiplier * stats.se
      hi = stats.mean + multiplier * stats.se
    } else if (basis === 'ci') {
      const ci = meanConfidenceInterval(group.ys)
      if (ci) {
        lo = ci.lo
        hi = ci.hi
      }
    } else if (basis === 'range') {
      lo = stats.min
      hi = stats.max
    }
    out.push({
      key,
      x: group.x,
      series: group.series,
      stats,
      interval: { lo, hi, basis },
    })
  }
  return out
}

export function gaussianKde(
  values: number[],
  points = 32,
): Array<{ y: number; d: number }> {
  if (values.length === 0) return []
  const stats = summaryStats(values)
  if (!stats) return []
  const sd = stats.sd ?? 0
  const bandwidth =
    sd > 0
      ? 1.06 * sd * values.length ** (-1 / 5)
      : Math.max(Math.abs(stats.mean) * 0.05, 0.5)
  const min = stats.min
  const max = stats.max
  const pad = (max - min || Math.abs(max) || 1) * 0.08
  const lo = min - pad
  const hi = max + pad
  const out: Array<{ y: number; d: number }> = []
  const inv = 1 / (bandwidth * Math.sqrt(2 * Math.PI) * values.length)
  for (let i = 0; i < points; i++) {
    const y = lo + ((hi - lo) * i) / Math.max(points - 1, 1)
    let density = 0
    for (const v of values) {
      const u = (y - v) / bandwidth
      density += Math.exp(-0.5 * u * u)
    }
    out.push({ y, d: density * inv })
  }
  return out
}

export function jitterOffset(seed: string, amount = 0.18): number {
  return (unitHash(seed) - 0.5) * 2 * amount
}

function equationFromCoefficients(coefficients: number[]): string {
  return coefficients
    .map((c, i) => {
      const coef = Number(c.toPrecision(6)).toString()
      if (i === 0) return coef
      if (i === 1) return `${coef}·x`
      return `${coef}·x^${i}`
    })
    .join(' + ')
}

export function attachFitOverlay(
  spec: ChartSpec,
  series: MaterialisedSeries[],
): {
  series: MaterialisedSeries[]
  fit: MaterialisedChart['fit']
} {
  const overlay = spec.overlays.fit
  if (overlay == null) {
    return { series, fit: undefined }
  }
  const degree = overlay.degree ?? 1
  const xs: number[] = []
  const ys: number[] = []
  for (const item of series) {
    if (item.renderAs === 'line') continue
    for (const point of item.points) {
      if (point.x === null || point.y === null) continue
      xs.push(point.x)
      ys.push(point.y)
    }
  }
  if (xs.length < degree + 1) {
    return {
      series,
      fit: {
        method: 'ols',
        degree,
        n: xs.length,
        coefficients: [],
        r2: null,
        equation: '',
        error: 'insufficient_data',
      },
    }
  }
  const fit = olsFit(xs, ys, degree)
  if (!fit) {
    return {
      series,
      fit: {
        method: 'ols',
        degree,
        n: xs.length,
        coefficients: [],
        r2: null,
        equation: '',
        error: 'singular_fit',
      },
    }
  }
  const quality = fitQuality(xs, ys, fit.coefficients)
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const samples = 40
  const curve: FrozenChartPoint[] = []
  for (let i = 0; i < samples; i++) {
    const x = min + ((max - min) * i) / (samples - 1)
    curve.push({
      x,
      y: polyEval(fit.coefficients, x),
      yError: null,
      label: 'fit',
    })
  }
  const band =
    degree === 1 && overlay.showBand
      ? linearMeanConfidenceBand(
          xs,
          ys,
          curve.map((p) => p.x as number),
        )
      : null
  const fitSeries: MaterialisedSeries = {
    identifier: '__fit',
    label: 'OLS fit',
    color: '#111827',
    points: curve,
    renderAs: 'line',
  }
  return {
    series: [...series, fitSeries],
    fit: {
      method: 'ols',
      degree,
      n: xs.length,
      coefficients: fit.coefficients,
      r2: quality.r2,
      equation: `y = ${equationFromCoefficients(fit.coefficients)}`,
      band: band
        ? band.map((b) => ({ x: b.x, lo: b.lo, hi: b.hi }))
        : undefined,
    },
  }
}

export function apportionRenderBudget(
  counts: number[],
  budget: number,
): number[] {
  const total = counts.reduce((sum, count) => accSum(sum, count), 0)
  if (total <= budget) return counts
  const activeCount = counts.filter((count) => count > 0).length
  if (budget <= 0) return counts.map(() => 0)
  if (budget <= activeCount) {
    let remaining = budget
    return counts.map((count) => {
      if (count === 0 || remaining === 0) return 0
      remaining -= 1
      return 1
    })
  }
  const floors = counts.map((count) =>
    count === 0 ? 0 : Math.floor((count / total) * budget),
  )
  const assigned = floors.reduce((sum, count) => accSum(sum, count), 0)
  let leftover = budget - assigned
  const order = counts
    .map((count, index) => ({
      index,
      remainder: count === 0 ? -1 : (count / total) * budget - floors[index],
    }))
    .sort((a, b) => b.remainder - a.remainder)
  const result = [...floors]
  for (const item of order) {
    if (leftover <= 0) break
    if (counts[item.index] === 0) continue
    result[item.index] += 1
    leftover -= 1
  }
  return result.map((count, index) => Math.min(count, counts[index]))
}

function accSum(sum: number, count: number): number {
  return sum + count
}

export function sampleSeriesForRender(
  series: MaterialisedSeries[],
): {
  series: MaterialisedSeries[]
  sampling: MaterialisedChart['sampling']
} {
  const displayIndexes = series
    .map((item, index) =>
      item.renderAs === 'line' || item.identifier === '__fit' ? -1 : index,
    )
    .filter((index) => index >= 0)
  const counts = displayIndexes.map((index) => series[index].points.length)
  const total = counts.reduce((sum, count) => accSum(sum, count), 0)
  if (total <= SCI_RENDER_POINT_CAP) {
    return { series, sampling: undefined }
  }
  const budgets = apportionRenderBudget(counts, SCI_RENDER_POINT_CAP)
  const sampled = series.map((item, index) => {
    const displayIndex = displayIndexes.indexOf(index)
    if (displayIndex < 0) return item
    const cap = budgets[displayIndex]
    if (item.points.length <= cap) return item
    return {
      ...item,
      points: deterministicSample(item.points, cap).items,
    }
  })
  const shown = sampled.reduce((acc, item) => {
    if (item.renderAs === 'line' || item.identifier === '__fit') return acc
    return acc + item.points.length
  }, 0)
  return {
    series: sampled,
    sampling: {
      totalCount: total,
      sampledCount: shown,
      analysisCount: total,
    },
  }
}
