import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Choice } from './choice'
import { Secret } from './secret'

afterEach(cleanup)

describe('Choice', () => {
  it('renders a labelled radio with its consequence line', () => {
    render(
      <Choice
        type="radio"
        name="target"
        title="Existing dataset"
        description="Adds a version to DS-0311"
        defaultChecked
      />,
    )
    const radio = screen.getByRole('radio', { name: /Existing dataset/ })
    expect(radio).toBeTruthy()
    expect(screen.getByText('Adds a version to DS-0311')).toBeTruthy()
  })

  it('marks the disabled state', () => {
    render(<Choice title="New dataset" disabled />)
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true)
  })
})

describe('Secret', () => {
  it('copies the value and confirms', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    const onCopy = vi.fn()
    render(<Secret value="sb_live_123" onCopy={onCopy} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('sb_live_123')
    expect(onCopy).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })
})
