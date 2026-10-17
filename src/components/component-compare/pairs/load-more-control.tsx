import * as React from 'react'

import { Button } from '#/components/v3/ui/button'
import { LoadMore } from '#/components/v3/ui/load-more'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
} from '#/components/component-compare/types'

/**
 * Pair — extending a list that reads a page at a time.
 *
 * Ours: `src/components/v3/ui/load-more.tsx`, the one control this change
 * leaves behind. Six screens carried their own before it, with five labels
 * between them, no landmark anywhere, and a button whose count was spelled
 * three ways.
 *
 * Theirs: the deleted spellings, kept here as the shipped code so the
 * comparison survives the deletion — the search button (plain, "Loading…"), the
 * dataset-rows button ("Load more (N left)"), the compare button with the same
 * label, the experiments footer's small quiet button, and the audit log's tail,
 * which offered no control at all until the next page was already in flight and
 * so had no keyboard path to older entries.
 */

/** Small enough that the fixtures' handfuls of rows exercise it. */
const PAGE = 4

/** Ours: the shipped control, in each state the screens put it in. */
function OurLoadMoreColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [loaded, setLoaded] = React.useState(Math.min(PAGE, rows.length))
  const loading = scenario.state === 'loading'
  const total = rows.length
  const hasMore = loaded < total

  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-3" data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      <LoadMore
        label="Comparison changes"
        loaded={loaded}
        total={total}
        noun="changes"
        hasMore={hasMore}
        loading={loading}
        onLoadMore={() =>
          setLoaded((current) => Math.min(current + PAGE, total))
        }
        endLabel={
          scenario.state === 'ready' && !hasMore
            ? 'End of the log — every matching entry is loaded.'
            : undefined
        }
      />
    </div>
  )
}

/** Theirs: the four spellings that were deleted, as they shipped. */
function HandRolledLoadMoreColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [loaded, setLoaded] = React.useState(Math.min(PAGE, rows.length))
  const loading = scenario.state === 'loading'
  const total = rows.length
  const hasMore = loaded < total
  const load = () => setLoaded((current) => Math.min(current + PAGE, total))

  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-3" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}

      {/* search.tsx */}
      {hasMore ? (
        <div className="mt-1">
          <Button onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      {/* datasets/$datasetId/rows.tsx: "Showing N of M rows" + a count in the
          button, with a note about what the window means. */}
      <div className="num flex flex-col gap-2 py-2 text-label text-fg-muted">
        <span>
          Showing {loaded} of {total} rows
          {hasMore ? ` (${loaded} loaded so far)` : ''}
        </span>
        {hasMore ? (
          <>
            <span className="font-sans">
              Search and the flagged filter look at the rows loaded so far.
            </span>
            <div>
              <Button size="sm" onClick={load} disabled={loading}>
                {loading
                  ? 'Loading…'
                  : `Load more (${Math.max(total - loaded, 0)} left)`}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {/* experiments.tsx: the footer bar's small quiet button. */}
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
        <span>
          {loaded} of {total}
          {hasMore ? ` · ${loaded} loaded` : ''} · filtered to last 30 days
        </span>
        {hasMore ? (
          <Button
            size="sm"
            variant="quiet"
            className="ml-auto"
            disabled={loading}
            onClick={load}
          >
            Load more
          </Button>
        ) : null}
      </div>

      {/* settings/audit.tsx: the tail of the log, which had a scroll trigger
          and a retry but no control to reach older entries with. */}
      {rows.length > 0 ? (
        <div className="text-label text-fg-muted">
          {loading ? 'Loading older entries…' : null}
          {!loading && hasMore ? 'Scroll for older entries' : null}
          {!hasMore ? (
            <span>End of the log — every matching entry is loaded.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const loadMoreControlPair: ComparisonPair = {
  id: 'load-more-control',
  title: 'Growing-window list control',
  job: 'Read the next page of a list that grows rather than being paged',
  controls: ['pagination'],
  ours: {
    id: 'ours',
    label: 'Ours — v3 LoadMore (one control, one label, one count)',
    source: 'src/components/v3/ui/load-more.tsx',
    Column: OurLoadMoreColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — the four hand-rolled controls this change deleted',
    source:
      'routes/search.tsx, routes/datasets/$datasetId/{rows,compare}.tsx, routes/experiments.tsx, routes/settings/audit.tsx (as shipped)',
    Column: HandRolledLoadMoreColumn,
  },
}
