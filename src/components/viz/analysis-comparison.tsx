/**
 * Analysis Studio, comparison and survival: the controls that set them up and
 * the tables and survival plot that show what they found.
 */
import { Select } from '#/components/ui/select'
import { Input } from '#/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import {
  COMPARISON_POST_HOCS,
  COMPARISON_TESTS,
} from '#/lib/analysis-definition'
import type {
  AnalysisDefinition,
  ComparisonDefinition,
  ComparisonPair,
  ComparisonResult,
  SurvivalDefinition,
  SurvivalResult,
} from '#/lib/analysis-definition'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { formatScientific } from '#/lib/chart-spec'

type ColumnOption = { id: string; label: string }

function Options({ columns }: { columns: ColumnOption[] }) {
  return columns.map((c) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  ))
}

function Control({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-1">
      <label className="text-label text-fg-muted" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  )
}

function columnsOf(table: CanonicalDatasetSource) {
  return {
    numeric: table.columns.filter((c) =>
      ['decimal', 'integer'].includes(c.logicalType),
    ),
    category: table.columns.filter((c) =>
      ['category', 'text', 'boolean', 'integer'].includes(c.logicalType),
    ),
  }
}

export function ComparisonControls({
  definition,
  table,
  onChange,
}: {
  definition: ComparisonDefinition
  table: CanonicalDatasetSource
  onChange: (patch: Partial<AnalysisDefinition>) => void
}) {
  const { numeric, category } = columnsOf(table)
  const test = definition.test ?? 'welch'
  const postHoc = definition.postHoc ?? 'tukey'

  const bind = (key: 'value' | 'group' | 'pair', fieldId: string) =>
    onChange({
      [key]: fieldId ? { fieldId } : key === 'pair' ? null : undefined,
    })

  return (
    <>
      <Control id="cmp-value" label={t('data.analysisPanel.measuredValue')}>
        <Select
          id="cmp-value"
          size="sm"
          value={definition.value.fieldId}
          onChange={(e) => bind('value', e.target.value)}
          className="bg-surface"
        >
          <Options columns={numeric} />
        </Select>
      </Control>
      <Control id="cmp-group" label={t('data.analysisPanel.comparedGroups')}>
        <Select
          id="cmp-group"
          size="sm"
          value={definition.group.fieldId}
          onChange={(e) => bind('group', e.target.value)}
          className="bg-surface"
        >
          <Options columns={category} />
        </Select>
      </Control>
      <Control id="cmp-test" label={t('data.analysisPanel.comparisonTest')}>
        <Select
          id="cmp-test"
          size="sm"
          value={test}
          onChange={(e) =>
            onChange({
              test: e.target.value as (typeof COMPARISON_TESTS)[number],
            })
          }
          className="bg-surface"
        >
          {COMPARISON_TESTS.map((k) => (
            <option key={k} value={k}>
              {t(`data.analysisPanel.comparisonTests.${k}`)}
            </option>
          ))}
        </Select>
      </Control>
      {test === 'anova' ? (
        <Control id="cmp-posthoc" label={t('data.analysisPanel.postHoc')}>
          <Select
            id="cmp-posthoc"
            size="sm"
            value={postHoc}
            onChange={(e) =>
              onChange({
                postHoc: e.target
                  .value as (typeof COMPARISON_POST_HOCS)[number],
              })
            }
            className="bg-surface"
          >
            {COMPARISON_POST_HOCS.map((k) => (
              <option key={k} value={k}>
                {t(`data.analysisPanel.postHocs.${k}`)}
              </option>
            ))}
          </Select>
        </Control>
      ) : null}
      {test === 'anova' && postHoc === 'dunnett' ? (
        <Control id="cmp-control" label={t('data.analysisPanel.controlGroup')}>
          <Input
            id="cmp-control"
            value={definition.control ?? ''}
            placeholder={t('data.analysisPanel.controlGroupFirst')}
            onChange={(e) => onChange({ control: e.target.value || null })}
          />
        </Control>
      ) : null}
      {test === 'paired' ? (
        <Control id="cmp-pair" label={t('data.analysisPanel.subjectColumn')}>
          <Select
            id="cmp-pair"
            size="sm"
            value={definition.pair?.fieldId ?? ''}
            onChange={(e) => bind('pair', e.target.value)}
            className="bg-surface"
          >
            <option value="">{t('data.analysisPanel.chooseColumn')}</option>
            <Options columns={table.columns} />
          </Select>
        </Control>
      ) : null}
      <Control id="cmp-alpha" label={t('data.analysisPanel.alpha')}>
        <Input
          id="cmp-alpha"
          inputMode="decimal"
          value={String(definition.alpha ?? 0.05)}
          onChange={(e) => {
            const n = Number(e.target.value)

            if (n > 0 && n < 1) onChange({ alpha: n })
          }}
        />
      </Control>
    </>
  )
}

