import { t } from '#/copy'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { StatGrid } from '#/components/viz/stat-grid'
import type { StatColumn } from '#/components/viz/stat-grid'
import { toast } from '#/components/ui/sonner'
import { ExplainThis } from '#/components/assist/explain-this'
import { analysisFacts } from '#/lib/ai-explain-data'
import { analysisMethodsText } from '#/lib/analysis-definition'
import type {
  AnalysisResult,
  AssumptionCheck,
  DescriptiveResult,
  RegressionResult,
  CurveResult,
  CurveFitRow,
  CurveReadBack,
  runAnalysis,
} from '#/lib/analysis-definition'
import { formatScientific } from '#/lib/chart-spec'
import {
  ComparisonResultTables,
  SurvivalResultTables,
} from './analysis-comparison'
import { formatDose } from './analysis-charts'
import { describeExecutionError } from './analysis-errors'

export function AnalysisExecutionResult({
  error,
  execution,
}: {
  error: Error | null
  execution: ReturnType<typeof runAnalysis> | null
}) {
  if (error)
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-danger-text"
      >
        {error.message}
      </div>
    )

  if (execution?.ok) return <AnalysisResultTable result={execution.result} />

  if (execution)
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-danger-text"
      >
        {describeExecutionError(execution.error)}
      </div>
    )

  return (
    <div
      role="status"
      className="rounded-md border border-dashed border-border bg-surface-muted/20 p-6 text-sm text-fg-muted"
    >
      {t('data.analysisPanel.pickDatasetChooseAnalysis')}
    </div>
  )
}

const CHECK_STATUS_LABEL: Record<AssumptionCheck['status'], string> = {
  pass: t('data.analysisPanel.passes'),
  warn: t('data.analysisPanel.warning'),
  fail: t('data.analysisPanel.fails'),
  not_checked: t('data.analysisPanel.notChecked'),
}

const CHECK_STATUS_CLASS: Record<AssumptionCheck['status'], string> = {
  pass: 'text-fg-muted',
  warn: 'text-warning-text',
  fail: 'font-medium text-danger-text',
  not_checked: 'text-fg-muted',
}

function formatP(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'

  return value < 0.001 ? '< 0.001' : formatScientific(value)
}

async function copyMethodsText(result: AnalysisResult): Promise<void> {
  try {
    await navigator.clipboard.writeText(analysisMethodsText(result))
    toast(t('data.analysisPanel.methodsTextCopied'), {
      description: t('data.analysisPanel.pasteIntoNotebookS'),
    })
  } catch {
    toast(t('common.errors.couldNotCopy'), {
      description: t('data.analysisPanel.clipboardRejectedWrite'),
    })
  }
}

/**
 * The method panel: what ran, under which method-definition version and
 * runner, and the statement of what it assumes. A result is never shown
 * without it.
 */
function AnalysisMethodSummary({ result }: { result: AnalysisResult }) {
  return (
    <div className="rounded-md border bg-surface-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{result.method.label}</span>
        <Badge variant="kind">
          {t('data.analysisPanel.methodV')}
          {result.method.version}
        </Badge>
        <span className="font-mono text-xs text-fg-muted">
          {result.method.runner}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void copyMethodsText(result)}
        >
          {t('data.analysisPanel.copyMethodsText')}
        </Button>
      </div>
      <p className="mt-1 text-xs leading-5 text-fg-muted">
        {result.method.statement}
      </p>
    </div>
  )
}

/**
 * Assumption and design checks, in the order the kernel ran them. A failed
 * check is rendered exactly as it came back — never softened, hidden or
 * corrected — and a check that could not be run says `Not checked` rather
 * than claiming a pass.
 */
