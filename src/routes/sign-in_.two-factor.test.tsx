import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { z } from 'zod'

import { Route, TwoFactorSurface } from './sign-in_.two-factor'
import { parseTwoFactorSearch } from './-sign-in-search'

// Better Auth captures fetch when its real client is created, before tests run.
const authFetch = vi.hoisted(() => {
  const transport = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', transport)

  return transport
})

afterEach(() => {
  cleanup()
  authFetch.mockReset()
  vi.unstubAllGlobals()
})

function renderPrompt(props: ComponentProps<typeof TwoFactorSurface> = {}) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <RouterContextProvider router={router}>
      <TwoFactorSurface {...props} />
    </RouterContextProvider>,
  )
}

function verificationHttp(failure?: string) {
  const requests: { path: string; code: string }[] = []

  authFetch.mockImplementation(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    )

    expect([
      '/api/auth/two-factor/verify-totp',
      '/api/auth/two-factor/verify-backup-code',
    ]).toContain(url.pathname)
    expect(init?.method).toBe('POST')

    const body = z
      .object({ code: z.string() })
      .parse(await new Response(init?.body).json())

    requests.push({ path: url.pathname, code: body.code })

    return failure
      ? Response.json({ message: failure }, { status: 400 })
      : Response.json({
          token: 'fixture-token',
          user: { id: 'fixture-user' },
        })
  })

  return requests
}

describe('two-factor code prompt', () => {
  it('focuses the challenge and clears code and error when switching modes', async () => {
    verificationHttp('Invalid code')
    renderPrompt()
    const challenge = screen.getByLabelText('6-digit code')

    expect(document.activeElement).toBe(challenge)
    expect(challenge.getAttribute('inputmode')).toBe('numeric')
    fireEvent.change(challenge, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }))
    expect(screen.getByLabelText('Backup code')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Backup code').getAttribute('inputmode')).toBe(
      'text',
    )
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'unused' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Use my authenticator app' }),
    )
    expect(screen.getByLabelText('6-digit code')).toHaveProperty('value', '')
  })

  it('signs in and returns to the requested path when the code is accepted', async () => {
    const requests = verificationHttp()
    const onSignedIn = vi.fn()
    renderPrompt({ next: '/review/rev-42', onSignedIn })

    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123 456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(onSignedIn).toHaveBeenCalledWith('/review/rev-42'),
    )
    expect(requests).toEqual([
      { path: '/api/auth/two-factor/verify-totp', code: '123456' },
    ])
  })

  it('keeps the person here and says why when the code is refused', async () => {
    verificationHttp('Invalid code')
    const onSignedIn = vi.fn()
    renderPrompt({ onSignedIn })
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid code',
    )
    expect(onSignedIn).not.toHaveBeenCalled()
    verificationHttp()
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('switches to a one-time backup code', async () => {
    const requests = verificationHttp()
    renderPrompt({ onSignedIn: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }))
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'abcd-efgh' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(requests).toEqual([
        { path: '/api/auth/two-factor/verify-backup-code', code: 'abcd-efgh' },
      ]),
    )
  })

  it('never returns to an off-site path', async () => {
    verificationHttp()
    const onSignedIn = vi.fn()
    renderPrompt({ next: '//evil.example', onSignedIn })
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/'))
  })

  it('drops an off-site return path from the URL', () => {
    const validateSearch = parseTwoFactorSearch

    expect(Route.options.validateSearch).toBe(validateSearch)
    expect(validateSearch({ next: '//evil.example' }).next).toBeUndefined()
    expect(validateSearch({ next: '/inbox' }).next).toBe('/inbox')
  })

  it('clears a rejected verification busy state and allows another attempt', async () => {
    const onSignedIn = vi.fn()
    renderPrompt({
      verify: async () => {
        throw new Error('Transport refused')
      },
      onSignedIn,
    })
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /couldn’t reach/i,
    )
    expect(
      screen.getByRole('button', { name: 'Verify and sign in' }),
    ).toHaveProperty('disabled', false)
    expect(onSignedIn).not.toHaveBeenCalled()
  })
})
