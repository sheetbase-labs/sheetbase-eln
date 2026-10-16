import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  OursQuantityColumn,
  TheirsQuantityColumn,
} from '#/components/component-compare/pairs/quantity-field'
import { findFixture } from '#/components/component-compare/fixtures'
import type {
  ComparisonColumnProps,
  ComparisonState,
} from '#/components/component-compare/types'

/**
 * The quantity-field pair's load-bearing measurements, pinned.
 *
 * The comparison record
 * (`docs/knowledge/design/component-comparison-record.md`, row 2) declines this
 * candidate on two facts, and both are asserted here against the code that
 * renders in the harness — not against a description of it:
 *
 * 1. the candidate's visible field is `type="text"` and displays the value
 *    through the browser's number formatter, so at its defaults a quantity of
 *    `1e-21` is shown as `0` while the value itself survives in a second,
 *    non-tabbable input. Our field shows the digits that were entered;
 * 2. the candidate's step buttons are not on the keyboard path
 *    (`tabindex="-1"`), so the stepper the plan named is a pointer affordance
 *    only, and both columns expose one tab stop per row.
 *
 * If an adopter configures the item's `format` prop, fact 1 stops being true
 * and the row must be re-measured rather than inherited — which is what
 * pinning it here is for.
 */

const scenario = (
  fixtureId: string,
  state: ComparisonState = 'ready',
): ComparisonColumnProps['scenario'] => ({
  fixture: findFixture(fixtureId),
  state,
  onRetry: () => {},
})

const inputsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-row-id]')].map((row) => [
    ...row.querySelectorAll('input'),
  ])

/** The browser's own rule, near enough: no `tabindex="-1"`, not disabled. */
const tabbablesOf = (root: HTMLElement) =>
  [
    ...root.querySelectorAll<HTMLElement>(
      'input, button, select, textarea, a[href], [tabindex]',
    ),
  ].filter(
    (element) =>
      element.getAttribute('tabindex') !== '-1' &&
      !(element as HTMLInputElement).disabled &&
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  )

describe('ours: the v3 Input with type="number"', () => {
  it('shows the digits that were entered, scientific notation included', () => {
    const { container } = render(
      <OursQuantityColumn scenario={scenario('high-precision')} />,
    )
    const inputs = inputsOf(container).map((row) => row[0])
    expect(inputs.map((input) => input.type)).toEqual(Array(9).fill('number'))
    // The fixture's point: no digit is lost on the way to the screen.
    expect(inputs.map((input) => input.value)).toEqual([
      String(1 / 3),
      String(0.1 * 3),
      String(6.02214076e23),
      String(1.602176634e-19),
      String(0.1 + 0.2),
      String(1234567.8901234567),
      String(1 - Number.EPSILON / 2),
      String(1e-21),
      String(Number.EPSILON),
    ])
  })

  it('has one tab stop per row', () => {
    const { container } = render(
      <OursQuantityColumn scenario={scenario('long-labels')} />,
    )
    const rows = container.querySelectorAll('[data-row-id]').length
    expect(tabbablesOf(container).length / rows).toBe(1)
  })
})

describe('theirs: the ReUI number field', () => {
  it('displays the value through a formatter, so small quantities read as 0', () => {
    const { container } = render(
      <TheirsQuantityColumn scenario={scenario('high-precision')} />,
    )
    const rows = inputsOf(container)
    // The visible field is the item's text input; the number input beside it is
    // the value carrier and is not a tab stop.
    const visible = rows.map((row) => row[0])
    const carriers = rows.map((row) => row[1])
    expect(visible.map((input) => input.type)).toEqual(Array(9).fill('text'))
    expect(carriers.map((input) => input.type)).toEqual(Array(9).fill('number'))
    expect(carriers.map((input) => input.getAttribute('tabindex'))).toEqual(
      Array(9).fill('-1'),
    )

    // The value survives in the carrier...
    expect(Number(carriers[7]?.value)).toBe(1e-21)
    // ...and is rounded away in the field the scientist reads. This is the
    // measurement the decline rests on: not the exact string, which is the
    // engine's formatter, but that the displayed number is no longer the value.
    expect(Number(visible[7]?.value)).toBe(0)
    expect(Number(visible[3]?.value)).toBe(0)
    expect(Number(visible[8]?.value)).toBe(0)
    expect(visible[5]?.value).not.toBe('1234567.8901234567')
  })

  it('keeps its step buttons off the keyboard path', () => {
    const { container } = render(
      <TheirsQuantityColumn scenario={scenario('single')} />,
    )
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    expect(buttons.map((button) => button.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
    ])
  })

  it('has one tab stop per row', () => {
    const { container } = render(
      <TheirsQuantityColumn scenario={scenario('long-labels')} />,
    )
    const rows = container.querySelectorAll('[data-row-id]').length
    expect(tabbablesOf(container).length / rows).toBe(1)
  })
})

describe('both columns on the mixed-type fixture', () => {
  it('refuses a value that is not a number, each at its own boundary', () => {
    for (const Column of [OursQuantityColumn, TheirsQuantityColumn]) {
      const { container } = render(
        <Column scenario={scenario('mixed-types')} />,
      )
      const inputs = inputsOf(container)
      // Row 3 is `not determined (below LOQ)`, row 2 a date, row 5 a localised
      // number and row 4 a null: neither side shows any of them.
      for (const index of [2, 3, 4, 5]) {
        expect(inputs[index]?.[0]?.value).toBe('')
      }
      // Row 0 is a number on both sides.
      expect(inputs[0]?.[0]?.value).toBe('0.412')
    }
  })
})