function AssumptionCheckList({ checks }: { checks: AssumptionCheck[] }) {
  if (checks.length === 0)
    return (
      <p className="text-xs text-fg-muted">
        {t('data.analysisPanel.assumptionsCheckedModelFitted')}
      </p>
    )

  return (
    <div className="rounded-md border p-2">
      <p className="text-xs font-medium text-fg-muted">
        {t('data.analysisPanel.assumptionChecks')}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {checks.map((check) => (
          <li
            key={`${check.group ?? ''}:${check.id}`}
            className="text-xs leading-5"
          >
            <span className={CHECK_STATUS_CLASS[check.status]}>
              {CHECK_STATUS_LABEL[check.status]} ·{' '}
              {check.group
                ? t('data.analysisPanel.group', { group: check.group })
                : ''}
              {check.label}
            </span>
            <span className="block text-fg-muted">{check.detail}</span>
            {check.remedy && check.status !== 'pass' ? (
              <span className="block text-fg-muted">{check.remedy}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DescriptiveResultTables({ result }: { result: DescriptiveResult }) {
  const stats = [
    ['n', (r: (typeof result.rows)[number]) => String(r.stats.n)],
    ['missing', (r: (typeof result.rows)[number]) => String(r.missing)],
    [
      'mean',
      (r: (typeof result.rows)[number]) => formatScientific(r.stats.mean),
    ],
    ['sd', (r: (typeof result.rows)[number]) => formatScientific(r.stats.sd)],
    ['se', (r: (typeof result.rows)[number]) => formatScientific(r.stats.se)],
    ['min', (r: (typeof result.rows)[number]) => formatScientific(r.stats.min)],
    ['q1', (r: (typeof result.rows)[number]) => formatScientific(r.stats.q1)],
    [
      'median',
      (r: (typeof result.rows)[number]) => formatScientific(r.stats.median),
    ],
    ['q3', (r: (typeof result.rows)[number]) => formatScientific(r.stats.q3)],
    ['max', (r: (typeof result.rows)[number]) => formatScientific(r.stats.max)],
  ] as const

  const intervalByGroup = new Map(
    (result.anova?.groups ?? []).map((group) => [group.group, group.ci95]),
  )

  const anova = result.anova

  return (
    <div className="space-y-3">
      <StatGrid
        label={t('data.analysisPanel.descriptiveStatisticsPerGroup')}
        rows={result.rows}
        getRowId={(row) => row.group}
        columns={[
          {
            id: 'group',
            header: t('data.analysisPanel.group2'),
            value: (row) => row.group,
            text: true,
            strong: true,
          },
          ...stats.map(
            ([label, get]): StatColumn<(typeof result.rows)[number]> => ({
              id: label,
              header: label,
              value: get,
              sortBy: (row) => Number(get(row)),
            }),
          ),
          ...(anova
            ? [
                {
                  id: 'ci',
                  header: t('data.analysisPanel.n95CiMean'),
                  value: (row: (typeof result.rows)[number]) => {
                    const interval = intervalByGroup.get(row.group)

                    return interval
                      ? `${formatScientific(interval.lo)} – ${formatScientific(interval.hi)}`
                      : '—'
                  },
                  sortBy: (row: (typeof result.rows)[number]) =>
                    intervalByGroup.get(row.group)?.lo ?? 0,
                },
              ]
            : []),
        ]}
      />
      {anova ? (
        <div className="overflow-auto rounded-md border">
          <StatGrid
            bare
            label={t('data.analysisPanel.oneWayAnovaGroup', {
              value: formatScientific(anova.etaSquared),
            })}
            rows={[
              {
                id: 'between',
                source: t('data.analysisPanel.betweenGroups'),
                ss: formatScientific(anova.ssBetween),
                df: String(anova.dfBetween),
                ms: formatScientific(anova.msBetween),
                f: formatScientific(anova.f),
                p: formatP(anova.p),
              },
              {
                id: 'within',
                source: t('data.analysisPanel.withinGroups'),
                ss: formatScientific(anova.ssWithin),
                df: String(anova.dfWithin),
                ms: formatScientific(anova.msWithin),
                f: '—',
                p: '—',
              },
            ]}
            getRowId={(row) => row.id}
            columns={[
              {
                id: 'source',
                header: t('data.analysisPanel.source'),
                value: (row) => row.source,
                text: true,
                strong: true,
              },
              {
                id: 'ss',
                header: t('data.analysisPanel.ss'),
                value: (row) => row.ss,
              },
              { id: 'df', header: 'df', value: (row) => row.df },
              {
                id: 'ms',
                header: t('data.analysisPanel.ms'),
                value: (row) => row.ms,
              },
              { id: 'f', header: 'F', value: (row) => row.f },
              { id: 'p', header: 'p', value: (row) => row.p },
            ]}
          />
          <p className="border-t px-2 py-1 text-xs text-fg-muted">
            {t('data.analysisPanel.observationsAcrossGroups', {
              value: formatScientific(anova.etaSquared),
              n: anova.n,
              length: anova.groups.length,
            })}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function RegressionResultTables({ result }: { result: RegressionResult }) {
  return (
    <div className="space-y-3">
      <StatGrid
        label={t('data.analysisPanel.regressionFitsPerGroup')}
        rows={result.rows}
        getRowId={(row) => row.group}
        columns={[
          {
            id: 'group',
            header: t('data.analysisPanel.group2'),
            value: (row) => row.group,
            text: true,
            strong: true,
          },
          { id: 'n', header: 'n', value: (row) => row.n },
          { id: 'degree', header: 'degree', value: (row) => row.degree },
          {
            id: 'r2',
            header: 'R²',
            value: (row) => formatScientific(row.r2),
            sortBy: (row) => row.r2,
          },
          {
            id: 'rmse',
            header: t('data.analysisPanel.rmse'),
            value: (row) => formatScientific(row.rmse),
            sortBy: (row) => row.rmse,
          },
          {
            id: 'equation',
            header: t('data.analysisPanel.equation'),
            value: (row) => row.equation,
            text: true,
          },
        ]}
      />
      {result.rows.map((row) => (
        <div key={row.group} className="space-y-1 rounded-md border p-2">
          <p className="text-xs font-medium text-fg-muted">
            {row.group === 'all'
              ? t('data.analysisPanel.terms')
              : t('data.analysisPanel.groupTerms', { group: row.group })}{' '}
            · {row.equation}
          </p>
          <p className="text-xs text-fg-muted">
            {[
              t('data.analysisPanel.adjustedRResidualDf', {
                value: formatScientific(row.adjR2),
                value2: formatScientific(row.sigma),
                dfResidual: row.dfResidual,
              }),
              row.f === null
                ? null
                : t('data.analysisPanel.overallFP', {
                    degree: row.degree,
                    dfResidual: row.dfResidual,
                    value: formatScientific(row.f),
                    value2: formatP(row.fP),
                  }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <StatGrid
            bare
            label={t('data.analysisPanel.modelTermsFittedSpace')}
            rows={row.terms}
            getRowId={(term) => term.term}
            columns={[
              {
                id: 'term',
                header: t('data.analysisPanel.term'),
                value: (term) => term.term,
                text: true,
                strong: true,
              },
              {
                id: 'estimate',
                header: t('data.analysisPanel.estimate'),
                value: (term) => formatScientific(term.estimate),
                sortBy: (term) => term.estimate,
              },
              {
                id: 'se',
                header: t('data.analysisPanel.se'),
                value: (term) => formatScientific(term.se),
                sortBy: (term) => term.se,
              },
              {
                id: 'ci',
                header: t('data.analysisPanel.n95Ci'),
                value: (term) =>
                  term.ci95
                    ? `${formatScientific(term.ci95.lo)} – ${formatScientific(term.ci95.hi)}`
                    : '—',
                sortBy: (term) => term.ci95?.lo ?? 0,
              },
              {
                id: 't',
                header: 't',
                value: (term) => formatScientific(term.t),
                sortBy: (term) => term.t,
              },
              {
                id: 'p',
                header: 'p',
                value: (term) => formatP(term.p),
                sortBy: (term) => term.p,
              },
            ]}
          />
        </div>
      ))}
    </div>
  )
}

const CURVE_PARAMETER_LABEL = {
  A: t('data.analysisPanel.curveParamA'),
  B: t('data.analysisPanel.curveParamB'),
  C: t('data.analysisPanel.curveParamC'),
  D: t('data.analysisPanel.curveParamD'),
  G: t('data.analysisPanel.curveParamG'),
}

const READ_BACK_LABEL: Record<CurveReadBack['status'], string> = {
  in_range: t('data.analysisPanel.readBackInRange'),
  above_range: t('data.analysisPanel.readBackAbove'),
  below_range: t('data.analysisPanel.readBackBelow'),
  off_curve: t('data.analysisPanel.readBackOffCurve'),
}

function CurveResultTables({ result }: { result: CurveResult }) {
  return (
    <div className="space-y-3">
      {result.rows.map((row) => (
        <CurveFitCard
          key={row.group}
          row={row}
          grouped={result.rows.length > 1 || row.group !== 'all'}
        />
      ))}
    </div>
  )
}

function CurveFitCard({
  row,
  grouped,
}: {
  row: CurveFitRow
  grouped: boolean
}) {
  const unknowns = row.readBack.filter((r) => r.role === 'unknown').length

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium">
          {grouped
            ? t('data.analysisPanel.curveFitGroup', { group: row.group })
            : t('data.analysisPanel.curveFit')}
        </p>
        <p className="font-mono text-xs text-fg-muted">{row.equation}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-label text-fg-muted">{row.ecLabel}</dt>
          <dd className="font-mono tabular-nums">
            {formatDose(row.ec50)}
            {row.ec50Ci95 ? (
              <span className="block text-xs text-fg-muted">
                {t('data.analysisPanel.curveCi', {
                  lo: formatDose(row.ec50Ci95.lo),
                  hi: formatDose(row.ec50Ci95.hi),
                })}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-label text-fg-muted">R²</dt>
          <dd className="font-mono tabular-nums">{row.r2.toFixed(4)}</dd>
        </div>
        <div>
          <dt className="text-label text-fg-muted">
            {t('data.analysisPanel.curveStandards')}
          </dt>
          <dd className="font-mono tabular-nums">{row.n}</dd>
        </div>
        <div>
          <dt className="text-label text-fg-muted">
            {t('data.analysisPanel.curveUnknowns')}
          </dt>
          <dd className="font-mono tabular-nums">{unknowns}</dd>
        </div>
      </dl>
      <StatGrid
        bare
        label={t('data.analysisPanel.curveParameters')}
        rows={row.parameters}
        getRowId={(parameter) => parameter.name}
        columns={[
          {
            id: 'term',
            header: t('data.analysisPanel.term'),
            value: (parameter) => CURVE_PARAMETER_LABEL[parameter.name],
            text: true,
            strong: true,
          },
          {
            id: 'estimate',
            header: t('data.analysisPanel.estimate'),
            value: (parameter) => formatDose(parameter.estimate),
            sortBy: (parameter) => parameter.estimate,
          },
          {
            id: 'se',
            header: t('data.analysisPanel.se'),
            value: (parameter) => formatDose(parameter.se),
            sortBy: (parameter) => parameter.se,
          },
          {
            id: 'ci',
            header: t('data.analysisPanel.n95Ci'),
            value: (parameter) =>
              parameter.ci95
                ? `${formatDose(parameter.ci95.lo)} – ${formatDose(parameter.ci95.hi)}`
                : '—',
            sortBy: (parameter) => parameter.ci95?.lo ?? 0,
          },
        ]}
      />
      <StatGrid
        label={t('data.analysisPanel.curveReadBack')}
        maxHeight={320}
        rows={row.readBack}
        // Kernel-ordered rows can repeat a label, so the position is the identity.
        getRowId={(_, index) => String(index)}
        columns={[
          {
            id: 'row',
            header: t('data.analysisPanel.curveRow'),
            value: (item) => item.label ?? '—',
            text: true,
            strong: true,
          },
          {
            id: 'kind',
            header: t('data.analysisPanel.curveKind'),
            value: (item) =>
              item.role === 'standard'
                ? t('data.analysisPanel.curveStandard')
                : t('data.analysisPanel.curveUnknown'),
            text: true,
          },
          {
            id: 'prepared',
            header: t('data.analysisPanel.curvePrepared'),
            value: (item) => formatDose(item.dose),
            sortBy: (item) => item.dose,
          },
          {
            id: 'response',
            header: t('data.analysisPanel.curveResponseShort'),
            value: (item) => formatDose(item.response),
            sortBy: (item) => item.response,
          },
          {
            id: 'dose',
            header: t('data.analysisPanel.curveReadBackDose'),
            value: (item) => formatDose(item.concentration),
            sortBy: (item) => item.concentration ?? 0,
          },
          {
            id: 'recovery',
            header: t('data.analysisPanel.curveRecovery'),
            value: (item) =>
              item.recovery === null ? '—' : `${item.recovery.toFixed(0)}%`,
            sortBy: (item) => item.recovery ?? 0,
          },
          {
            id: 'where',
            header: t('data.analysisPanel.curveWhere'),
            value: (item) => READ_BACK_LABEL[item.status],
            text: true,
            tone: (item) =>
              item.status === 'in_range'
                ? 'text-fg-muted'
                : 'text-warning-text',
          },
        ]}
      />
    </div>
  )
}

export function AnalysisResultTable({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end" data-print-hide>
        <ExplainThis subject="analysis" facts={analysisFacts(result)} />
      </div>
      <AnalysisMethodSummary result={result} />
      {result.kind === 'descriptive' ? (
        <DescriptiveResultTables result={result} />
      ) : result.kind === 'curve' ? (
        <CurveResultTables result={result} />
      ) : result.kind === 'comparison' ? (
        <ComparisonResultTables result={result} />
      ) : result.kind === 'survival' ? (
        <SurvivalResultTables result={result} />
      ) : (
        <RegressionResultTables result={result} />
      )}
      <AssumptionCheckList checks={result.checks} />
    </div>
  )
}
