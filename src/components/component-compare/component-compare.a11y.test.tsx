import { cleanup, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { COMPARISON_PAIRS } from './pairs'
import { COMPARISON_FIXTURES } from './fixtures'
import { Stepper } from '#/components/v3/ui/stepper'
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from '#/components/reui/sortable'
import {
  Stepper as ReuiStepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '#/components/reui/stepper'
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

/**
 * S1, pinned — the stepper candidate, composed as its own API intends.
 *
 * The stepper comparison is a decline, and these are the two measurements it
 * turned on. Both are asserted here against `src/components/reui/stepper.tsx`
 * unchanged, on the flow's own three steps with the second one current —
 * `['Upload', 'Map columns', 'Review and import']`, the composition the import
 * flow uses (`src/components/import/import-flow.tsx:334`, `:854`):
 *
 * 1. the product's contract cannot be met. `tests/browser/import-flow.test.ts:188-193`
 *    requires a list named "Steps" of three listitems with `aria-current="step"`
 *    on the current one; the item renders a `<nav>` of `<div>`s holding a
 *    `role="tablist"` of `role="tab"` buttons, with no `aria-current` anywhere.
 *    Composing it in the import flow and running that spec fails at its first
 *    assertion: `getByRole('list', { name: 'Steps' }).getByRole('listitem')`
 *    resolves to 0 elements (expected 3).
 * 2. it is not axe-clean as published, while ours is. Three critical
 *    violations: the tablist owns no tabs because the item `<div>`s sit between
 *    them, the tabs have no tablist parent for the same reason, and the
 *    `aria-controls` every trigger renders points at `stepper-panel-N`, an id
 *    the item never renders.
 *
 * Consumer-side overrides do not rescue it. Declaring the item wrappers as
 * layout (`role="none"`, so the tabs are promoted) and supplying the panel
 * targets the item's own `aria-controls` expects clears `aria-valid-attr-value`
 * and leaves both structural violations — measured in the third case. Making
 * the item render the product's semantics would mean rewriting the tags, roles
 * and attributes the copied item declares, which ADR-0055 decision 2 does not
 * permit, and it would still be a different component: the item is a wizard you
 * navigate (tabs that change the active step, a roving tab stop) where the flow
 * needs a display-only progress row, and its state union —
 * active / completed / inactive / loading — has no failed step for the marker
 * the flow reserves. See the row in
 * `docs/knowledge/design/component-comparison-record.md`.
 */
const IMPORT_STEPS = ['Upload', 'Map columns', 'Review and import'] as const
const IMPORT_CURRENT = 2

/** Ours: the shipped row, on the flow's own steps and current index. */
function renderInHouseStepper() {
  return render(<Stepper steps={[...IMPORT_STEPS]} current={IMPORT_CURRENT} />)
}

/**
 * Theirs: the candidate composed the way an integration has to compose it.
 * `containerFixes` is the consumer-side override set of the third case.
 */
function renderReuiStepper(containerFixes = false) {
  return render(
    <ReuiStepper value={IMPORT_CURRENT}>
      <StepperNav>
        {IMPORT_STEPS.map((label, index) => {
          const step = index + 1
          return (
            <StepperItem
              key={label}
              step={step}
              completed={step < IMPORT_CURRENT}
              {...(containerFixes ? { role: 'none' } : {})}
            >
              <StepperTrigger>
                <StepperIndicator>{step}</StepperIndicator>
                <StepperTitle>{label}</StepperTitle>
              </StepperTrigger>
              {containerFixes ? (
                <span id={`stepper-panel-${step}`} hidden />
              ) : null}
              {index < IMPORT_STEPS.length - 1 ? <StepperSeparator /> : null}
            </StepperItem>
          )
        })}
      </StepperNav>
    </ReuiStepper>,
  )
}

function violationIds(results: Awaited<ReturnType<typeof axeViolations>>) {
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
  }))
}

describe('the stepper candidate cannot render the shipped contract (S1)', () => {
  it('renders no list named "Steps", no listitem and no aria-current', () => {
    const { container } = renderReuiStepper()

    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.querySelector('[aria-current="step"]')).toBeNull()

    // What it renders instead: a nav holding a tablist of tabs, one tab stop.
    expect(
      container.querySelector('nav[data-slot="stepper-nav"]'),
    ).not.toBeNull()
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    const triggers = container.querySelectorAll('[role="tab"]')
    expect(triggers).toHaveLength(IMPORT_STEPS.length)
    expect(
      Array.from(triggers).map((trigger) =>
        trigger.getAttribute('aria-selected'),
      ),
    ).toEqual(['false', 'true', 'false'])
    expect(
      Array.from(triggers).map((trigger) => trigger.getAttribute('tabindex')),
    ).toEqual(['-1', '0', '-1'])

    // The `failed` marker the flow reserves has nothing to map onto: the item's
    // own states are completed / active / inactive (and loading).
    expect(
      Array.from(container.querySelectorAll('[data-slot="stepper-item"]')).map(
        (item) => item.getAttribute('data-state'),
      ),
    ).toEqual(['completed', 'active', 'inactive'])
  })

  it('is not axe-clean as published, while ours is', async () => {
    const ours = renderInHouseStepper()
    await expectNoAxeViolations(ours.container)
    cleanup()

    const theirs = renderReuiStepper()
    expect(violationIds(await axeViolations(theirs.container))).toEqual([
      { id: 'aria-required-children', impact: 'critical' },
      { id: 'aria-required-parent', impact: 'critical' },
      { id: 'aria-valid-attr-value', impact: 'critical' },
    ])
  })

  it('still does not pass with the consumer’s own container fixes', async () => {
    const theirs = renderReuiStepper(true)
    expect(violationIds(await axeViolations(theirs.container))).toEqual([
      { id: 'aria-required-children', impact: 'critical' },
      { id: 'aria-required-parent', impact: 'critical' },
    ])
  })
})
