import { z } from 'zod'

import { analysisMethodsText } from './analysis-definition'
import type { AnalysisResult } from './analysis-definition'
import { extractJsonObject } from './ai-import-mapping'
import type { MaterialisedChart } from './chart-spec'
import { summaryStats } from './stats'

/**
 * Facts for "Explain this". The numbers are worked out here, in code, from the
 * data the person is looking at: the model is only asked to put them into
 * words, so it never has to do arithmetic and cannot invent a value that was
 * not on the screen.
 */

const MAX_SERIES = 6
const MAX_OUTLIERS = 5

function fmt(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)

  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(3)

  return String(Number(value.toPrecision(5)))
}

export interface SeriesPoint {
  x: number | null
  y: number | null
  label?: string
}

export type Trend = 'rising' | 'falling' | 'flat'

/** Least-squares direction of y against x (or against order when x is not a number). */
export function trendOf(points: SeriesPoint[]): Trend | null {
  const pairs = points.flatMap((point, index): [number, number][] =>
    point.y === null ? [] : [[point.x ?? index, point.y]],
  )

  if (pairs.length < 3) return null
  const n = pairs.length
  const mx = pairs.reduce((sum, [x]) => sum + x, 0) / n
  const my = pairs.reduce((sum, [, y]) => sum + y, 0) / n
  let sxx = 0
  let sxy = 0

  for (const [x, y] of pairs) {
    sxx += (x - mx) ** 2
    sxy += (x - mx) * (y - my)
  }

  if (sxx === 0) return null
  const slope = sxy / sxx
  const xs = pairs.map(([x]) => x)
  const ys = pairs.map(([, y]) => y)
  const yRange = Math.max(...ys) - Math.min(...ys)

  if (yRange === 0) return 'flat'
  const change = slope * (Math.max(...xs) - Math.min(...xs))

  return Math.abs(change) / yRange < 0.15
    ? 'flat'
    : change > 0
      ? 'rising'
      : 'falling'
}

/** A point that is plotted: its y value is a number. */
export type PlottedPoint = SeriesPoint & { y: number }

/** Points beyond 1.5 × the interquartile range from the quartiles. */
export function outliersOf(points: SeriesPoint[]): PlottedPoint[] {
  const ys = points.flatMap((point) => (point.y === null ? [] : [point.y]))

  if (ys.length < 5) return []
  const stats = summaryStats(ys)

  if (!stats) return []
  const spread = stats.q3 - stats.q1

  if (spread === 0) return []
  const lo = stats.q1 - 1.5 * spread
  const hi = stats.q3 + 1.5 * spread

  return points.filter(
    (point): point is PlottedPoint =>
      point.y !== null && (point.y < lo || point.y > hi),
  )
}

function seriesFacts(
  label: string,
  points: SeriesPoint[],
  xLabel: string,
  yLabel: string,
  yUnit: string | undefined,
): string[] {
  const values = points.flatMap((point) => (point.y === null ? [] : [point.y]))
  const stats = summaryStats(values)

  if (!stats) return [`${label}: no numeric values.`]
  const unit = yUnit ? ` ${yUnit}` : ''

  const lines = [
    `${label}: ${stats.n} values of ${yLabel}; min ${fmt(stats.min)}${unit}, median ${fmt(stats.median)}${unit}, mean ${fmt(stats.mean)}${unit}, max ${fmt(stats.max)}${unit}${stats.sd === null ? '' : `, sd ${fmt(stats.sd)}${unit}`}.`,
  ]

  const trend = trendOf(points)

  if (trend) lines.push(`${label}: ${yLabel} is ${trend} across ${xLabel}.`)
  const outliers = outliersOf(points)

  if (outliers.length > 0) {
    lines.push(
      `${label}: ${outliers.length} possible outlier${outliers.length === 1 ? '' : 's'}: ${outliers
        .slice(0, MAX_OUTLIERS)
        .map(
          (point) =>
            `${point.label ? `${point.label} ` : ''}(${xLabel} ${point.x === null ? 'n/a' : fmt(point.x)}, ${yLabel} ${fmt(point.y)}${unit})`,
        )
        .join('; ')}.`,
    )
  }

  return lines
}

