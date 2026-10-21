/**
 * R5-SHELL-05 — the sign-in surface's reachable states and its honest
 * absences.
 *
 * The product signs in with GitHub OAuth only: there is no password sign-in
 * and no sign-in attempt limit, so the design's `password` and `locked`
 * states are stated plainly rather than rendered as forms that cannot work.
 * The one lock the product has is the signing-password lock, enforced by the
 * step-up endpoint; nothing on this surface can unlock it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignInSurface, Route, states } from './sign-in'
import type { SignInState, SignInSurfaceProps } from './sign-in'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const release = {
  version: '1.4.0',
  build: '1.4.0',
  released: '',
  validation: { tone: 'ok' as const, label: 'Validated', detail: '' },
  statement: '21 CFR Part 11 / EU GMP Annex 11 controlled system',
}

function renderSurface(props: Partial<SignInSurfaceProps> = {}) {
  return render(
    <SignInSurface
      devAuthFree={false}
      githubEnabled
      release={release}
      retainedDrafts={0}
      {...props}
    />,
  )
}

function credentialInputs(): HTMLElement[] {
  return [
    ...document.querySelectorAll('input'),
    ...document.querySelectorAll('form'),
  ] as HTMLElement[]
}

describe('R5-SHELL-05 sign-in states', () => {
  it('defaults to company SSO and names the only sign-in method', () => {
    renderSurface()
    expect(
      screen.getByRole('heading', { name: 'Sign in to Sheetbase' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    ).toBeTruthy()
    expect(
      screen.getByText(/open the invitation link you were sent/i),
    ).toBeTruthy()
    expect(credentialInputs()).toHaveLength(0)
  })

  it('reports a signed-out session and keeps drafts only when the marker says so', () => {
    const { unmount } = renderSurface({
      state: 'signed-out',
      retainedDrafts: 2,
    })
    expect(
      screen.getByRole('heading', { name: 'You’re signed out' }),
    ).toBeTruthy()
    expect(
      screen.getByText(/Unsaved edits on this device were kept/i),
    ).toBeTruthy()
    unmount()

    renderSurface({ state: 'signed-out', retainedDrafts: 0 })
    expect(screen.getByText(/You signed out of this browser/i)).toBeTruthy()
    expect(screen.queryByText(/were kept/i)).toBeNull()
  })

  it('explains the signing session that ended and returns to the review after sign-in', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    renderSurface({ state: 'expired-signing', next: '/review/rev-42' })

    expect(
      screen.getByRole('heading', {
        name: 'Sign in again to finish signing',
      }),
    ).toBeTruthy()
    expect(screen.getByText(/The record wasn’t signed/i)).toBeTruthy()
    expect(screen.getByText(/nothing was recorded/i)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/sign-in/social')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'github',
      callbackURL: '/review/rev-42',
    })
  })

  it('states plainly that password sign-in is not offered', () => {
    renderSurface({ state: 'password' })
    expect(screen.getByText('Password sign-in is not available.')).toBeTruthy()
    expect(
      screen.getByText(/A password is asked for only when you sign a record/i),
    ).toBeTruthy()
    expect(credentialInputs()).toHaveLength(0)
  })

  it('sso-only is the product’s real state', () => {
    renderSurface({ state: 'sso-only' })
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    ).toBeTruthy()
    expect(
      screen.getByText(/open the invitation link you were sent/i),
    ).toBeTruthy()
    expect(credentialInputs()).toHaveLength(0)
  })

  it('states that sign-in has no lock instead of showing a fabricated unlock flow', () => {
    renderSurface({ state: 'locked' })
    expect(screen.getByText('There is nothing to unlock here.')).toBeTruthy()
    expect(screen.getByText(/sign-in has no attempt limit/i)).toBeTruthy()
    expect(
      screen.getByText(/three wrong attempts lock signing for 15 minutes/i),
    ).toBeTruthy()
    // The design's fabricated reference and admin-unlock copy must not appear.
    expect(screen.queryByText(/LCK-/)).toBeNull()
    expect(screen.queryByText(/administrator unlocks/i)).toBeNull()
  })

  it('maps a raw provider error to an actionable message', () => {
    renderSurface({ error: 'access_denied' })
    expect(screen.getByRole('alert').textContent).toContain(
      'GitHub sign-in was declined',
    )
  })

  it('shows the environment notice when dev auth-free is on', () => {
    renderSurface({ devAuthFree: true })
    expect(
      screen.getByText(/No sign-in or OAuth setup is required/i),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull()
  })

  it('states the open access posture of an auth-free environment and offers a way onward', () => {
    renderSurface({ devAuthFree: true, next: '/inbox' })

    // An environment that needs no sign-in cannot also be described as an
    // authorised-users-only controlled system.
    expect(screen.queryByText(/Authorised users only/i)).toBeNull()
    expect(screen.queryByText(/controlled system/i)).toBeNull()
    expect(screen.getByText(/Open preview environment/i)).toBeTruthy()

    // The page had no link at all, so a visitor landing here by URL had no way
    // into the app.
    expect(
      screen
        .getByRole('link', { name: 'Continue to Sheetbase' })
        .getAttribute('href'),
    ).toBe('/inbox')
  })

  it('sends an open environment to the app root when no return path is given', () => {
    renderSurface({ devAuthFree: true })
    expect(
      screen
        .getByRole('link', { name: 'Continue to Sheetbase' })
        .getAttribute('href'),
    ).toBe('/')
  })

  it('keeps the release statement where the deployment enforces it', () => {
    renderSurface()
    expect(screen.getByText(/controlled system/i)).toBeTruthy()
    expect(screen.getByText(/Authorised users only/i)).toBeTruthy()
    expect(screen.queryByText(/Open preview environment/i)).toBeNull()
  })

  it('says no method is configured rather than rendering a dead button', () => {
    renderSurface({ githubEnabled: false })
    expect(
      screen.getByText(
        /No sign-in method is configured for this environment yet/i,
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull()
  })
})

describe('R5-SHELL-05 — the callback stays on this origin', () => {
  const validateSearch = Route.options.validateSearch as (search: {
    [key: string]: unknown
  }) => { next?: string }

  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'evil.example',
    '/review/rev-42\n',
  ])('drops %s as a return path', (next) => {
    // Anything that is not a rooted path on this origin would take the person
    // off-site after sign-in, so the route refuses it and the callback falls
    // back to the app root.
    expect(validateSearch({ next }).next).toBeUndefined()
  })

  it('keeps a same-origin return path', () => {
    expect(validateSearch({ next: '/review/rev-42' }).next).toBe(
      '/review/rev-42',
    )
  })

  it('never hands a protocol-relative return path to the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    renderSurface({ state: 'expired-signing', next: '//evil.example' })

    fireEvent.click(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'github',
      callbackURL: '/',
    })
  })

  it('says the provider could not be reached instead of doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderSurface()

    fireEvent.click(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    )
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /could not reach github/i,
    )
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    ).toBeTruthy()
  })
})

describe('R5-SHELL-05 — a locked-out person cannot bypass the lock through a direct URL', () => {
  it.each<[SignInState | undefined]>([
    ...states.map((state) => [state] as [SignInState]),
    [undefined],
  ])('offers no credential path in state %s', (state) => {
    // Whatever sign-in URL a locked-out person opens (any `?state=` value),
    // this surface exposes no password/email form and no second method: the
    // signing lock lives on the step-up endpoint and cannot be unlocked here.
    renderSurface({ state })
    expect(credentialInputs()).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    ).toBeTruthy()
  })
})

describe('company OIDC and emailed sign-in link', () => {
  it('starts company sign-in through the OIDC endpoint and returns to the requested path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    renderSurface({
      githubEnabled: false,
      oidcName: 'Acme SSO',
      next: '/inbox',
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Continue with Acme SSO/ }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/sign-in/oauth2')
    expect(JSON.parse(String(init.body))).toEqual({
      providerId: 'oidc',
      callbackURL: '/inbox',
    })
  })

  it('offers both providers when both are configured', () => {
    renderSurface({ oidcName: 'Acme SSO' })
    expect(
      screen.getByRole('button', { name: /Continue with Acme SSO/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ }),
    ).toBeTruthy()
  })

  it('shows the email form only when the environment can send the link', () => {
    const { unmount } = renderSurface()
    expect(screen.queryByLabelText(/emailed link/i)).toBeNull()
    unmount()
    renderSurface({ githubEnabled: false, emailLinkEnabled: true })
    expect(screen.getByLabelText(/emailed link/i)).toBeTruthy()
    expect(screen.queryByText(/No sign-in method is configured/i)).toBeNull()
  })

  it('asks for a link and answers the same whoever the address belongs to', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    renderSurface({
      githubEnabled: false,
      emailLinkEnabled: true,
      next: '/review/rev-42',
    })

    fireEvent.change(screen.getByLabelText(/emailed link/i), {
      target: { value: ' Someone@Example.com ' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/sign-in/magic-link')
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'Someone@Example.com',
      callbackURL: '/review/rev-42',
      errorCallbackURL: '/sign-in',
    })
    expect(
      await screen.findByText(/If Someone@Example.com can sign in/),
    ).toBeTruthy()
  })

  it('says the link could not be requested instead of pretending it was sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    )
    renderSurface({ githubEnabled: false, emailLinkEnabled: true })
    fireEvent.change(screen.getByLabelText(/emailed link/i), {
      target: { value: 'a@b.test' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    )
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /could not be requested/i,
    )
  })

  it('maps an expired link to an actionable message', () => {
    renderSurface({ error: 'EXPIRED_TOKEN' })
    expect(screen.getByRole('alert').textContent).toMatch(
      /expired or was already used/i,
    )
  })
})
