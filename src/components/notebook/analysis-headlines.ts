import { t } from '#/copy'
import { formatDose } from '#/components/viz/analysis-charts'
import type {
  AnalysisResult,
  CurveFitRow,
  RegressionFitRow,
} from '#/lib/analysis-definition'

export interface Headline {
  /** The group the fit belongs to, or null for a single ungrouped fit. */
  group: string | null
  /** The fitted formula, shown small beside the numbers. */
  equation: string
  stats: ReadonlyArray<{ label: string; value: string; detail?: string }>
}

function groupOf(group: string): string | null {
  return group === 'all' ? null : group
}

function regressionHeadline(row: RegressionFitRow): Headline {
  return {
    group: groupOf(row.group),
    equation: row.equation,
    stats: [
      { label: 'R²', value: row.r2.toFixed(3) },
      { label: t('features.resultsAnalysis.block.points'), value: `${row.n}` },
      {
        label: t('features.resultsAnalysis.block.rmse'),
        value: formatDose(row.rmse),
      },
    ],
  }
}

function curveHeadline(row: CurveFitRow): Headline {
  const unknowns = row.readBack.filter((r) => r.role === 'unknown').length

  const stats: Headline['stats'][number][] = [
    {
      label: row.ecLabel,
      value: formatDose(row.ec50),
      detail: row.ec50Ci95
        ? t('data.analysisPanel.curveCi', {
            lo: formatDose(row.ec50Ci95.lo),
            hi: formatDose(row.ec50Ci95.hi),
          })
        : undefined,
    },
    { label: 'R²', value: row.r2.toFixed(3) },
    { label: t('data.analysisPanel.curveStandards'), value: `${row.n}` },
  ]

  if (unknowns > 0)
    stats.push({
      label: t('data.analysisPanel.curveUnknowns'),
      value: `${unknowns}`,
    })

  return { group: groupOf(row.group), equation: row.equation, stats }
}

/** The numbers a person quotes first, for the two fitted kinds; none for the rest. */
export function headlinesOf(result: AnalysisResult): Headline[] {
  if (result.kind === 'regression') return result.rows.map(regressionHeadline)

  if (result.kind === 'curve') return result.rows.map(curveHeadline)

  return []
}
