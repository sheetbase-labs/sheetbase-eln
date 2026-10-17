import { Banner, Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
} from '#/components/component-compare/types'

/**
 * Pair — inline notice and page-strip banner chrome.
 *
 * Ours: the v3 pair `Notice`/`Banner` (`src/components/v3/ui/alert.tsx`),
 * which sixteen files outside the kit already compose and which this change
 * brings six hand-rolled chromes onto. `Notice` is a local message beside what
 * it describes (tone `info`/`warn`/`bad`, 14px icon, title, action slot);
 * `Banner` is the page-wide strip under the header, with a `review` tone and
 * the strip's own padding. Both derive `role` from the tone — `alert` for
 * `bad`, `status` otherwise — and take pass-through attributes so a caller can
 * keep its own test hooks.
 *
 * Theirs: `@reui/alert`, reproduced here from the registry item (base-nova
 * pin) restyled to Sheetbase tokens, as an adoption would require. It is a
 * reproduction, not a vendored copy, because the decision is to decline it —
 * the item is not added to the repository. The published anatomy: a
 * `grid-cols-[0_1fr]` box with a `has-[>svg]` icon column, `AlertTitle`,
 * `AlertDescription` and an `AlertAction` cell, and variants
 * `default | destructive | info | success | warning | invert` on classes such
 * as `bg-card text-card-foreground` and `border-destructive/30 bg-destructive/4`.
 * It carries `role="alert"` unconditionally, on every variant.
 *
 * The rows are the same fixture in both columns: the notice states the
 * fixture's hostility and row count, and the banner states the same figure as
 * a page strip. Neither side has a control, so the pair declares no control
 * classes and the checklist's sort/filter/select/resize/pagination items are
 * recorded as not applicable.
 */

function FixtureSummary({
  scenario,
  where,
}: ComparisonColumnProps & { where: string }) {
  const { fixture } = scenario
  return (
    <span>
      {fixture.hostility} · {fixture.rows.length}{' '}
      {fixture.rows.length === 1 ? 'row' : 'rows'} {where}
    </span>
  )
}

/** Ours: the v3 pair. */
function NoticeBannerColumn({ scenario }: ComparisonColumnProps) {
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div className="flex flex-col gap-3" data-comparison-list="ours">
      <Banner tone="info" title="Live stream reconnected.">
        <FixtureSummary
          scenario={scenario}
          where="came through while offline."
        />
      </Banner>
      <Notice
        tone="bad"
        className="rounded-md"
        title="Could not load the record history."
        action={
          <Button variant="secondary" size="sm" onClick={scenario.onRetry}>
            Try again
          </Button>
        }
      >
        <FixtureSummary scenario={scenario} where="are still on this device." />
      </Notice>
      <Notice tone="warn" icon="lock" title="View only">
        Changing this fixture needs editor access on this workspace.
      </Notice>
      <Banner tone="warn" title="You're offline.">
        Edits are saved on this device and sync when you reconnect.
      </Banner>
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
    </div>
  )
}

/** Theirs: the published ReUI alert, restyled, as an adoption would ship it. */
function ReuiAlertColumn({ scenario }: ComparisonColumnProps) {
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div className="flex flex-col gap-3" data-comparison-list="theirs">
      <div
        data-slot="alert"
        role="alert"
        className="grid w-full grid-cols-[0_1fr] items-center gap-y-0.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*3)_1fr] has-[>svg]:gap-x-2.5"
      >
        <div
          data-slot="alert-title"
          className="col-start-2 min-h-4 font-medium tracking-tight"
        >
          Live stream reconnected.
        </div>
        <div
          data-slot="alert-description"
          className="col-start-2 grid justify-items-start gap-1 text-sm text-fg-muted"
        >
          <FixtureSummary
            scenario={scenario}
            where="came through while offline."
          />
        </div>
      </div>
      <div
        data-slot="alert"
        role="alert"
        className="grid w-full grid-cols-[0_1fr] items-center gap-y-0.5 rounded-lg border border-destructive/30 bg-destructive/4 px-3 py-2.5 text-sm"
      >
        <div
          data-slot="alert-title"
          className="col-start-2 min-h-4 font-medium tracking-tight"
        >
          Could not load the record history.
        </div>
        <div
          data-slot="alert-description"
          className="col-start-2 grid justify-items-start gap-1 text-sm text-fg-muted"
        >
          <FixtureSummary
            scenario={scenario}
            where="are still on this device."
          />
        </div>
        <div
          data-slot="alert-action"
          className="flex gap-1.5 sm:col-start-3 sm:row-start-1 sm:self-center sm:justify-end"
        >
          <Button variant="secondary" size="sm" onClick={scenario.onRetry}>
            Try again
          </Button>
        </div>
      </div>
      <div
        data-slot="alert"
        role="alert"
        className="grid w-full grid-cols-[0_1fr] items-center gap-y-0.5 rounded-lg border border-warning/30 bg-warning/4 px-3 py-2.5 text-sm"
      >
        <div
          data-slot="alert-title"
          className="col-start-2 min-h-4 font-medium tracking-tight"
        >
          View only
        </div>
        <div
          data-slot="alert-description"
          className="col-start-2 grid justify-items-start gap-1 text-sm text-fg-muted"
        >
          Changing this fixture needs editor access on this workspace.
        </div>
      </div>
      <div
        data-slot="alert"
        role="alert"
        className="grid w-full grid-cols-[0_1fr] items-center gap-y-0.5 border-b border-warning-border bg-warning-wash px-6 py-2 text-label"
      >
        <div
          data-slot="alert-title"
          className="col-start-2 min-h-4 font-medium tracking-tight"
        >
          You're offline.
        </div>
        <div
          data-slot="alert-description"
          className="col-start-2 grid justify-items-start gap-1 text-label text-fg-muted"
        >
          Edits are saved on this device and sync when you reconnect.
        </div>
      </div>
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
    </div>
  )
}

export const noticeBannerPair: ComparisonPair = {
  id: 'notice-banner',
  title: 'Notice and banner chrome',
  job: 'Show an inline notice or a page-wide state strip',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — v3 Notice and Banner',
    source: 'src/components/v3/ui/alert.tsx',
    Column: NoticeBannerColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — ReUI alert (reproduced, restyled; declined)',
    source: 'registry item @reui/alert at the base-nova pin (reproduced here)',
    Column: ReuiAlertColumn,
  },
}
