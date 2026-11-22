import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LinkDialog } from './link-dialog'

afterEach(cleanup)

describe('LinkDialog', () => {
  it('will not add a link until an address is typed', async () => {
    render(<LinkDialog onSubmit={vi.fn()} onClose={vi.fn()} />)

    const add = await screen.findByRole('button', { name: 'Add link' })

    expect(add).toHaveProperty('disabled', true)
  })

  it('hands the typed address back and closes', async () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()

    render(<LinkDialog onSubmit={onSubmit} onClose={onClose} />)

    const field = await screen.findByLabelText('Link URL')

    await userEvent.clear(field)
    await userEvent.type(field, 'https://example.org/protocol')
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))

    expect(onSubmit).toHaveBeenCalledWith('https://example.org/protocol')
    expect(onClose).toHaveBeenCalled()
  })
})
