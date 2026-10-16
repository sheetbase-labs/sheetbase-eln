import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair — disclosure.
 *
 * **Ours.** The two shapes the product shipped, reproduced here because the
 * migration replaced them: native `<details>`/`<summary>` (five sites, each
 * with its own summary styling) and the run history's row expander — a quiet
 * `Show`/`Hide` button with **no `aria-expanded` at all**, so the only signal
 * of what the control would do was its own label, with the detail row rendered
 * by a hand-rolled ternary. `<details>` itself is honest native disclosure; the
 * expander is the one place with a real accessibility defect.
 *
 * **Theirs.** The v3 `Collapsible`. `collapsible` and `accordion` are stock
 * shadcn items, not ReUI ones (`collapsible.json` and `accordion.json` 404 on
 * the pinned base-nova registry), and a bare-name install would write into the
 * legacy Radix kit decision 1 refuses to extend. Base UI's Collapsible is the
 * primitive, exactly as ADR-0055 decision 1 requires.
 *
 * The fixture's row name is the trigger — which is where the long-labels
 * fixture earns its keep — and the row's note is the panel.
 */

/** The two shipped shapes, in the order they were found. */
const SHIPPED = [
  { site: 'settings/signatures.tsx:578', shape: 'details' },
  { site: 'v3/projects/projects-page.tsx:1385', shape: 'details' },
  { site: 'v3/integrations/run-history.tsx:201', shape: 'details' },
  { site: 'v3/settings/parser-settings.tsx:238', shape: 'details' },
  { site: 'v3/integrations/run-history.tsx:150-157', shape: 'expander' },
] as const

function shippedFor(row: ComparisonRow) {
  return SHIPPED[Number(row.id.slice(-4)) % SHIPPED.length]
}

/** What the panel holds, from the fixture: nulls and long text included. */
function panelFor(row: ComparisonRow) {
  return row.note ?? row.unit
}

function CollapsibleOursColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  // The expander shape is one control with its own state, as it shipped.
  const [expanded, setExpanded] = useState<string | null>(null)

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
            data-shape={shipped.shape}
            className="min-w-0 rounded-md border border-transparent px-3 py-2"
          >
            {shipped.shape === 'details' ? (
              <details>
                <summary className="cursor-pointer text-label">
                  {row.name}
                </summary>
                <div className="mt-2 text-body text-fg-muted">
                  {panelFor(row)}
                </div>
              </details>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() =>
                    setExpanded((current) =>
                      current === row.id ? null : row.id,
                    )
                  }
                >
                  {expanded === row.id ? 'Hide' : 'Show'}
                </Button>
                {expanded === row.id ? (
                  <div className="mt-1 text-body text-fg-muted">
                    {panelFor(row)}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CollapsibleTheirsColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-1" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row) => (
        <div
          key={row.id}
          data-row-id={row.id}
          className="min-w-0 rounded-md border border-transparent px-3 py-2"
        >
          <Collapsible>
            <CollapsibleTrigger>{row.name}</CollapsibleTrigger>
            <CollapsiblePanel className="mt-2 text-body text-fg-muted">
              {panelFor(row)}
            </CollapsiblePanel>
          </Collapsible>
        </div>
      ))}
    </div>
  )
}

export const collapsiblePair: ComparisonPair = {
  id: 'collapsible',
  title: 'Disclosure',
  job: 'Reveal detail behind a control that states whether it is open',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — native <details>, and an expander with no aria-expanded',
    source:
      'routes/settings/signatures.tsx, v3/projects/projects-page.tsx, v3/integrations/run-history.tsx, v3/settings/parser-settings.tsx',
    Column: CollapsibleOursColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — v3 Collapsible (in-house, on Base UI)',
    source: 'src/components/v3/ui/collapsible.tsx',
    Column: CollapsibleTheirsColumn,
  },
}
