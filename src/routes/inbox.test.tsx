import { describe, expect, it } from 'vitest'

import { Route } from './inbox'

/** WORK-02.3 — the Inbox is an authenticated route. */
describe('/inbox route', () => {
  it('redirects to sign-in when unauthenticated', async () => {
    await expect(
      Route.options.beforeLoad?.({ context: { auth: null } } as never),
    ).rejects.toBeInstanceOf(Response)
  })

  it('passes the auth context through when authenticated', async () => {
    const auth = {
      workspace: { name: 'Process Development' },
      user: { name: 'Gareth P.', email: 'gareth.p@design.sheetbase.dev' },
    }
    await expect(
      Route.options.beforeLoad?.({ context: { auth } } as never),
    ).resolves.toEqual({ context: auth })
  })
})
