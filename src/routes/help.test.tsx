import { describe, expect, it, vi } from 'vitest'

import {
  OPEN_SHORTCUTS_EVENT,
  requestShortcutsDialog,
} from '#/lib/shortcuts-dialog'

import { Route } from './help'

/**
 * WORK-02.4 — the Help page is an authenticated static route; the shortcuts
 * helper opens the shell's registry-generated dialog from outside the shell.
 */
describe('/help route (WORK-02.4)', () => {
  it('redirects to sign-in when unauthenticated', async () => {
    // SAFETY: help.tsx's beforeLoad reads only `context.auth` and `location`; this harness supplies both and the router supplies the rest of its argument in production.
    const args = {
      context: { auth: null },
      location: { href: '/help?topic=signing' },
    } as never

    await expect(Route.options.beforeLoad?.(args)).rejects.toMatchObject({
      options: { to: '/sign-in', search: { next: '/help?topic=signing' } },
    })
  })

  it('passes the auth context through when authenticated', async () => {
    const auth = {
      workspace: { name: 'Process Development' },
      user: { name: 'Gareth P.', email: 'gareth.p@design.sheetbase.dev' },
    }

    // SAFETY: help.tsx's beforeLoad reads only `context.auth`; this harness supplies it and the router supplies the rest of its argument in production.
    const args = { context: { auth } } as never

    await expect(Route.options.beforeLoad?.(args)).resolves.toEqual({
      context: auth,
    })
  })
})

describe('requestShortcutsDialog', () => {
  it('dispatches the shell event exactly once', () => {
    const listener = vi.fn()
    window.addEventListener(OPEN_SHORTCUTS_EVENT, listener)
    requestShortcutsDialog()
    window.removeEventListener(OPEN_SHORTCUTS_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
