import { describe, expect, it, vi } from 'vitest'

import { ROOT_CONTEXT_QUERY_KEY } from './lib/root-context-cache'
import { getRouter } from './router'

// The real route tree reads server configuration; this test is about the
// router's own behaviour, so a bare root route stands in for it.
// oxlint-disable-next-line anti-slop/no-module-mocking -- The generated route tree reads server configuration at import time; this test is about the router's own behaviour, so the module boundary supplies a bare root route.
vi.mock('./routeTree.gen', async () => {
  const { createRootRoute } = await import('@tanstack/react-router')

  return { routeTree: createRootRoute() }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- The root route module imports the not-found screen, which the router never renders here; the boundary replaces that screen.
vi.mock('#/components/shell/not-found', () => ({ NotFound: () => null }))

describe('getRouter', () => {
  it('drops the cached root context whenever the router is invalidated', async () => {
    const router = getRouter()
    const { queryClient } = router.options.context
    queryClient.setQueryData(ROOT_CONTEXT_QUERY_KEY, { cached: true })
    await router.invalidate().catch(() => undefined)
    expect(queryClient.getQueryData(ROOT_CONTEXT_QUERY_KEY)).toBeUndefined()
  })

  it('keeps other cached queries', async () => {
    const router = getRouter()
    const { queryClient } = router.options.context
    queryClient.setQueryData(['experiments'], ['EXP-1'])
    await router.invalidate().catch(() => undefined)
    expect(queryClient.getQueryData(['experiments'])).toEqual(['EXP-1'])
  })
})
