import { cleanup, render } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { COMPARISON_PAIRS } from './pairs'
import { COMPARISON_FIXTURES } from './fixtures'
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from '#/components/reui/sortable'
import type {
  ComparisonColumnProps,
  ComparisonFixture,
  ComparisonSide,
  ComparisonState,
} from './types'

/**
 * ADR-0055 decision 5: axe with no violations, on both columns.
 *
 * Every fixture, both sides of every registered pair, plus the three states a
 * column must survive around the fixture. Colour contrast is disabled here for
 * the reason recorded in `src/routes/foundations.a11y.test.tsx` — jsdom does
 * not lay colour out — and it is *not* disabled in the browser run
 * (`tests/browser/component-compare.test.ts`), which is where contrast is
 * actually measured, in both themes.
 *
 * A violation fails here. There is no allow-list: if a column cannot pass, the
 * pair is not adoptable and the fact belongs in the comparison record.
 */

const RESET_STATES: readonly ComparisonState[] = [
  'loading',
  'error',
  'restricted',
]

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => cleanup())

function renderColumn(
  side: ComparisonSide,
  fixture: ComparisonFixture,
  state: ComparisonState,
) {
  const scenario: ComparisonColumnProps['scenario'] = {
    fixture,
    state,
    onRetry: () => {},
  }
  const { container } = render(<side.Column scenario={scenario} />)
  return container
}

async function axeViolations(container: HTMLElement) {
  return axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
}

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axeViolations(container)
  if (results.violations.length > 0) {
    throw new Error(
      `axe violations:\n${JSON.stringify(
        results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => node.html),
        })),
        null,
        2,
      )}`,
    )
  }
  expect(results.violations).toEqual([])
}

/**
 * The 5,000-row fixture is not run here. In jsdom, axe needs minutes for one
 * 25,000-node subtree, which is a queue-blocking test rather than evidence; the
 * browser run (`tests/browser/component-compare.test.ts`) measures that fixture
 * in a real engine instead, with colour contrast on. Every other fixture runs
 * in both places.
 */
const JSDOM_FIXTURES = COMPARISON_FIXTURES.filter(
  (fixture) => fixture.id !== 'bulk',
)

for (const pair of COMPARISON_PAIRS) {
  for (const side of [pair.ours, pair.theirs]) {
    describe(`${pair.id} — ${side.id} column axe`, () => {
      for (const fixture of JSDOM_FIXTURES) {
        it(`has no axe violations — ${fixture.id} (${fixture.hostility})`, async () => {
          const container = renderColumn(side, fixture, 'ready')
          await expectNoAxeViolations(container)
        })
      }

      for (const state of RESET_STATES) {
        it(`has no axe violations — ${state} state`, async () => {
          const container = renderColumn(
            side,
            COMPARISON_FIXTURES.find(
              (fixture) => fixture.id === 'long-labels',
            )!,
            state,
          )
          await expectNoAxeViolations(container)
        })
      }
    })
  }
}

/**
 * C1, pinned.
 *
 * The comparison's candidate puts `@dnd-kit`'s widget role and tab stop
 * (`role="button"`, `tabindex="0"`) on the row container while the drag
 * listeners sit on the handle inside it. Two facts decide what that costs, and
 * both are asserted here against the vendored item *unchanged* — no fixture,
 * no column, just `src/components/reui/sortable.tsx`:
 *
 * 1. as published, the item is axe-clean, because its default handle is a
 *    non-focusable `div`, so nothing inside the widget can take focus — and for
 *    that same reason its keyboard sensor is unreachable;
 * 2. make the handle a real `button`, which an integration has to do for the
 *    keyboard path, and every row becomes a widget containing a control: axe
 *    reports `nested-interactive` (serious).
 *
 * The column resolves it by handing the container the list's own semantics; the
 * per-column suite above is what shows the resolved form is clean. Recorded as
 * condition C1 in docs/knowledge/design/component-comparison-record.md.
 */
function renderSortableVariant(handle: 'published' | 'button') {
  const items = ['row-1', 'row-2', 'row-3']
  return render(
    <Sortable
      value={items}
      onValueChange={() => {}}
      getItemValue={(id) => id}
      strategy="vertical"
    >
      {items.map((id) => (
        <SortableItem key={id} value={id}>
          <SortableItemHandle
            render={handle === 'button' ? <button type="button" /> : undefined}
            aria-label={`Reorder ${id}`}
          >
            handle
          </SortableItemHandle>
          {id}
        </SortableItem>
      ))}
    </Sortable>,
  )
}

describe('the candidate rules or not on how its handle is rendered (C1)', () => {
  it('is axe-clean as published, with the item’s own non-focusable handle', async () => {
    const { container } = renderSortableVariant('published')
    const handle = container.querySelector('[data-slot="sortable-item-handle"]')
    expect(handle?.tagName).toBe('DIV')
    expect(handle?.getAttribute('tabindex')).toBeNull()
    await expectNoAxeViolations(container)
  })

  it('reports nested-interactive once the handle is a real button', async () => {
    const { container } = renderSortableVariant('button')
    const handle = container.querySelector('[data-slot="sortable-item-handle"]')
    expect(handle?.tagName).toBe('BUTTON')

    const results = await axeViolations(container)
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
      })),
    ).toEqual([{ id: 'nested-interactive', impact: 'serious' }])
  })
})