/** What a chart shows, in lines a model can restate. Null when nothing is plotted. */
export function chartFacts(
  title: string,
  chart: MaterialisedChart,
): string | null {
  if (chart.state.kind !== 'ok') return null

  const visible = chart.series.filter(
    (series) => series.visible !== false && series.renderAs !== 'line',
  )

  if (visible.length === 0) return null

  const lines = [
    `Chart: ${title}. X axis: ${chart.xLabel}${chart.xUnit ? ` (${chart.xUnit})` : ''}. Y axis: ${chart.yLabel}${chart.yUnit ? ` (${chart.yUnit})` : ''}.`,
  ]

  for (const series of visible.slice(0, MAX_SERIES)) {
    lines.push(
      ...seriesFacts(
        series.label,
        series.points,
        chart.xLabel,
        chart.yLabel,
        chart.yUnit,
      ),
    )
  }

  if (visible.length > MAX_SERIES)
    lines.push(`${visible.length - MAX_SERIES} more series not listed.`)

  if (chart.fit && !chart.fit.error)
    lines.push(
      `Fitted line: ${chart.fit.equation}, R² ${chart.fit.r2 === null ? 'n/a' : fmt(chart.fit.r2)}, n ${chart.fit.n}.`,
    )

  if (chart.droppedPoints > 0)
    lines.push(
      `${chart.droppedPoints} rows were left out (missing or non-numeric).`,
    )

  return lines.join('\n')
}

/** What an analysis result says: method, key numbers and the assumption checks. */
export function analysisFacts(result: AnalysisResult): string {
  const lines = [analysisMethodsText(result)]

  if (result.kind === 'descriptive') {
    for (const row of result.rows) {
      const s = row.stats
      lines.push(
        `Group ${row.group}: n ${s.n}, mean ${fmt(s.mean)}${s.sd === null ? '' : `, sd ${fmt(s.sd)}`}, min ${fmt(s.min)}, median ${fmt(s.median)}, max ${fmt(s.max)}${row.missing ? `, ${row.missing} missing` : ''}.`,
      )
    }
  } else if (result.kind === 'regression') {
    for (const row of result.rows)
      lines.push(
        `Group ${row.group}: ${row.equation}; R² ${fmt(row.r2)}, RMSE ${fmt(row.rmse)}, n ${row.n}.`,
      )
  }

  for (const check of result.checks)
    lines.push(
      `Check "${check.label}"${check.group ? ` (${check.group})` : ''}: ${check.status}. ${check.detail}`,
    )

  return lines.join('\n')
}

/** The instruction for an explain call: what to say, from which facts. */
export function explainInstruction(subject: string, facts: string): string {
  return `Explain this ${subject} to the scientist looking at it. Mention the overall picture, any trend, any possible outliers and anything the data cannot tell them. Facts worked out from the data on the page:\n${facts}`
}

// ---------------------------------------------------------------------------
// Chart suggestion by the real model.
// ---------------------------------------------------------------------------

export interface AiChartField {
  fieldId: string
  label: string
  logicalType: string
}

const chartAnswerSchema = z.object({
  type: z.string(),
  x_field_id: z.string().nullish(),
  y_field_id: z.string().nullish(),
  reason: z.string().nullish(),
})

export interface AiChartChoice {
  type: string
  xFieldId: string | null
  yFieldId: string
  reason: string
}

export function chartSuggestionInstruction(
  fields: AiChartField[],
  types: readonly string[],
): string {
  return [
    'Pick the most informative chart for this dataset.',
    `Chart types: ${types.join(', ')}.`,
    'Fields (id | label | type):',
    ...fields.map(
      (field) => `- ${field.fieldId} | ${field.label} | ${field.logicalType}`,
    ),
    'Reply with JSON only: {"type":"<chart type>","x_field_id":"<id or null>","y_field_id":"<id of the measured field>","reason":"<one short sentence>"}.',
  ].join('\n')
}

/** The model's pick, kept only if its type and fields are real. */
export function parseChartChoice(
  text: string,
  fields: AiChartField[],
  types: readonly string[],
): AiChartChoice | null {
  const parsed = chartAnswerSchema.safeParse(extractJsonObject(text))

  if (!parsed.success) return null
  const ids = new Set(fields.map((field) => field.fieldId))
  const { type, x_field_id: x, y_field_id: y, reason } = parsed.data

  if (!types.includes(type) || !y || !ids.has(y)) return null

  if (x && !ids.has(x)) return null

  return {
    type,
    xFieldId: x ?? null,
    yFieldId: y,
    reason: (reason ?? '').trim().slice(0, 200),
  }
}