export function SurvivalControls({
  definition,
  table,
  onChange,
}: {
  definition: SurvivalDefinition
  table: CanonicalDatasetSource
  onChange: (patch: Partial<AnalysisDefinition>) => void
}) {
  const { numeric, category } = columnsOf(table)

  return (
    <>
      <Control id="surv-time" label={t('data.analysisPanel.survivalTime')}>
        <Select
          id="surv-time"
          size="sm"
          value={definition.time.fieldId}
          onChange={(e) => onChange({ time: { fieldId: e.target.value } })}
          className="bg-surface"
        >
          <Options columns={numeric} />
        </Select>
      </Control>
      <Control id="surv-event" label={t('data.analysisPanel.survivalEvent')}>
        <Select
          id="surv-event"
          size="sm"
          value={definition.event.fieldId}
          onChange={(e) => onChange({ event: { fieldId: e.target.value } })}
          className="bg-surface"
        >
          <Options columns={table.columns} />
        </Select>
      </Control>
      <Control id="surv-group" label={t('data.analysisPanel.groupOptional')}>
        <Select
          id="surv-group"
          size="sm"
          value={definition.group?.fieldId ?? ''}
          onChange={(e) =>
            onChange({
              group: e.target.value ? { fieldId: e.target.value } : null,
            })
          }
          className="bg-surface"
        >
          <option value="">{t('data.analysisPanel.oneGroup')}</option>
          <Options columns={category} />
        </Select>
      </Control>
      <p className="basis-full text-label text-fg-muted">
        {t('data.analysisPanel.survivalHint')}
      </p>
    </>
  )
}

const num = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : formatScientific(v)

function pText(pair: ComparisonPair): string {
  return pair.p < 0.001 ? '< 0.001' : formatScientific(pair.p)
}

