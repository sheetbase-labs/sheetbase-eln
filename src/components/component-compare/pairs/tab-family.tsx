import * as React from 'react'

import {
  Tabs as CandidateTabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/reui/tabs'
import { Tabs } from '#/components/v3/ui/tabs'
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
 * Pair 2 — the tab family.
 *
 * Ours: the reconciled contract, `#/components/v3/ui/tabs` in `mode="state"` —
 * a Base UI tablist (`role="tablist"`/`role="tab"`, roving focus,
 * ArrowLeft/ArrowRight, Home/End, activation on focus).
 *
 * Theirs: the stock shadcn `tabs` item, `src/components/reui/tabs.tsx`. It is
 * not a ReUI item — the pinned registry answers 404 for `tabs` and says to
 * install it from shadcn/ui — so the candidate was placed from the shadcn
 * registry with the three edits that file's header records.
 *
 * The job is the same on both sides: switch which view of the same rows is
 * shown, in place, without changing the URL. (Our contract's other mode, tabs
 * that *are* URLs, has no counterpart in the item; that is recorded in the
 * comparison record rather than faked here.)
 *
 * What is compared is the widget, not the panel: each column's panel is one
 * line of text saying which view is current and how many rows it holds.
 */

/** The views both columns offer, derived from the one fixture they share. */
function viewsFor(fixture: ComparisonFixture) {
  const kinds: Array<ComparisonRow['kind']> = []
  for (const row of fixture.rows) {
    if (!kinds.includes(row.kind)) kinds.push(row.kind)
  }
  const views = [
    { key: 'all', label: 'All', count: fixture.rows.length },
    ...kinds.map((kind) => ({
      key: kind ?? 'unclassified',
      label: kind ?? 'Unclassified',
      count: fixture.rows.filter((row) => row.kind === kind).length,
    })),
  ]
  return views
}

function Panel({
  fixture,
  view,
}: {
  fixture: ComparisonFixture
  view: string
}) {
  const views = viewsFor(fixture)
  const current = views.find((entry) => entry.key === view) ?? views[0]
  const first = fixture.rows.find(
    (row) =>
      current.key === 'all' || (row.kind ?? 'unclassified') === current.key,
  )
  return (
    <p className="mt-2 px-1 text-label text-fg-muted" data-comparison-panel>
      {current.label} — {current.count} of {fixture.rows.length} rows
      {first ? ` · first: ${first.name}` : null}
    </p>
  )
}

function OursColumn({ scenario }: ComparisonColumnProps) {
  const views = viewsFor(scenario.fixture)
  const [view, setView] = React.useState(views[0]?.key ?? 'all')

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-widget="v3-tabs-state">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
      <Tabs
        mode="state"
        label="Row views"
        value={view}
        onValueChange={setView}
        items={views}
      />
      <Panel fixture={scenario.fixture} view={view} />
    </div>
  )
}

function TheirsColumn({ scenario }: ComparisonColumnProps) {
  const views = viewsFor(scenario.fixture)
  const [view, setView] = React.useState(views[0]?.key ?? 'all')

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-widget="shadcn-tabs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
      <CandidateTabs value={view} onValueChange={setView}>
        <TabsList aria-label="Row views">
          {views.map((entry) => (
            <TabsTrigger key={entry.key} value={entry.key}>
              {entry.label} {entry.count}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view}>
          <Panel fixture={scenario.fixture} view={view} />
        </TabsContent>
      </CandidateTabs>
    </div>
  )
}

export const tabFamilyPair: ComparisonPair = {
  id: 'tab-family',
  title: 'Tab family — one of N views, in place',
  job: 'Switch which view of the same rows is shown, without leaving the page',
  controls: ['navigate'],
  ours: {
    id: 'ours',
    label: 'Ours — v3 tab contract (mode="state")',
    source: 'src/components/v3/ui/tabs.tsx',
    Column: OursColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — stock shadcn tabs (registry: tabs)',
    source:
      'src/components/reui/tabs.tsx (shadcn/ui new-york; reui.io/r/base-nova/tabs.json answers 404)',
    Column: TheirsColumn,
  },
}
