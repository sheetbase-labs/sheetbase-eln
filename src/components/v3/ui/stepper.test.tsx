import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Stepper } from './stepper'

/**
 * The forward kit's progress row. Its shipped contract is asserted in a real
 * browser by `tests/browser/import-flow.test.ts:185-193` — a list named
 * "Steps", one listitem per step, `aria-current="step"` on the current one —
 * and pinned here so a regression fails in a unit run rather than in the
 * import flow. The `failed` marker is this component's own: the flow reserves
 * it for a file the server could not read, and no browser test asserts it is
 * *shown*, only that it is absent when the file was merely unrecognised.
 */

const STEPS = ['Upload', 'Map columns', 'Review and import']

afterEach(cleanup)

describe('Stepper', () => {
  it('renders the shipped contract: a list named "Steps", one item per step, aria-current on the current one', () => {
    render(<Stepper steps={STEPS} current={2} />)

    const list = screen.getByRole('list', { name: 'Steps' })
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(STEPS.length)
    expect(items.map((item) => item.textContent)).toEqual([
      'Upload',
      '2Map columns',
      '3Review and import',
    ])
    expect(items[1].getAttribute('aria-current')).toBe('step')
    expect(items[0].hasAttribute('aria-current')).toBe(false)
    expect(items[2].hasAttribute('aria-current')).toBe(false)
    expect(list).toBeTruthy()
  })

  it('names the list from the label prop when a surface needs a different one', () => {
    render(<Stepper steps={STEPS} current={1} label="Import progress" />)

    expect(screen.getByRole('list', { name: 'Import progress' })).toBeTruthy()
  })

  it('marks the steps behind the current one as done and the current one as now', () => {
    render(<Stepper steps={STEPS} current={2} />)
    const items = screen.getAllByRole('listitem')

    // Done steps carry a tick instead of their number; the current one keeps
    // its number, so the row says where you are and not only how far you got.
    expect(items[0].textContent).toBe('Upload')
    expect(items[1].textContent).toBe('2Map columns')
    expect(items[2].textContent).toBe('3Review and import')
  })

  it('marks the current step as failed with the reserved marker, and only that step', () => {
    render(<Stepper steps={STEPS} current={2} failed />)
    const items = screen.getAllByRole('listitem')

    expect(items[1].textContent).toBe('!Map columns')
    expect(screen.getAllByText('!')).toHaveLength(1)
    // A failed step is still the current one.
    expect(items[1].getAttribute('aria-current')).toBe('step')
  })
})
