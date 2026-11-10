import { z } from 'zod'
import { t } from '#/copy'
import { TRANSFORM_FNS, regressionFitCurve } from '#/lib/analysis-definition'
import type {
  AnalysisDefinition,
  RegressionFitRow,
  CurveFitRow,
  COLUMN_TRANSFORMS,
} from '#/lib/analysis-definition'
import { formatScientific } from '#/lib/chart-spec'
import type {
  ChartRow,
  ChartValue,
  ChartSpec,
  MaterialisedChart,
} from '#/lib/chart-spec'
import { curvePoints } from '#/lib/curve-fit'
import type { CurveParameters } from '#/lib/curve-fit'

interface AnalysisFitChart {
  spec: ChartSpec
  materialised: MaterialisedChart
}

export function formatDose(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'

  return Number(value.toPrecision(4)).toString()
}

function preview({
  xLabel,
  yLabel,
  specSeries,
  series,
}: {
  xLabel: string
  yLabel: string
  specSeries: ChartSpec['display']['series']
  series: MaterialisedChart['series']
}): AnalysisFitChart {
  return {
    spec: {
      specVersion: 1,
      type: 'scatter',
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
          x: { label: xLabel, scale: 'linear' },
          y: { label: yLabel, scale: 'linear' },
        },
        series: specSeries,
        legend: { visible: true },
        annotations: [],
      },
      overlays: { errorBars: null },
    },
    materialised: {
      state: { kind: 'ok' },
      columns: [],
      rows: [],
      series,
      xLabel,
      yLabel,
      xUnit: undefined,
      yUnit: undefined,
      droppedPoints: 0,
    },
  }
}

const finiteNumericCell = z.union([
  z.number().finite(),
  z.string().trim().min(1).transform(Number).pipe(z.number().finite()),
])

function toNumberValue(value: ChartValue): number | null {
  const parsed = finiteNumericCell.safeParse(value)

  return parsed.success ? parsed.data : null
}

function applyTransform(
  value: number,
  kind: (typeof COLUMN_TRANSFORMS)[number],
): number | null {
  if (kind === 'none') return value

  if (value <= 0) return null

  return TRANSFORM_FNS[kind](value)
}

/** The plotted space is the fitted space; grouped models cannot share an honest overlay. */
export function buildRegressionFitChart({
  definition,
  fit,
  rows,
}: {
  definition: Extract<AnalysisDefinition, { kind: 'regression' }>
  fit: RegressionFitRow
  rows: ChartRow[]
}): ReturnType<typeof preview> | null {
  if (definition.group) return null
  const predictorTransform = definition.predictorTransform ?? 'none'
  const outcomeTransform = definition.outcomeTransform ?? 'none'
  const pairs: Array<{ x: number; y: number }> = []

  for (const row of rows) {
    const rawX = toNumberValue(row[definition.predictor.fieldId])
    const rawY = toNumberValue(row[definition.outcome.fieldId])

    if (rawX === null || rawY === null) continue
    const x = applyTransform(rawX, predictorTransform)
    const y = applyTransform(rawY, outcomeTransform)

    if (x !== null && y !== null) pairs.push({ x, y })
  }

  if (pairs.length === 0) return null
  const xs = pairs.map((point) => point.x)
  const observed = 'var(--series-a)'
  const fitColor = 'var(--series-b)'

  const xLabel =
    predictorTransform === 'none'
      ? t('data.analysisPanel.predictor')
      : `${predictorTransform}(Predictor)`

  const yLabel =
    outcomeTransform === 'none'
      ? t('data.analysisPanel.outcome')
      : `${outcomeTransform}(Outcome)`

  return preview({
    xLabel,
    yLabel,
    specSeries: [
      {
        identifier: 'observed',
        label: t('data.analysisPanel.observed'),
        color: observed,
      },
      {
        identifier: 'fit',
        label: t('data.analysisPanel.fit', { equation: fit.equation }),
        color: fitColor,
      },
    ],
    series: [
      {
        identifier: 'observed',
        label: t('data.analysisPanel.observed'),
        color: observed,
        points: pairs.map((point) => ({
          ...point,
          yError: null,
          label: t('data.analysisPanel.observed'),
        })),
      },
      {
        identifier: 'fit',
        label: t('data.analysisPanel.fit2', {
          value: formatScientific(fit.r2),
        }),
        color: fitColor,
        renderAs: 'line',
        points: regressionFitCurve(fit.coefficients, {
          min: Math.min(...xs),
          max: Math.max(...xs),
        }).map((point) => ({
          x: point.x,
          y: point.y,
          yError: null,
          label: t('data.analysisPanel.fit3'),
        })),
      },
    ],
  })
}

/** Standards, fitted logistic curve and unknown read-backs share a log10 dose axis. */
export function buildCurveFitChart(
  row: CurveFitRow,
): ReturnType<typeof preview> | null {
  const estimate = (name: string) =>
    row.parameters.find((parameter) => parameter.name === name)?.estimate

  const A = estimate('A')
  const B = estimate('B')
  const C = estimate('C')
  const D = estimate('D')

  if (A === undefined || B === undefined || C === undefined || D === undefined)
    return null
  const params: CurveParameters = { A, B, C, D, G: estimate('G') ?? 1 }

  const standards = row.readBack.filter(
    (entry) => entry.role === 'standard' && entry.dose,
  )

  const unknowns = row.readBack.filter(
    (entry) => entry.role === 'unknown' && entry.concentration !== null,
  )

  if (standards.length === 0) return null

  const doses = [
    ...standards.map((entry) => entry.dose!),
    ...unknowns.map((entry) => entry.concentration!),
  ].filter((value) => value > 0)

  const standardColor = 'var(--series-a)'
  const fitColor = 'var(--series-b)'
  const unknownColor = 'var(--series-c)'
  const standardsLabel = t('data.analysisPanel.curveStandardsSeries')
  const unknownsLabel = t('data.analysisPanel.curveUnknownsSeries')

  const fitLabel = t('data.analysisPanel.curveFitSeries', {
    ecLabel: row.ecLabel,
    value: formatDose(row.ec50),
  })

  return preview({
    xLabel: t('data.analysisPanel.curveDoseAxis'),
    yLabel: t('data.analysisPanel.curveResponseAxis'),
    specSeries: [
      { identifier: 'standards', label: standardsLabel, color: standardColor },
      ...(unknowns.length > 0
        ? [
            {
              identifier: 'unknowns',
              label: unknownsLabel,
              color: unknownColor,
            },
          ]
        : []),
      { identifier: 'fit', label: fitLabel, color: fitColor },
    ],
    series: [
      {
        identifier: 'standards',
        label: standardsLabel,
        color: standardColor,
        points: standards.map((entry) => ({
          x: Math.log10(entry.dose!),
          y: entry.response,
          yError: null,
          label: entry.label ?? standardsLabel,
        })),
      },
      ...(unknowns.length > 0
        ? [
            {
              identifier: 'unknowns',
              label: unknownsLabel,
              color: unknownColor,
              points: unknowns.map((entry) => ({
                x: Math.log10(entry.concentration!),
                y: entry.response,
                yError: null,
                label: entry.label ?? unknownsLabel,
              })),
            },
          ]
        : []),
      {
        identifier: 'fit',
        label: fitLabel,
        color: fitColor,
        renderAs: 'line',
        points: curvePoints(params, row.model, {
          min: Math.min(...doses),
          max: Math.max(...doses),
        }).map((point) => ({
          x: Math.log10(point.x),
          y: point.y,
          yError: null,
          label: fitLabel,
        })),
      },
    ],
  })
}
