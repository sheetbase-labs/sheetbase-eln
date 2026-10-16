import * as React from 'react'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { NativeSelect } from '#/components/v3/projects/select'
import { useTheme } from '#/components/theme-provider'
import { COMPARISON_CHECKLIST } from '#/components/component-compare/checklist'
import {
  COMPARISON_FIXTURES,
  findFixture,
} from '#/components/component-compare/fixtures'
import type {
  ComparisonPair,
  ComparisonScenario,
  ComparisonSide,
  ComparisonState,
} from '#/components/component-compare/types'
import { COMPARISON_STATES } from '#/components/component-compare/types'

/**
 * The A/B comparison harness (ADR-0055 decision 5).
 *
 * One scenario and one fixture, two columns, one toggle. It is generic over a
 * pair: it knows nothing about sorting, grids or the notebook, and a new pair
 * is an entry in `pairs/index.ts`. The fixed checklist is rendered beside the
 * columns so the questions asked of the candidate are visible while they are
 * being answered; the answers live in the comparison record
 * (`docs/knowledge/design/component-comparison-record.md`).
 *
 * The harness is normally reached through the development-only route
 * `/component-compare`; see docs/development/component-compare.md.
 */

/** Which columns are on screen. */
const VIEWS = ['ours', 'theirs', 'both'] as const
type View = (typeof VIEWS)[number]

const VIEW_LABEL: Record<View, string> = {
  ours: 'Ours only',
  theirs: 'Theirs only',
  both: 'Both',
}

const STATE_LABEL: Record<ComparisonState, string> = {
  ready: 'Ready',
  loading: 'Loading',
  error: 'Error',
  restricted: 'Permission restricted',
}

/** One column: heading, provenance, and the component under comparison. */
function ComparisonColumn({
  pair,
  side,
  scenario,
}: {
  pair: ComparisonPair
  side: ComparisonSide
  scenario: ComparisonScenario
}) {
  const Column = side.Column
  return (
    <section
      aria-label={side.label}
      className="min-w-0 rounded-lg border border-border bg-surface p-3"
      data-comparison-column={side.id}
      data-pair-id={pair.id}
      data-fixture-id={scenario.fixture.id}
      data-fixture-rows={scenario.fixture.rows.length}
      data-scenario-state={scenario.state}
    >
      <header className="flex flex-col gap-0.5 border-b border-border pb-2">
        <h2 className="text-section">{side.label}</h2>
        <p className="break-all font-mono text-label text-fg-muted">
          {side.source}
        </p>
        <p className="text-label text-fg-muted">
          Fixture <span className="font-mono">{scenario.fixture.id}</span> —{' '}
          {scenario.fixture.hostility} ({scenario.fixture.rows.length}{' '}
          {scenario.fixture.rows.length === 1 ? 'row' : 'rows'}) ·{' '}
          {STATE_LABEL[scenario.state]}
        </p>
      </header>
      <div className="mt-3 min-w-0 overflow-x-auto">
        {/* Re-mounting on fixture or state change resets the column's own
            order, so a comparison never starts from the previous run's state. */}
        <Column
          key={`${pair.id}:${scenario.fixture.id}:${scenario.state}`}
          scenario={scenario}
        />
      </div>
    </section>
  )
}

