import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route, TwoFactorSurface } from './sign-in_.two-factor'

afterEach(cleanup)

describe('two-factor code prompt', () => {
  it('signs in and returns to the requested path when the code is accepted', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    const onSignedIn = vi.fn()
    render(
      <TwoFactorSurface
        next="/review/rev-42"
        verify={verify}
        onSignedIn={onSignedIn}
      />,
    )

    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123 456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(onSignedIn).toHaveBeenCalledWith('/review/rev-42'),
    )
    expect(verify).toHaveBeenCalledWith({ code: '123456', backup: false })
  })

  it('keeps the person here and says why when the code is refused', async () => {
    const onSignedIn = vi.fn()
    render(
      <TwoFactorSurface
        verify={vi.fn().mockResolvedValue('Invalid code')}
        onSignedIn={onSignedIn}
      />,
    )
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid code',
    )
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('switches to a one-time backup code', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    render(<TwoFactorSurface verify={verify} onSignedIn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }))
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'abcd-efgh' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith({ code: 'abcd-efgh', backup: true }),
    )
  })

  it('never returns to an off-site path', async () => {
    const onSignedIn = vi.fn()
    render(
      <TwoFactorSurface
        next="//evil.example"
        verify={vi.fn().mockResolvedValue(null)}
        onSignedIn={onSignedIn}
      />,
    )
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/'))
  })

  it('drops an off-site return path from the URL', () => {
    const validateSearch = Route.options.validateSearch as (s: {
      [key: string]: unknown
    }) => { next?: string }
    expect(validateSearch({ next: '//evil.example' }).next).toBeUndefined()
    expect(validateSearch({ next: '/inbox' }).next).toBe('/inbox')
  })
})
