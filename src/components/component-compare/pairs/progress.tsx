import { Progress } from '#/components/v3/ui/progress'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import { cn } from '#/lib/utils'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair — the horizontal quantity bar.
 *
 * **Ours.** The four renderings the product shipped, reproduced here because the
 * migration replaced them: a correct `progressbar` in the sample hold meter, two
 * `role="img"` bars whose only accessible content is a prose sentence (project
 * approval and the sample volume ledger), and a bare `{n}%` text in the
 * instrument Runs table where the design intent is a bar. Three track heights,
 * three fills, and no shared answer to what a value that is not a number means.
 *
 * **Theirs.** The v3 `Progress`. As with the spinner there is no registry
 * candidate: `progress` is a stock shadcn item, not a ReUI one (`progress.json`
 * 404s on the pinned base-nova registry), and §11.3.1 records that a bare-name
 * install writes into the legacy Radix kit ADR-0055 decision 1 refuses to
 * extend. So the row decides whether one component beats four renderings.
 *
 * Both columns read the fixture's own `value`, which is hostile on purpose:
 * numbers, numeric strings, dates, `NaN`, `null`, high-precision figures and
 * values far past 100.
 *
 * The two columns consume it differently, and that difference is the finding:
 * **each shipped site computed its own percentage** — the hold meter from its
 * own day arithmetic, the approval bar behind a `project.total ? … : 0` guard,
 * the settings bar behind `Math.min(100, Math.max(0, percent))` — so the
 * shipped markup only ever saw a number in range, and nothing owned the
 * contract. The v3 component takes the caller's raw figure, so it has to be
 * robust to one; the harness's high-precision fixture is what proved it was
 * not, and `component-compare.a11y.test.tsx` pins both halves of that
 * measurement.
 */

/** The row's figure as a percentage, and the reading that goes with it. */
function metricFor(row: ComparisonRow): {
  readonly percent: number | null
  readonly reading: string
} {
  const value = row.value
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { percent: null, reading: 'No figure recorded' }
  }
  return { percent: value, reading: `${value} ${row.unit}`.trim() }
}

/** The four shipped renderings, in the order they were found. */
const SHIPPED = [
  {
    site: 'v3/samples/sample-hold-meter.tsx:179-196',
    shape: 'progressbar',
  },
  {
    site: 'v3/home/home-quiet.tsx:281-300',
    shape: 'image',
  },
  {
    site: 'v3/samples/sample-usage.tsx:58-76',
    shape: 'stacked',
  },
  {
    site: 'instruments/$instrumentId.tsx:533-535',
    shape: 'text',
  },
] as const

function shippedFor(row: ComparisonRow) {
  return SHIPPED[Number(row.id.slice(-4)) % SHIPPED.length]
}

/**
 * What each shipped site's own arithmetic produced.
 *
 * Every one of them divided a part by a total — days used over days allowed,
 * experiments approved over experiments in the project, volume used over volume
 * registered — clamped the result, and handed the markup a **whole percent**
 * (`Math.round(percent)` at the hold meter, the approval bar and the settings
 * bar alike). The fixture's column maximum stands in for the total, so this is
 * the same arithmetic on the same hostile figures; that rounding is also why
 * the shipped markup never had to render a figure ARIA cannot express.
 */
function shippedPercent(row: ComparisonRow, total: number): number | null {
  const { percent } = metricFor(row)
  if (percent === null) return null
  return Math.round(Math.min(100, Math.max(0, (percent / total) * 100)))
}

/** The column's own total: the largest figure any row in the fixture reports. */
function columnTotal(rows: readonly ComparisonRow[]): number {
  return Math.max(
    1,
    ...rows.map((row) =>
      typeof row.value === 'number' && Number.isFinite(row.value)
        ? row.value
        : 0,
    ),
  )
}

function ProgressOursColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const total = columnTotal(rows)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-1" data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row) => {
        const shipped = shippedFor(row)
        const { reading } = metricFor(row)
        const percent = shippedPercent(row, total)
        return (
          <div
            key={row.id}
            data-row-id={row.id}
            data-shape={shipped.shape}
            className="flex min-w-0 items-center gap-3 rounded-md border border-transparent px-3 py-2"
          >
            <span className="w-40 min-w-0 shrink-0 truncate text-body">
              {row.name}
            </span>
            <div className="min-w-0 flex-1">
              {percent === null && shipped.shape !== 'text' ? (
                <span className="text-label text-fg-muted">
                  No figure to draw
                </span>
              ) : shipped.shape === 'progressbar' ? (
                // The hold meter's own markup: a real progressbar, but its
                // arithmetic is the caller's — a value that is not a number
                // reaches `width` as `NaN%`.
                <div
                  role="progressbar"
                  aria-label="Hold time used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? 0}
                  className="h-1.5 overflow-hidden rounded-full bg-skeleton"
                >
                  <div
                    className={cn('h-1.5', 'bg-fg-muted')}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              ) : shipped.shape === 'image' ? (
                // The approval bar: a sentence where a value belongs.
                <div
                  role="img"
                  aria-label={reading}
                  className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
                >
                  <div
                    className="h-full rounded-full bg-success"
                    style={{ width: `${percent ?? 0}%` }}
                  />
                </div>
              ) : shipped.shape === 'stacked' ? (
                // The volume ledger: two segments of one bar.
                <div
                  role="img"
                  aria-label={reading}
                  className="flex h-2.5 overflow-hidden rounded-sm bg-skeleton"
                >
                  <div
                    style={{ width: `${percent === null ? 0 : 60}%` }}
                    className="bg-fg-muted"
                  />
                  <div
                    style={{ width: `${percent === null ? 0 : 25}%` }}
                    className="bg-selection-border"
                  />
                </div>
              ) : (
                <span className="text-label text-fg-muted">
                  {percent === null ? '—' : `${percent}%`}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProgressTheirsColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  // The same scale as the shipped column: each row's share of the column's own
  // total, as a percentage. The component is handed the raw figure and reports
  // what its bar can draw, so a figure that is not a number is indeterminate
  // rather than a width of `NaN%`.
  //
  // The share is used rather than the raw figure against the column total
  // because the fixture's total is Avogadro's number, and a scale whose own
  // value stringifies exponentially is not one ARIA can express. That limit is
  // recorded in the comparison record's row 3.
  const total = columnTotal(rows)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-1" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row) => {
        const { percent, reading } = metricFor(row)
        return (
          <div
            key={row.id}
            data-row-id={row.id}
            className="flex min-w-0 items-center gap-3 rounded-md border border-transparent px-3 py-2"
          >
            <span className="w-40 min-w-0 shrink-0 truncate text-body">
              {row.name}
            </span>
            <div className="min-w-0 flex-1">
              <Progress
                label={reading}
                value={percent === null ? null : (percent / total) * 100}
                valueText={reading}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const progressPair: ComparisonPair = {
  id: 'progress',
  title: 'Horizontal quantity bar',
  job: 'Show one value against its maximum',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — four renderings, three fills',
    source:
      'v3/samples/sample-hold-meter.tsx, v3/home/home-quiet.tsx, v3/samples/sample-usage.tsx, routes/instruments/$instrumentId.tsx, routes/settings/usage.tsx',
    Column: ProgressOursColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — v3 Progress (in-house; no admissible registry item)',
    source: 'src/components/v3/ui/progress.tsx',
    Column: ProgressTheirsColumn,
  },
}