export function ComparisonResultTables({
  result,
}: {
  result: ComparisonResult
}) {
  const showDiff = result.pairs.some((p) => p.difference !== null)
  const effectLabel = result.pairs.find((p) => p.effectLabel)?.effectLabel

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.comparisonGroupsCaption')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.group2')}
              </TableHead>
              <TableHead scope="col">n</TableHead>
              <TableHead scope="col">mean</TableHead>
              <TableHead scope="col">sd</TableHead>
              <TableHead scope="col">median</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.groups.map((g) => (
              <TableRow key={g.group}>
                <TableCell className="font-medium">{g.group}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {g.stats.n}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {num(g.stats.mean)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {num(g.stats.sd)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {num(g.stats.median)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {result.omnibus ? (
        <p className="text-label text-fg-muted">
          {t('data.analysisPanel.omnibus', {
            dfBetween: result.omnibus.dfBetween,
            dfWithin: result.omnibus.dfWithin,
            f: num(result.omnibus.f),
            p: result.omnibus.p < 0.001 ? '< 0.001' : num(result.omnibus.p),
          })}
        </p>
      ) : null}
      {result.pairedSubjects !== null ? (
        <p className="text-label text-fg-muted">
          {t('data.analysisPanel.pairedSubjects', {
            count: result.pairedSubjects,
          })}
        </p>
      ) : null}
      {result.pairs.length > 0 ? (
        <div className="overflow-auto rounded-md border">
          <Table>
            <caption className="sr-only">
              {t('data.analysisPanel.comparisonPairsCaption')}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  {t('data.analysisPanel.comparison')}
                </TableHead>
                {showDiff ? (
                  <>
                    <TableHead scope="col">
                      {t('data.analysisPanel.difference')}
                    </TableHead>
                    <TableHead scope="col">
                      {t('data.analysisPanel.n95Ci')}
                    </TableHead>
                  </>
                ) : null}
                <TableHead scope="col">
                  {t('data.analysisPanel.statistic')}
                </TableHead>
                <TableHead scope="col">
                  {result.pairs[0].adjusted
                    ? t('data.analysisPanel.pAdjusted')
                    : 'p'}
                </TableHead>
                {effectLabel ? (
                  <TableHead scope="col">
                    {t(`data.analysisPanel.effects.${effectLabel}`)}
                  </TableHead>
                ) : null}
                <TableHead scope="col">
                  {t('data.analysisPanel.significantAt', {
                    alpha: result.alpha,
                  })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.pairs.map((pair) => (
                <TableRow key={`${pair.group1}|${pair.group2}`}>
                  <TableCell className="font-medium">
                    {pair.group1} – {pair.group2}
                  </TableCell>
                  {showDiff ? (
                    <>
                      <TableCell className="font-mono tabular-nums">
                        {num(pair.difference)}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {pair.ci95
                          ? `${num(pair.ci95.lo)} – ${num(pair.ci95.hi)}`
                          : '—'}
                      </TableCell>
                    </>
                  ) : null}
                  <TableCell className="font-mono tabular-nums">
                    {pair.statisticLabel} = {num(pair.statistic)}
                    {pair.df !== null
                      ? ` (${formatScientific(pair.df)} df)`
                      : ''}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {pText(pair)}
                  </TableCell>
                  {effectLabel ? (
                    <TableCell className="font-mono tabular-nums">
                      {num(pair.effectSize)}
                    </TableCell>
                  ) : null}
                  <TableCell
                    className={
                      pair.significant ? 'font-medium text-fg' : 'text-fg-muted'
                    }
                  >
                    {pair.significant
                      ? t('data.analysisPanel.yes')
                      : t('data.analysisPanel.no')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}

const SURVIVAL_COLOURS = [
  'var(--primary)',
  'var(--warning)',
  'var(--success)',
  'var(--danger)',
  'var(--info)',
  'var(--fg-muted)',
]

const W = 960
const H = 340
const PAD = { left: 52, right: 14, top: 12, bottom: 58 }

/** Kaplan–Meier curves as step lines with a faint band, and tick marks for censoring. */
export function SurvivalPlot({ result }: { result: SurvivalResult }) {
  const max = result.maxTime > 0 ? result.maxTime : 1
  const px = (x: number) => PAD.left + (x / max) * (W - PAD.left - PAD.right)
  const py = (y: number) => PAD.top + (1 - y) * (H - PAD.top - PAD.bottom)

  return (
    <svg
      role="img"
      aria-label={t('data.analysisPanel.survivalPlotLabel')}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full text-fg-muted"
    >
      <title>{t('data.analysisPanel.survivalPlotLabel')}</title>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={py(v)}
            y2={py(v)}
            stroke="currentColor"
            strokeOpacity={0.15}
          />
          <text
            x={PAD.left - 6}
            y={py(v) + 3}
            textAnchor="end"
            fontSize={13}
            fill="currentColor"
          >
            {v}
          </text>
        </g>
      ))}
      <text x={PAD.left} y={H - 38} fontSize={13} fill="currentColor">
        0
      </text>
      <text
        x={W - PAD.right}
        y={H - 38}
        fontSize={13}
        textAnchor="end"
        fill="currentColor"
      >
        {formatScientific(max)}
      </text>
      {result.curves.map((curve, i) => {
        const colour = SURVIVAL_COLOURS[i % SURVIVAL_COLOURS.length]
        let d = `M${px(0)},${py(1)}`
        let band = ''
        let prev = 1
        let prevHi = 1
        let prevLo = 1
        const upper: string[] = [`${px(0)},${py(1)}`]
        const lower: string[] = [`${px(0)},${py(1)}`]

        for (const step of curve.steps) {
          d += ` L${px(step.time)},${py(prev)} L${px(step.time)},${py(step.survival)}`
          upper.push(
            `${px(step.time)},${py(prevHi)}`,
            `${px(step.time)},${py(step.hi)}`,
          )
          lower.push(
            `${px(step.time)},${py(prevLo)}`,
            `${px(step.time)},${py(step.lo)}`,
          )
          prev = step.survival
          prevHi = step.hi
          prevLo = step.lo
        }

        d += ` L${px(max)},${py(prev)}`
        band = `M${upper.join(' L')} L${px(max)},${py(curve.steps.at(-1)?.hi ?? 1)} L${px(max)},${py(curve.steps.at(-1)?.lo ?? 1)} L${lower.reverse().join(' L')} Z`

        return (
          <g key={curve.group}>
            <path d={band} fill={colour} fillOpacity={0.12} stroke="none" />
            <path d={d} fill="none" stroke={colour} strokeWidth={2} />
            {curve.steps
              .filter((s) => s.censored > 0)
              .map((s) => (
                <line
                  key={s.time}
                  x1={px(s.time)}
                  x2={px(s.time)}
                  y1={py(s.survival) - 4}
                  y2={py(s.survival) + 4}
                  stroke={colour}
                  strokeWidth={1.5}
                />
              ))}
          </g>
        )
      })}
      <g fontSize={14}>
        {result.curves.map((curve, i) => (
          <g
            key={curve.group}
            transform={`translate(${PAD.left + 8 + i * 150}, ${H - 10})`}
          >
            <rect
              width={10}
              height={10}
              y={-9}
              rx={2}
              fill={SURVIVAL_COLOURS[i % SURVIVAL_COLOURS.length]}
            />
            <text x={14} fill="currentColor">
              {curve.group}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

export function SurvivalResultTables({ result }: { result: SurvivalResult }) {
  return (
    <div className="space-y-3">
      <SurvivalPlot result={result} />
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            {t('data.analysisPanel.survivalCaption')}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {t('data.analysisPanel.group2')}
              </TableHead>
              <TableHead scope="col">n</TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.events')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.censored')}
              </TableHead>
              <TableHead scope="col">
                {t('data.analysisPanel.medianSurvival')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.curves.map((c) => (
              <TableRow key={c.group}>
                <TableCell className="font-medium">{c.group}</TableCell>
                <TableCell className="font-mono tabular-nums">{c.n}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {c.events}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {c.censored}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {c.medianSurvival === null
                    ? t('data.analysisPanel.notReached')
                    : num(c.medianSurvival)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {result.logRank ? (
        <p className="text-label text-fg-muted">
          {t('data.analysisPanel.logRank', {
            chi: num(result.logRank.chiSquare),
            df: result.logRank.df,
            p: result.logRank.p < 0.001 ? '< 0.001' : num(result.logRank.p),
          })}
          {result.logRank.hazardRatio
            ? ` ${t('data.analysisPanel.hazardRatio', {
                hr: num(result.logRank.hazardRatio.hr),
                lo: num(result.logRank.hazardRatio.lo),
                hi: num(result.logRank.hazardRatio.hi),
              })}`
            : ''}
        </p>
      ) : null}
    </div>
  )
}
