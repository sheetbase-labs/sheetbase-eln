import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './foundations'

/**
 * The /foundations catalogue is development-only (UI-008). In production
 * builds `beforeLoad` redirects to `/`; in dev and test it renders.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * Run the route's `beforeLoad`. The gate declares no parameters and reads only
 * `import.meta.env.PROD`, so the router's argument is never observed.
 */
function runGate() {
  // SAFETY: `beforeLoad` takes no parameters and reads only the build flag;
  // the router passes a context object that the gate never touches.
  Route.options.beforeLoad?.({} as never)
}

describe('/foundations route gate (UI-008)', () => {
  it('does not redirect in dev/test', () => {
    expect(() => runGate()).not.toThrow()
  })

  it('redirects to / in production builds', () => {
    vi.stubEnv('PROD', true)

    try {
      runGate()
      throw new Error('expected beforeLoad to throw a redirect')
    } catch (err) {
      // TanStack Router redirects by throwing a Response (307) whose
      // `options` carry the destination.
      expect(err).toBeInstanceOf(Response)
      // SAFETY: The instanceof check above establishes a Response; TanStack
      // Router attaches the destination it redirected to as `options` on the
      // Response it throws, which is the only field read here.
      const res = err as Response & { options?: { to?: string } }
      expect(res.status).toBe(307)
      expect(res.options?.to).toBe('/')
    }
  })
})
