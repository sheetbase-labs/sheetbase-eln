import { t } from '#/copy'
import { formatDose } from '#/components/viz/analysis-charts'
import type {
  AnalysisResult,
  ComparisonResult,
  CurveFitRow,
  DescriptiveResult,
  DescriptiveRow,
  RegressionFitRow,
  SurvivalResult,
} from '#/lib/analysis-definition'

export interface Headline {
  /** The group the fit belongs to, or null for a single ungrouped fit. */
  group: string | null
  /** A line shown small under the numbers: the fitted formula or what was compared. */
  note: string | null
  stats: ReadonlyArray<{ label: string; value: string; detail?: string }>
}

function groupOf(group: string): string | null {
  return group === 'all' ? null : group
}

function regressionHeadline(row: RegressionFitRow): Headline {
  return {
    group: groupOf(row.group),
    note: row.equation,
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

  return { group: groupOf(row.group), note: row.equation, stats }
}

const SOON = 'features.resultsAnalysis.block'

/** A p-value the way a paper quotes it. */
function pText(p: number): string {
  if (!Number.isFinite(p)) return t('data.analysisDefinition.notEstimable')

  return p < 0.001 ? '< 0.001' : Number(p.toPrecision(3)).toString()
}

function groupStats(row: DescriptiveRow): Headline {
  const s = row.stats

  const stats: Headline['stats'][number][] = [
    { label: t(`${SOON}.mean`), value: formatDose(s.mean) },
  ]

  if (s.sd !== null)
    stats.push({ label: t(`${SOON}.sd`), value: formatDose(s.sd) })
  stats.push({ label: t(`${SOON}.median`), value: formatDose(s.median) })
  stats.push({ label: t(`${SOON}.count`), value: `${s.n}` })

  return {
    group: groupOf(row.group),
    note: t(`${SOON}.range`, {
      min: formatDose(s.min),
      max: formatDose(s.max),
    }),
    stats,
  }
}

function descriptiveHeadlines(result: DescriptiveResult): Headline[] {
  return result.rows.map(groupStats)
}

/** The most pair cards a comparison lists before it sums the rest up. */
const MAX_PAIRS = 3

function comparisonHeadlines(result: ComparisonResult): Headline[] {
  const out: Headline[] = []
  const omnibus = result.omnibus

  if (omnibus)
    out.push({
      group: t(`${SOON}.overall`),
      note: t(`${SOON}.overallNote`, { count: omnibus.groups.length }),
      stats: [
        { label: t(`${SOON}.fStat`), value: formatDose(omnibus.f) },
        { label: t(`${SOON}.pValue`), value: pText(omnibus.p) },
        {
          label: t(`${SOON}.etaSquared`),
          value: omnibus.etaSquared.toFixed(2),
        },
      ],
    })

  const alpha = `${result.alpha}`

  const note = (significant: boolean) =>
    t(
      significant
        ? `${SOON}.pairNote.significant`
        : `${SOON}.pairNote.notSignificant`,
      { alpha },
    )

  if (result.pairs.length <= MAX_PAIRS) {
    for (const pair of result.pairs) {
      const stats: Headline['stats'][number][] = []

      if (pair.difference !== null)
        stats.push({
          label: t(`${SOON}.difference`),
          value: formatDose(pair.difference),
        })
      stats.push({ label: t(`${SOON}.pValue`), value: pText(pair.p) })

      if (pair.effectSize !== null && pair.effectLabel)
        stats.push({
          label: t(`${SOON}.effect.${pair.effectLabel}`),
          value: pair.effectSize.toFixed(2),
        })

      out.push({
        group: t(`${SOON}.pairName`, { one: pair.group1, two: pair.group2 }),
        note: note(pair.significant),
        stats,
      })
    }

    return out
  }

  const significant = result.pairs.filter((pair) => pair.significant).length
  const smallest = Math.min(...result.pairs.map((pair) => pair.p))

  out.push({
    group: t(`${SOON}.pairsSummary`),
    note: result.postHoc
      ? t(`${SOON}.pairsNote`, {
          method: t(`data.analysisPanel.postHocs.${result.postHoc}`),
        })
      : null,
    stats: [
      {
        label: t(`${SOON}.pairsSignificant`, {
          significant,
          total: result.pairs.length,
        }),
        value: `${significant}`,
      },
      { label: t(`${SOON}.smallestP`), value: pText(smallest) },
    ],
  })

  return out
}

function survivalHeadlines(result: SurvivalResult): Headline[] {
  const out: Headline[] = result.curves.map((curve) => ({
    group: curve.group === 'All' ? null : curve.group,
    note: null,
    stats: [
      {
        label: t(`${SOON}.medianSurvival`),
        value:
          curve.medianSurvival === null
            ? t(`${SOON}.notReached`)
            : formatDose(curve.medianSurvival),
      },
      { label: t(`${SOON}.count`), value: `${curve.n}` },
      { label: t(`${SOON}.events`), value: `${curve.events}` },
      { label: t(`${SOON}.censored`), value: `${curve.censored}` },
    ],
  }))

  const test = result.logRank

  if (test) {
    const stats: Headline['stats'][number][] = [
      { label: t(`${SOON}.pValue`), value: pText(test.p) },
    ]

    if (test.hazardRatio)
      stats.push({
        label: t(`${SOON}.hazardRatio`),
        value: formatDose(test.hazardRatio.hr),
        detail: t(`${SOON}.hazardRange`, {
          lo: formatDose(test.hazardRatio.lo),
          hi: formatDose(test.hazardRatio.hi),
        }),
      })

    out.push({ group: t(`${SOON}.logRank`), note: null, stats })
  }

  return out
}

/** The numbers a person quotes first, for every kind of analysis. */
export function headlinesOf(result: AnalysisResult): Headline[] {
  switch (result.kind) {
    case 'regression':
      return result.rows.map(regressionHeadline)
    case 'curve':
      return result.rows.map(curveHeadline)
    case 'descriptive':
      return descriptiveHeadlines(result)
    case 'comparison':
      return comparisonHeadlines(result)
    case 'survival':
      return survivalHeadlines(result)
  }
}
