import { z } from 'zod'

import { t } from '#/copy'
import type { ResolvedDataset } from '#/lib/chart-data'
import type { ChartSpec, MaterialisedChart } from '#/lib/chart-spec'
import { EXTENSION_CHART_TYPES } from '#/lib/extensions/points'

const outcomeSchema = z.object({
  columns: z.array(
    z.object({ name: z.string(), type: z.enum(['number', 'text']) }),
  ),
  rows: z.array(
    z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  ),
  chart: z
    .object({
      type: z.enum(EXTENSION_CHART_TYPES),
      x: z.string(),
      y: z.string(),
      group: z.string().optional(),
    })
    .nullable(),
  durationMs: z.number().nonnegative(),
})

export type ExtensionAnalysisOutcome = z.infer<typeof outcomeSchema>

const numericInput = z
  .union([z.number(), z.string().trim().min(1).transform(Number)])
  .pipe(z.number())

export function extensionAnalysisNumber(
  value: ResolvedDataset['rows'][number][string],
): number | null {
  const parsed = numericInput.safeParse(value)

  return parsed.success ? parsed.data : null
}

/** The runner route returns a declared result, or a refusal message, never an unchecked table. */
export async function readExtensionAnalysisResult(response: Response) {
  if (!response.ok) {
    const refusal = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null))

    throw new Error(
      refusal.success ? refusal.data.error : t('common.errors.generic'),
    )
  }

  return outcomeSchema.parse(await response.json())
}

/** The chart the extension declared, built from its result rows. */
export function buildExtensionChart(outcome: ExtensionAnalysisOutcome): {
  spec: ChartSpec
  materialised: MaterialisedChart
} | null {
  const chart = outcome.chart

  if (!chart || outcome.rows.length === 0) return null

  const xIsText =
    outcome.columns.find((column) => column.name === chart.x)?.type === 'text'

  const groups = new Map<string, ExtensionAnalysisOutcome['rows']>()

  for (const row of outcome.rows) {
    const key = chart.group ? String(row[chart.group] ?? '') : ''
    const group = groups.get(key)

    if (group) group.push(row)
    else groups.set(key, [row])
  }

  const colours = [
    'var(--series-a)',
    'var(--series-b)',
    'var(--series-c)',
    'var(--series-d)',
  ]

  const series = [...groups.entries()].map(([group, rows], index) => ({
    identifier: group || 'result',
    label: group || chart.y,
    color: colours[index % colours.length],
    points: rows.map((row, position) => ({
      x: xIsText ? position + 1 : extensionAnalysisNumber(row[chart.x]),
      y: extensionAnalysisNumber(row[chart.y]),
      yError: null,
      label: xIsText ? String(row[chart.x] ?? '') : group || chart.y,
    })),
  }))

  return {
    spec: {
      specVersion: 1,
      type: chart.type,
      datasets: [],
      fields: {
        x: null,
        y: { fieldId: '' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: {
          x: { label: chart.x, scale: 'linear' },
          y: { label: chart.y, scale: 'linear' },
        },
        series: series.map((s) => ({
          identifier: s.identifier,
          label: s.label,
          color: s.color,
        })),
        legend: { visible: series.length > 1 },
        annotations: [],
      },
      overlays: { errorBars: null },
    },
    materialised: {
      state: { kind: 'ok' },
      columns: [],
      rows: [],
      series,
      xLabel: chart.x,
      yLabel: chart.y,
      xUnit: undefined,
      yUnit: undefined,
      droppedPoints: 0,
    },
  }
}
