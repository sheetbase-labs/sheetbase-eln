import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

import { IconButton } from './icon-button'

afterEach(cleanup)

describe('IconButton', () => {
  it('names the button by its label and has no visible text', () => {
    render(<IconButton label="Edit" icon="edit" />)
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg')).toBeTruthy()
  })

  it('passes clicks through', async () => {
    const onClick = vi.fn()
    render(<IconButton label="Edit" icon="edit" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
