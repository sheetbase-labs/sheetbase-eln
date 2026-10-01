/**
 * EXT-02 sample extension — data panel.
 *
 * Renders a host-supplied summary through existing primitives only
 * (`#/components/ui` button/dialog/typography roles, plain description
 * rows). The panel fetches nothing itself: the host passes `loadSummary`,
 * bound to ordinary public contract reads (the record route binds the
 * canonical record/activity queries; the dataset route binds the explorer
 * summary). That injection is the whole point — this file imports no data
 * client, no store and no domain module, so the sample cannot reach past
 * the public contract even by accident.
 *
 * Design/a11y constraints (match the host inspector language):
 * - dense `text-xs` description rows, sentence-case labels;
 * - `role="status"` live region for loading/error so assistive tech hears
 *   state changes the skeleton does not announce;
 * - `aria-busy` while loading; the Retry control is a standard button.
 */
import * as React from 'react'

import { Button } from '#/components/v3/ui/button'

export interface SampleSummaryRow {
  label: string
  value: string
}

export interface SampleSummary {
  heading: string
  subheading?: string
  rows: SampleSummaryRow[]
}

export function SampleExtensionPanel({
  loadSummary,
  onOpenRecord,
}: {
  /** Host-bound public-contract read; never a private import. */
  loadSummary: () => Promise<SampleSummary | null>
  /** Optional host navigation affordance (e.g. open the full record). */
  onOpenRecord?: () => void
}) {
  const [state, setState] = React.useState<
    | { status: 'loading' }
    | { status: 'loaded'; summary: SampleSummary | null }
    | { status: 'error'; message: string }
  >({ status: 'loading' })

  const load = React.useCallback(() => {
    setState({ status: 'loading' })
    loadSummary().then(
      (summary) => setState({ status: 'loaded', summary }),
      (cause: unknown) =>
        setState({
          status: 'error',
          message:
            cause instanceof Error
              ? cause.message
              : 'Could not load the sample summary.',
        }),
    )
  }, [loadSummary])

  React.useEffect(() => {
    load()
  }, [load])

  if (state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" className="space-y-2 py-2">
        <p className="text-xs text-fg-muted">Loading sample summary…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div role="status" className="space-y-2 py-2">
        <p className="text-xs text-fg-muted">{state.message}</p>
        <Button type="button" variant="secondary" size="sm" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  if (!state.summary) {
    return (
      <div className="py-2">
        <p className="text-xs text-fg-muted">No summary available.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 py-1">
      <div>
        <p className="text-sm font-semibold">{state.summary.heading}</p>
        {state.summary.subheading ? (
          <p className="text-xs text-fg-muted">{state.summary.subheading}</p>
        ) : null}
      </div>
      <dl className="divide-y divide-border rounded-md border border-border">
        {state.summary.rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-2 px-2 py-1.5"
          >
            <dt className="shrink-0 text-xs text-fg-muted">{row.label}</dt>
            <dd className="truncate text-xs text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
      {onOpenRecord ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onOpenRecord}
        >
          Open full record
        </Button>
      ) : null}
    </div>
  )
}
