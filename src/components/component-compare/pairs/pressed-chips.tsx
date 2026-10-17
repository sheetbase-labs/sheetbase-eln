import * as React from 'react'

import { Button } from '#/components/v3/ui/button'
import { ToggleGroup, ToggleGroupItem } from '#/components/reui/toggle-group'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonFixture,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair 3 — the pressed-state chip row.
 *
 * This is the other half of the domain scan's "pressed-state toggle chip group"
 * finding (rank 4). The single-select chip rows in that set turned out to be
 * the tab job and moved onto `mode="state"`/`variant="segment"` (schedule,
 * review, experiment-history, scientific-record-linker). What remains — and
 * what this pair compares — is the **multi-select** filter chip row, whose
 * shipped shape is `revision-diff-review.tsx:493-534`: a `role="group"` with
 * one `aria-pressed` button per kind, each press toggling that kind in or out
 * of the set.
 *
 * Ours: that shipped shape — `role="group"`, `aria-pressed` per chip, a count
 * in the label, and each chip its own tab stop.
 *
 * Theirs: the stock shadcn `toggle-group` item, `type="multiple"` — which
 * Radix renders as the same announcement (`aria-pressed` per button) inside a
 * `role="group"`, with the item and its `toggle` dependency placed under
 * `src/components/reui/`.
 *
 * `controls: []` on purpose: a multi-select chip row has no reorder, sort,
 * filter, select, resize or pagination control, and arrow-key navigation is
 * not part of its pattern — the finding's "no roving focus" claim is true of
 * the single-select rows, which are no longer this job.
 */

function kindsFor(fixture: ComparisonFixture) {
  const kinds: Array<NonNullable<ComparisonRow['kind']>> = []
  for (const row of fixture.rows) {
    if (row.kind && !kinds.includes(row.kind)) kinds.push(row.kind)
  }
  return kinds
}

function usePressedKinds(fixture: ComparisonFixture) {
  return React.useState<readonly string[]>(() => kindsFor(fixture))
}

function Panel({
  fixture,
  pressed,
}: {
  fixture: ComparisonFixture
  pressed: readonly string[]
}) {
  const shown = fixture.rows.filter(
    (row) => row.kind !== null && pressed.includes(row.kind),
  )
  return (
    <p className="mt-2 px-1 text-label text-fg-muted" data-comparison-panel>
      {shown.length} of {fixture.rows.length} rows match the pressed kinds
    </p>
  )
}

function OursColumn({ scenario }: ComparisonColumnProps) {
  const kinds = kindsFor(scenario.fixture)
  const [pressed, setPressed] = usePressedKinds(scenario.fixture)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-widget="aria-pressed-group">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
      {/* The shipped shape: revision-diff-review.tsx's change-type filters. */}
      <div
        role="group"
        aria-label="Change type filters"
        className="flex flex-wrap gap-1"
      >
        {kinds.map((kind) => {
          const enabled = pressed.includes(kind)
          const count = scenario.fixture.rows.filter(
            (row) => row.kind === kind,
          ).length
          return (
            <Button
              key={kind}
              variant={enabled ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={enabled}
              disabled={scenario.state === 'restricted'}
              aria-label={`${enabled ? 'Hide' : 'Show'} ${kind} rows`}
              onClick={() =>
                setPressed(
                  enabled
                    ? pressed.filter((entry) => entry !== kind)
                    : [...pressed, kind],
                )
              }
            >
              {kind} ({count})
            </Button>
          )
        })}
      </div>
      <Panel fixture={scenario.fixture} pressed={pressed} />
    </div>
  )
}

function TheirsColumn({ scenario }: ComparisonColumnProps) {
  const kinds = kindsFor(scenario.fixture)
  const [pressed, setPressed] = usePressedKinds(scenario.fixture)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-widget="shadcn-toggle-group">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
      <ToggleGroup
        type="multiple"
        value={[...pressed]}
        onValueChange={(next) => setPressed(next)}
        aria-label="Change type filters"
        className="flex-wrap justify-start gap-1"
      >
        {kinds.map((kind) => {
          const count = scenario.fixture.rows.filter(
            (row) => row.kind === kind,
          ).length
          return (
            <ToggleGroupItem
              key={kind}
              value={kind}
              disabled={scenario.state === 'restricted'}
              aria-label={`Toggle ${kind} rows`}
              className="h-6 min-w-0 rounded-md border border-border px-2 text-label data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {kind} ({count})
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
      <Panel fixture={scenario.fixture} pressed={pressed} />
    </div>
  )
}

export const pressedChipsPair: ComparisonPair = {
  id: 'pressed-chips',
  title: 'Pressed-state chips — filter by several kinds at once',
  job: 'Toggle independent criteria on and off, and see which are pressed',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — aria-pressed group (as shipped)',
    source:
      'src/components/review/revision-diff-review.tsx (change type filters)',
    Column: OursColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — stock shadcn toggle group (registry: toggle-group)',
    source:
      'src/components/reui/toggle-group.tsx + toggle.tsx (shadcn/ui new-york; reui.io/r/base-nova/toggle-group.json answers 404)',
    Column: TheirsColumn,
  },
}
