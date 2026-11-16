import { useMemo } from 'react'
import { t } from '#/copy'
import {
  buildCurveFitChart,
  buildRegressionFitChart,
} from '#/components/viz/analysis-charts'
import { AnalysisResultTable } from '#/components/viz/analysis-results'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { chartRowSchema } from '#/lib/chart-spec'
import type { ChartRow } from '#/lib/chart-spec'
import type { DatasetRowInput } from '#/lib/dataset-product'
import type {
  AnalysisDefinition,
  AnalysisResult,
} from '#/lib/analysis-definition'
import { headlinesOf } from './analysis-headlines'
import type { Headline } from './analysis-headlines'

/** The most fitted curves a notebook block draws; the table below lists them all. */
const MAX_FIGURES = 4

function HeadlineCard({ headline }: { headline: Headline }) {
  return (
    <div className="border-t border-border pt-3">
      {headline.group ? (
        <p className="m-0 mb-2 text-label font-medium text-fg">
          {headline.group}
        </p>
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2">
        {headline.stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-label text-fg-muted">{stat.label}</dt>
            <dd className="m-0 font-mono text-body tabular-nums text-fg">
              {stat.value}
              {stat.detail ? (
                <span className="block text-caption text-fg-muted">
                  {stat.detail}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {headline.note ? (
        <p className="m-0 mt-2 break-words font-mono text-caption text-fg-muted">
          {headline.note}
        </p>
      ) : null}
    </div>
  )
}

export interface ColumnLabel {
  id: string
  label: string
}

type FitFigure = NonNullable<ReturnType<typeof buildRegressionFitChart>>

/** Name the axes after the dataset's columns, not "Predictor" and "Outcome". */
function named(
  figure: FitFigure,
  statistic: Extract<AnalysisDefinition, { kind: 'regression' }>,
  columns: readonly ColumnLabel[],
): FitFigure {
  const labelOf = (fieldId: string, transform: string | undefined) => {
    const label = columns.find((column) => column.id === fieldId)?.label

    if (!label) return null

    return !transform || transform === 'none' ? label : `${transform}(${label})`
  }

  const xLabel =
    labelOf(statistic.predictor.fieldId, statistic.predictorTransform) ??
    figure.materialised.xLabel

  const yLabel =
    labelOf(statistic.outcome.fieldId, statistic.outcomeTransform) ??
    figure.materialised.yLabel

  return {
    spec: {
      ...figure.spec,
      display: {
        ...figure.spec.display,
        axes: {
          x: { ...figure.spec.display.axes.x, label: xLabel },
          y: { ...figure.spec.display.axes.y, label: yLabel },
        },
      },
    },
    materialised: { ...figure.materialised, xLabel, yLabel },
  }
}

/** The fitted curve over its points: what a figure legend would show. */
function useFitFigures(
  statistic: AnalysisDefinition,
  result: AnalysisResult,
  rows: readonly DatasetRowInput[],
  columns: readonly ColumnLabel[],
) {
  return useMemo(() => {
    if (result.kind === 'curve')
      return result.rows
        .slice(0, MAX_FIGURES)
        .map((row) => ({
          key: row.group,
          figure: buildCurveFitChart(row),
        }))
        .filter((entry) => entry.figure !== null)

    if (
      result.kind === 'regression' &&
      statistic.kind === 'regression' &&
      !statistic.group &&
      rows.length > 0
    ) {
      const fit = result.rows.find((row) => row.group === 'all')

      if (!fit) return []

      const figure = buildRegressionFitChart({
        definition: statistic,
        fit,
        rows: rows.map((row): ChartRow => chartRowSchema.parse(row)),
      })

      return figure
        ? [{ key: 'all', figure: named(figure, statistic, columns) }]
        : []
    }

    return []
  }, [statistic, result, rows, columns])
}

/**
 * What an analysis block shows in a notebook: the fitted figure and the key
 * numbers first, the way a result is quoted, and the full tables, terms and
 * assumption checks underneath for anyone who wants to check the working. A
 * statistic with no fit to draw (a group comparison, a survival curve) shows
 * its tables straight away.
 */
export function AnalysisBlockResult({
  statistic,
  result,
  rows,
  columns,
}: {
  statistic: AnalysisDefinition
  result: AnalysisResult
  rows: readonly DatasetRowInput[]
  columns: readonly ColumnLabel[]
}) {
  const headlines = headlinesOf(result)
  const figures = useFitFigures(statistic, result, rows, columns)

  if (headlines.length === 0) return <AnalysisResultTable result={result} />

  const drawn = figures.some(({ figure }) => figure)

  return (
    <div className="space-y-3">
      <div
        className={
          drawn
            ? 'grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
            : 'grid gap-3'
        }
      >
        <div className={drawn ? 'min-w-0 space-y-3' : 'hidden'}>
          {figures.map(({ key, figure }) =>
            figure ? (
              <ChartRenderer
                key={key}
                title={t('features.resultsAnalysis.block.figure')}
                hideTitle
                spec={figure.spec}
                materialised={figure.materialised}
                frozen={null}
                showTableAlternative={false}
                plotHeight={240}
                className="rounded-none border-0 bg-transparent shadow-none"
              />
            ) : null,
          )}
        </div>
        <div
          className={
            drawn
              ? 'min-w-0 space-y-2'
              : 'grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3'
          }
        >
          {headlines.map((headline) => (
            <HeadlineCard key={headline.group ?? 'all'} headline={headline} />
          ))}
        </div>
      </div>
      <details open={!drawn} className="group border-t border-border">
        <summary className="cursor-pointer select-none py-2 text-label text-fg-muted hover:text-fg">
          {t('features.resultsAnalysis.block.working')}
        </summary>
        <div className="pt-1">
          <AnalysisResultTable result={result} />
        </div>
      </details>
    </div>
  )
}