/** The fixed checklist, with the verdicts left to the record. */
function ChecklistPanel({ pair }: { pair: ComparisonPair }) {
  return (
    <section
      aria-label="Behavioural checklist"
      className="mt-6 rounded-lg border border-border bg-surface p-3"
      data-testid="comparison-checklist"
    >
      <h2 className="text-section">Behavioural checklist</h2>
      <p className="mt-1 text-label text-fg-muted">
        Fixed for every pair. One run per side; not-applicable entries say which
        control class the pair does not have. Results and the verdict are in{' '}
        <code>docs/knowledge/design/component-comparison-record.md</code>.
      </p>
      <table className="mt-3 w-full border-collapse text-label">
        <caption className="sr-only">
          Checklist items, their area, how each is answered, and whether this
          pair has the control the item needs
        </caption>
        <thead>
          <tr className="text-left text-fg-muted">
            <th scope="col" className="py-1 pr-3 font-medium">
              Area
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Check
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Answered by
            </th>
            <th scope="col" className="py-1 font-medium">
              This pair
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_CHECKLIST.map((item) => {
            const missing = item.requires.filter(
              (control) => !pair.controls.includes(control),
            )
            return (
              <tr key={item.id} className="border-t border-border align-top">
                <td className="py-1 pr-3 text-fg-muted">{item.area}</td>
                <td className="py-1 pr-3" data-checklist-item={item.id}>
                  {item.instruction}
                </td>
                <td className="py-1 pr-3 text-fg-muted">
                  {item.evidence === 'automated' ? 'Test' : 'Manual run'}
                  {item.ref ? (
                    <span className="block break-all font-mono text-fg-muted">
                      {item.ref}
                    </span>
                  ) : null}
                </td>
                <td className="py-1 text-fg-muted">
                  {missing.length > 0
                    ? `Not applicable — no ${missing.join(', ')} control`
                    : 'Applies'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export function ComponentCompare({
  pairs,
}: {
  pairs: readonly ComparisonPair[]
}) {
  const [pairId, setPairId] = React.useState(() => pairs[0]?.id ?? '')
  const [fixtureId, setFixtureId] = React.useState(
    () => COMPARISON_FIXTURES[0]?.id ?? '',
  )
  const [state, setState] = React.useState<ComparisonState>('ready')
  const [view, setView] = React.useState<View>('both')
  const { theme, setTheme } = useTheme()

  const fixture = findFixture(fixtureId)
  const scenario = React.useMemo<ComparisonScenario>(
    () => ({ fixture, state, onRetry: () => setState('ready') }),
    [fixture, state],
  )

  if (pairs.length === 0) {
    return <p className="p-6 text-body">No comparison pairs are registered.</p>
  }
  const pair = pairs.find((entry) => entry.id === pairId) ?? pairs[0]

  return (
    <div
      className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6"
      data-testid="component-compare"
    >
      <header className="border-b border-border pb-4">
        <p className="text-label font-semibold uppercase tracking-[0.14em] text-fg-muted">
          Component comparison — development only
        </p>
        <h1 className="mt-1 text-title">{pair.title}</h1>
        <p className="mt-1 text-body text-fg-muted">{pair.job}</p>
        <p className="mt-1 text-label text-fg-muted">
          ADR-0055: nothing may be adopted from a registry without one row per
          component in the comparison record. This surface produces the
          evidence; it does not decide anything.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex min-w-56 flex-col gap-1 text-label text-fg-muted">
          Pair
          <NativeSelect
            value={pair.id}
            onChange={(event) => setPairId(event.target.value)}
            data-testid="comparison-pair"
          >
            {pairs.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-72 flex-col gap-1 text-label text-fg-muted">
          Fixture
          <NativeSelect
            value={fixture.id}
            onChange={(event) => setFixtureId(event.target.value)}
            data-testid="comparison-fixture"
          >
            {COMPARISON_FIXTURES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.hostility} — {entry.id}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-56 flex-col gap-1 text-label text-fg-muted">
          State
          <NativeSelect
            value={state}
            onChange={(event) =>
              setState(event.target.value as ComparisonState)
            }
            data-testid="comparison-state"
          >
            {COMPARISON_STATES.map((entry) => (
              <option key={entry} value={entry}>
                {STATE_LABEL[entry]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div
          role="group"
          aria-label="Columns shown"
          className="flex items-center gap-1"
        >
          {VIEWS.map((entry) => (
            <Button
              key={entry}
              variant={view === entry ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={view === entry}
              onClick={() => setView(entry)}
              data-testid={`comparison-view-${entry}`}
            >
              {VIEW_LABEL[entry]}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          icon={theme === 'dark' ? 'moon' : 'sun'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          data-testid="comparison-theme"
        >
          {theme === 'dark' ? 'Dark' : 'Light'} theme
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {view !== 'theirs' ? (
          <ComparisonColumn pair={pair} side={pair.ours} scenario={scenario} />
        ) : null}
        {view !== 'ours' ? (
          <ComparisonColumn
            pair={pair}
            side={pair.theirs}
            scenario={scenario}
          />
        ) : null}
      </div>

      <ChecklistPanel pair={pair} />

      <p className="mt-4 flex items-start gap-2 text-label text-fg-muted">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        <span>
          Automated evidence for this page:{' '}
          <span className="font-mono">
            src/components/component-compare/component-compare.a11y.test.tsx
          </span>{' '}
          (axe, zero violations on both columns) and{' '}
          <span className="font-mono">
            tests/browser/component-compare.test.ts
          </span>{' '}
          (a screenshot of each column in both themes, plus the keyboard, mouse
          and density checks).
        </span>
      </p>
    </div>
  )
}
