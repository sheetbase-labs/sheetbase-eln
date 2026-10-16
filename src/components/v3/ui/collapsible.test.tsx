import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from './collapsible'

/**
 * The disclosure contract six sites now depend on: the control states whether
 * the panel is open, and the panel is associated with it.
 */

afterEach(cleanup)

function Disclosure() {
  return (
    <Collapsible>
      <CollapsibleTrigger>Agreement and start date</CollapsibleTrigger>
      <CollapsiblePanel>AG-2026-014</CollapsiblePanel>
    </Collapsible>
  )
}

describe('Collapsible', () => {
  it('states its state on the control, and associates the panel with it', async () => {
    const user = userEvent.setup()
    render(<Disclosure />)

    const trigger = screen.getByRole('button', {
      name: 'Agreement and start date',
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const panelId = trigger.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)?.textContent).toBe(
      'AG-2026-014',
    )
  })

  it('opens from the keyboard', async () => {
    const user = userEvent.setup()
    render(<Disclosure />)

    await user.tab()
    await user.keyboard('{Enter}')

    expect(
      screen
        .getByRole('button', { name: 'Agreement and start date' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('does not mount the panel while it is closed', () => {
    render(<Disclosure />)
    expect(screen.queryByText('AG-2026-014')).toBeNull()
  })
})
