import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ThemeProvider } from '#/components/theme-provider'
import { ComponentCompare } from './harness'
import { COMPARISON_PAIRS } from './pairs'
import { COMPARISON_FIXTURES } from './fixtures'
import { COMPARISON_CHECKLIST } from './checklist'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonScenario,
} from './types'

/**
 * The harness contract: one scenario object reaches both columns, fixtures are
 * shared and immutable, a pair is data rather than a bespoke comparator, and
 * the columns really reorder — the notebook column through the notebook's own
 * module, the ReUI column through `@dnd-kit`.
 */

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => cleanup())

function renderHarness(pairs = COMPARISON_PAIRS) {
  return render(
    <ThemeProvider>
      <ComponentCompare pairs={pairs} />
    </ThemeProvider>,
  )
}

function selectFixture(id: string) {
  fireEvent.change(screen.getByTestId('comparison-fixture'), {
    target: { value: id },
  })
}

/** The column's own element, or a failure: the tests read its data attributes. */
function columnElement(side: 'ours' | 'theirs'): HTMLElement {
  const element = document.querySelector(`[data-comparison-column="${side}"]`)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No ${side} column in the harness`)
  }
  return element
}

/** Rows in one column, in the order they are rendered. */
function columnRowIds(side: 'ours' | 'theirs'): string[] {
  const column = document.querySelector(`[data-comparison-column="${side}"]`)
  if (!column) throw new Error(`No ${side} column`)
  return Array.from(column.querySelectorAll('[data-row-id]')).map(
    (element) => (element as HTMLElement).dataset.rowId ?? '',
  )
}

describe('the comparison harness is generic over a pair', () => {
  it('hands both columns the same scenario object', () => {
    const seen: Array<{
      side: 'ours' | 'theirs'
      scenario: ComparisonScenario
    }> = []
    function Probe() {
      return <div data-probe />
    }
    const probePair: ComparisonPair = {
      id: 'probe',
      title: 'Probe',
      job: 'prove the harness passes one scenario to both columns',
      controls: ['reorder'],
      ours: {
        id: 'ours',
        label: 'Ours',
        source: 'probe',
        Column: (props: ComparisonColumnProps) => {
          seen.push({ side: 'ours', scenario: props.scenario })
          return <Probe />
        },
      },
      theirs: {
        id: 'theirs',
        label: 'Theirs',
        source: 'probe',
        Column: (props: ComparisonColumnProps) => {
          seen.push({ side: 'theirs', scenario: props.scenario })
          return <Probe />
        },
      },
    }

    renderHarness([probePair])

    expect(seen).toHaveLength(2)
    const [ours, theirs] = seen
    expect(ours.scenario).toBe(theirs.scenario)
    expect(ours.scenario.fixture).toBe(
      COMPARISON_FIXTURES.find(
        (fixture) => fixture.id === ours.scenario.fixture.id,
      ),
    )
  })

  it('renders every registered pair for every fixture and state', () => {
    for (const pair of COMPARISON_PAIRS) {
      const { unmount } = renderHarness([pair])
      for (const fixture of COMPARISON_FIXTURES.filter(
        (entry) => entry.id !== 'bulk',
      )) {
        fireEvent.change(screen.getByTestId('comparison-fixture'), {
          target: { value: fixture.id },
        })
        for (const state of ['ready', 'loading', 'error', 'restricted']) {
          fireEvent.change(screen.getByTestId('comparison-state'), {
            target: { value: state },
          })
          const ours = columnElement('ours')
          expect(ours.dataset.fixtureId).toBe(fixture.id)
          expect(ours.dataset.fixtureRows).toBe(String(fixture.rows.length))
          expect(ours.dataset.scenarioState).toBe(state)
        }
      }
      unmount()
    }
  })

  // Two 5,000-row jsdom renders take seconds, so this one gets its own timeout;
  // the browser run measures the same fixture in a real engine.
  it('renders the 5,000-row fixture in both columns', () => {
    renderHarness()
    selectFixture('bulk')
    for (const side of ['ours', 'theirs'] as const) {
      expect(columnRowIds(side)).toHaveLength(5000)
    }
  }, 30_000)

  it('shows one column or both, from the view toggle', async () => {
    const user = userEvent.setup()
    renderHarness()

    expect(document.querySelectorAll('[data-comparison-column]')).toHaveLength(
      2,
    )

    await user.click(screen.getByTestId('comparison-view-ours'))
    expect(document.querySelectorAll('[data-comparison-column]')).toHaveLength(
      1,
    )
    expect(
      document.querySelector('[data-comparison-column="theirs"]'),
    ).toBeNull()

    await user.click(screen.getByTestId('comparison-view-theirs'))
    expect(document.querySelector('[data-comparison-column="ours"]')).toBeNull()

    await user.click(screen.getByTestId('comparison-view-both'))
    expect(document.querySelectorAll('[data-comparison-column]')).toHaveLength(
      2,
    )
  })

  it('returns to the ready state from the error state, by keyboard', async () => {
    const user = userEvent.setup()
    renderHarness()

    fireEvent.change(screen.getByTestId('comparison-state'), {
      target: { value: 'error' },
    })
    const retries = screen.getAllByRole('button', { name: 'Retry' })
    expect(retries).toHaveLength(2)

    retries[0].focus()
    await user.keyboard('{Enter}')

    const ours = columnElement('ours')
    expect(ours.dataset.scenarioState).toBe('ready')
  })

  it('reports the fixed checklist, marking absent controls not applicable', () => {
    renderHarness()
    const panel = screen.getByTestId('comparison-checklist')
    const pair = COMPARISON_PAIRS[0]

    for (const item of COMPARISON_CHECKLIST) {
      const cell = within(panel).getByText(item.instruction)
      expect(cell).toBeTruthy()
      const verdict = cell.parentElement?.lastElementChild?.textContent ?? ''
      const applicable = item.requires.every((control) =>
        pair.controls.includes(control),
      )
      expect(verdict === 'Applies').toBe(applicable)
    }
  })
})

describe('the fixtures are fixed and shared', () => {
  it('covers the required hostile axes', () => {
    const byId = new Map(COMPARISON_FIXTURES.map((entry) => [entry.id, entry]))
    expect(byId.get('empty')?.rows).toHaveLength(0)
    expect(byId.get('single')?.rows).toHaveLength(1)
    expect(byId.get('bulk')?.rows).toHaveLength(5000)
    expect(
      byId.get('long-labels')?.rows.some((row) => row.name.length > 100),
    ).toBe(true)
    expect(
      new Set(byId.get('mixed-types')?.rows.map((row) => typeof row.value)),
    ).toEqual(new Set(['number', 'string', 'object']))
    expect(
      byId.get('null-column')?.rows.every((row) => row.note === null),
    ).toBe(true)
    expect(
      byId
        .get('high-precision')
        ?.rows.some(
          (row) =>
            typeof row.value === 'number' && String(row.value).length > 15,
        ),
    ).toBe(true)
  })

  it('is frozen, so a column cannot quietly change the shared fixture', () => {
    const bulk = COMPARISON_FIXTURES.find((fixture) => fixture.id === 'bulk')!
    expect(Object.isFrozen(bulk)).toBe(true)
    expect(Object.isFrozen(bulk.rows)).toBe(true)
    expect(Object.isFrozen(bulk.rows[0])).toBe(true)
    expect(() => {
      ;(bulk.rows as unknown as Array<unknown>).push({})
    }).toThrow(TypeError)
  })
})

describe('the notebook column reorders with the notebook’s own module', () => {
  it('moves a row down with alt+ArrowDown on the focused row', () => {
    renderHarness([COMPARISON_PAIRS[0]])
    selectFixture('long-labels')
    const before = columnRowIds('ours')
    expect(before.length).toBeGreaterThan(2)

    const row = document.querySelector(
      `[data-comparison-column="ours"] [data-row-id="${before[0]}"]`,
    ) as HTMLElement
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })

    const after = columnRowIds('ours')
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
    expect(after.slice(2)).toEqual(before.slice(2))
  })

  it('does not offer reordering while permission is restricted', () => {
    renderHarness([COMPARISON_PAIRS[0]])
    selectFixture('long-labels')
    fireEvent.change(screen.getByTestId('comparison-state'), {
      target: { value: 'restricted' },
    })

    const ours = columnElement('ours')
    expect(within(ours).getByText('View only')).toBeTruthy()
    expect(
      Array.from(ours.querySelectorAll('[data-row-id]')).every(
        (element) => !(element as HTMLElement).hasAttribute('tabindex'),
      ),
    ).toBe(true)
    // The reason is text, not a hover tooltip, so it survives a keyboard read.
    const before = columnRowIds('ours')
    const row = ours.querySelector(
      `[data-row-id="${before[0]}"]`,
    ) as HTMLElement
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })
    expect(columnRowIds('ours')).toEqual(before)
  })
})

describe('the ReUI column offers the candidate’s own controls', () => {
  it('gives every row a focusable handle carrying the drag listeners', () => {
    renderHarness([COMPARISON_PAIRS[0]])
    selectFixture('long-labels')

    const items = document.querySelectorAll(
      '[data-comparison-column="theirs"] [data-slot="sortable-item"]',
    )
    expect(items.length).toBeGreaterThan(2)
    for (const item of items) {
      const handle = item.querySelector('[data-slot="sortable-item-handle"]')
      expect(handle).not.toBeNull()
      expect(handle?.tagName).toBe('BUTTON')
      expect(handle?.getAttribute('aria-label')).toMatch(/^Reorder /)
    }
    // The reorder itself is measured in a real engine, where dnd-kit can
    // measure rects: tests/browser/component-compare.test.ts.
  })
})

describe('the registered pair set', () => {
  it('holds the notebook sortable list, and nothing else yet', () => {
    expect(COMPARISON_PAIRS.map((pair) => pair.id)).toEqual([
      'notebook-sortable',
    ])
  })
})
