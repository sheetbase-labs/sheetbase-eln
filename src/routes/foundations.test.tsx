import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './foundations'

/**
 * The /foundations catalogue is development-only (UI-008). In production
 * builds `beforeLoad` redirects to `/`; in dev and test it renders.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/foundations route gate (UI-008)', () => {
  it('does not redirect in dev/test', () => {
    expect(() => Route.options.beforeLoad?.({} as never)).not.toThrow()
  })

  it('redirects to / in production builds', () => {
    vi.stubEnv('PROD', true)
    try {
      Route.options.beforeLoad?.({} as never)
      throw new Error('expected beforeLoad to throw a redirect')
    } catch (err) {
      // TanStack Router redirects by throwing a Response (307) whose
      // `options` carry the destination.
      expect(err).toBeInstanceOf(Response)
      const res = err as Response & { options?: { to?: string } }
      expect(res.status).toBe(307)
      expect(res.options?.to).toBe('/')
    }
  })
})
