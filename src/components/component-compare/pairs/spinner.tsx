import { Loader2, RefreshCw } from 'lucide-react'

import { Icon } from '#/components/v3/icons'
import { Spinner } from '#/components/v3/ui/spinner'
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
 * Pair — the working indicator.
 *
 * **Ours.** The six spellings the product shipped, reproduced here because the
 * migration deleted them: a spin on whichever glyph the host happened to import
 * (`Loader2`, `RefreshCw`, our own `clock` and `move`), at whichever size the
 * host's class asked for, in whichever tone the surrounding text set. A spinner
 * has no data of its own, so the fixture supplies the text it sits beside and
 * the row index cycles the spellings deterministically — which is what makes
 * the drift visible: two of the six spin a *semantically different* glyph (a
 * clock for saving, a movement glyph for retrying) to mean the same thing.
 *
 * **Theirs.** The v3 `Spinner`. There is no registry candidate to compare
 * against: `spinner` is a stock shadcn item, not a ReUI one (`spinner.json`
 * 404s on the pinned base-nova registry), and §11.3.1 records that a bare-name
 * install writes into the legacy Radix kit that ADR-0055 decision 1 refuses to
 * extend. So the candidate for this row is the in-house component, and what the
 * row decides is whether one indicator beats six spellings.
 */

/** The six shipped spellings, in the order they were found. */
const SHIPPED: ReadonlyArray<{
  /** Where it shipped. */
  readonly site: string
  /** The text that shipped beside it. */
  readonly label: string
  readonly render: () => React.ReactNode
}> = [
  {
    site: 'live/connection-status.tsx:43',
    label: 'Connecting…',
    render: () => (
      <Loader2
        className="size-3 animate-spin text-fg-muted"
        aria-hidden="true"
      />
    ),
  },
  {
    site: 'live/connection-status.tsx:54',
    label: 'Reconnecting…',
    render: () => (
      <RefreshCw
        className="size-3 animate-spin text-warning-text"
        aria-hidden="true"
      />
    ),
  },
  {
    site: 'offline/offline-banner.tsx:76',
    label: 'Retrying…',
    render: () => (
      <RefreshCw className={cn('size-3', 'animate-spin')} aria-hidden="true" />
    ),
  },
  {
    site: 'dataset-schema/schema-badge.tsx:46',
    label: 'Upgrading…',
    render: () => (
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
    ),
  },
  {
    site: 'notebook/save-status.tsx:43',
    label: 'Saving…',
    render: () => (
      <Icon
        name="clock"
        size={12}
        className="animate-spin"
        aria-hidden="true"
      />
    ),
  },
  {
    site: 'notebook/save-status.tsx:53',
    label: 'Retrying…',
    render: () => (
      <Icon name="move" size={12} className="animate-spin" aria-hidden="true" />
    ),
  },
  {
    site: 'analysis/new.tsx:1191',
    label: 'Saving…',
    render: () => <Icon name="clock" size={16} className="animate-spin" />,
  },
]

/** The shipped spellings have no data of their own: the row names the work. */
function shippedFor(row: ComparisonRow) {
  return SHIPPED[Number(row.id.slice(-4)) % SHIPPED.length]
}

function SpinnerOursColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

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
        return (
          <div
            key={row.id}
            data-row-id={row.id}
            data-spelling={shipped.site}
            className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-3 py-2"
          >
            {shipped.render()}
            <span className="min-w-0 truncate text-body">{row.name}</span>
            <span className="ml-auto shrink-0 text-label text-fg-muted">
              {shipped.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SpinnerTheirsColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-1" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row) => {
        // The same text, the same tone, the same states as the shipped column —
        // one indicator renders all of them.
        const shipped = shippedFor(row)
        return (
          <div
            key={row.id}
            data-row-id={row.id}
            data-spelling="src/components/v3/ui/spinner.tsx"
            className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-3 py-2"
          >
            <Spinner
              size={shipped.site === 'analysis/new.tsx:1191' ? 16 : 12}
              className={cn(
                shipped.site === 'live/connection-status.tsx:54' &&
                  'text-warning-text',
                shipped.site === 'live/connection-status.tsx:43' &&
                  'text-fg-muted',
              )}
            />
            <span className="min-w-0 truncate text-body">{row.name}</span>
            <span className="ml-auto shrink-0 text-label text-fg-muted">
              {shipped.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const spinnerPair: ComparisonPair = {
  id: 'spinner',
  title: 'Working indicator',
  job: 'Show that work is in progress, beside the text that names it',
  // Tab reaches the indicators' hosts; there is nothing to sort, filter,
  // select, resize, reorder or page in either column.
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — six spellings of animate-spin',
    source:
      'live/connection-status.tsx, notebook/save-status.tsx, offline/offline-banner.tsx, dataset-schema/schema-badge.tsx, analysis/new.tsx',
    Column: SpinnerOursColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — v3 Spinner (in-house; no admissible registry item)',
    source: 'src/components/v3/ui/spinner.tsx',
    Column: SpinnerTheirsColumn,
  },
}
