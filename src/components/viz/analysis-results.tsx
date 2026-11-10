import { t } from '#/copy'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.descriptiveStatisticsPerGroup')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.group2')}
              </TableHead>
              {stats.map(([label]) => (
                <TableHead key={label} scope="col">
                  {label}
                </TableHead>
              ))}
              {anova ? (
                <TableHead scope="col">
                  {t('data.analysisPanel.n95CiMean')}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => {
              const interval = intervalByGroup.get(row.group)

              return (
                <TableRow key={row.group}>
                  <TableCell className="font-medium">{row.group}</TableCell>
                  {stats.map(([label, get]) => (
                    <TableCell key={label} className="font-mono tabular-nums">
                      {get(row)}
                    </TableCell>
                  ))}
                  {anova ? (
                    <TableCell className="font-mono tabular-nums">
                      {interval
                        ? `${formatScientific(interval.lo)} – ${formatScientific(interval.hi)}`
                        : '—'}
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {anova ? (
        <div className="overflow-auto rounded-md border">
          <Table>
            <caption className="sr-only">
              {t('data.analysisPanel.oneWayAnovaGroup', {
                value: formatScientific(anova.etaSquared),
              })}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  {t('data.analysisPanel.source')}
                </TableHead>
                <TableHead scope="col">{t('data.analysisPanel.ss')}</TableHead>
                <TableHead scope="col">df</TableHead>
                <TableHead scope="col">{t('data.analysisPanel.ms')}</TableHead>
                <TableHead scope="col">F</TableHead>
                <TableHead scope="col">p</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">
                  {t('data.analysisPanel.betweenGroups')}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.ssBetween)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {anova.dfBetween}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.msBetween)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.f)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatP(anova.p)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">
                  {t('data.analysisPanel.withinGroups')}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.ssWithin)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {anova.dfWithin}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(anova.msWithin)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">—</TableCell>
                <TableCell className="font-mono tabular-nums">—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
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
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.regressionFitsPerGroup')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.group2')}
              </TableHead>
              <TableHead scope="col">n</TableHead>
              <TableHead scope="col">degree</TableHead>
              <TableHead scope="col">R²</TableHead>
              <TableHead scope="col">{t('data.analysisPanel.rmse')}</TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.equation')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.group}>
                <TableCell className="font-medium">{row.group}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.n}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.degree}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(row.r2)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatScientific(row.rmse)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.equation}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
          <div className="overflow-auto">
            <Table>
              <caption className="sr-only">
                {t('data.analysisPanel.modelTermsFittedSpace')}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {t('data.analysisPanel.term')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('data.analysisPanel.estimate')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('data.analysisPanel.se')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('data.analysisPanel.n95Ci')}
                  </TableHead>
                  <TableHead scope="col">t</TableHead>
                  <TableHead scope="col">p</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.terms.map((term) => (
                  <TableRow key={term.term}>
                    <TableCell className="font-medium">{term.term}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatScientific(term.estimate)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatScientific(term.se)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {term.ci95
                        ? `${formatScientific(term.ci95.lo)} – ${formatScientific(term.ci95.hi)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatScientific(term.t)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatP(term.p)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
      <div className="overflow-auto">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.curveParameters')}
          </caption>
          <TableHeader>
            <TableRow>
              {[
                t('data.analysisPanel.term'),
                t('data.analysisPanel.estimate'),
                t('data.analysisPanel.se'),
                t('data.analysisPanel.n95Ci'),
              ].map((label) => (
                <TableHead key={label} scope="col">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.parameters.map((parameter) => (
              <TableRow key={parameter.name}>
                <TableCell className="font-medium">
                  {CURVE_PARAMETER_LABEL[parameter.name]}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDose(parameter.estimate)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDose(parameter.se)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {parameter.ci95
                    ? `${formatDose(parameter.ci95.lo)} – ${formatDose(parameter.ci95.hi)}`
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.curveReadBack')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.curveRow')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.curveKind')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.curvePrepared')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.curveResponseShort')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.curveReadBackDose')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.curveRecovery')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.curveWhere')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.readBack.map((item, index) => (
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Immutable kernel-ordered text rows permit identical and null-labelled replicates and have no row-local state.
              <TableRow key={index}>
                <TableCell className="font-medium">
                  {item.label ?? '—'}
                </TableCell>
                <TableCell>
                  {item.role === 'standard'
                    ? t('data.analysisPanel.curveStandard')
                    : t('data.analysisPanel.curveUnknown')}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDose(item.dose)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDose(item.response)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatDose(item.concentration)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {item.recovery === null
                    ? '—'
                    : `${item.recovery.toFixed(0)}%`}
                </TableCell>
                <TableCell
                  className={
                    item.status === 'in_range'
                      ? 'text-fg-muted'
                      : 'text-warning-text'
                  }
                >
                  {READ_BACK_LABEL[item.status]}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
