import { afterEach, describe, expect, it } from 'vitest'

import { Route } from './$section'

afterEach(() => {
  // no env stubs
})

describe('/admin/$section route gate', () => {
  it('redirects legacy model-fields URLs to Configuration', () => {
    try {
      Route.options.beforeLoad?.({
        params: { section: 'model-fields' },
        search: { model: 'report' },
      } as never)
      throw new Error('expected beforeLoad to throw a redirect')
    } catch (err) {
      expect(err).toBeInstanceOf(Response)
      const res = err as Response & {
        options?: { to?: string; search?: Record<string, unknown> }
      }
      expect(res.status).toBe(307)
      expect(res.options?.to).toBe('/configure')
      expect(res.options?.search).toEqual({
        kind: 'model',
        id: undefined,
        model: 'report',
      })
    }
  })

  it('lets the extensions section through (EXT-03)', () => {
    expect(() =>
      Route.options.beforeLoad?.({
        params: { section: 'extensions' },
        search: {},
      } as never),
    ).not.toThrow()
  })

  it('redirects unknown sections to the dashboard', () => {
    try {
      Route.options.beforeLoad?.({
        params: { section: 'nope' },
        search: {},
      } as never)
      throw new Error('expected beforeLoad to throw a redirect')
    } catch (err) {
      expect(err).toBeInstanceOf(Response)
      const res = err as Response & {
        options?: { to?: string; params?: Record<string, unknown> }
      }
      expect(res.options?.to).toBe('/admin/$section')
      expect(res.options?.params).toEqual({ section: 'dashboard' })
    }
  })
})
