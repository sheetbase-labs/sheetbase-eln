/**
 * The shared Checkbox. Every call site wraps it in a `<label>` that carries the
 * visible text, so the control must be the element that label labels — Base
 * UI's default `<span>` left the label pointing at the visually hidden input
 * and the control with no accessible name.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Checkbox } from './checkbox'

afterEach(cleanup)

describe('Checkbox', () => {
  it('is the control its wrapping label labels', () => {
    render(
      <label>
        <Checkbox />
        Start the experiment now
      </label>,
    )

    const box = screen.getByRole('checkbox')
    expect(box.closest('label')?.control).toBe(box)
    expect(
      screen.getByRole('checkbox', { name: 'Start the experiment now' }),
    ).toBe(box)
  })

  it('toggles from the control and from the label text', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <label>
        <Checkbox onCheckedChange={onCheckedChange} />
        Start the experiment now
      </label>,
    )

    await user.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())

    await user.click(screen.getByText('Start the experiment now'))
    expect(onCheckedChange).toHaveBeenLastCalledWith(false, expect.anything())
  })

  it('toggles with the keyboard when it has focus', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox onCheckedChange={onCheckedChange} aria-label="Approve" />)

    await user.tab()
    const box = screen.getByRole('checkbox')
    expect(document.activeElement).toBe(box)
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())
  })
})
