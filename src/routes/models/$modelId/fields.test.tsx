/**
 * J-DAT-12 — the "No version yet" empty state points at the control that
 * exists (Edit model, then Start draft) and links to it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const MODEL_ID = '00000000-0000-4000-8000-00000000d001'
const requests: Request[] = []

const fixtureFetch: typeof fetch = (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  requests.push(request)
  const { pathname } = new URL(request.url)

  if (
    request.method === 'GET' &&
    (pathname === '/api/db/dataset_schema_versions' ||
      pathname === '/api/db/dataset_schema_definitions')
  ) {
    return Promise.resolve(Response.json([]))
  }

  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}

// The singleton DataClient captures fetch at import time; replace only HTTP.
vi.stubGlobal('fetch', fixtureFetch)

const { Route } = await import('./fields')

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

afterAll(() => vi.unstubAllGlobals())

describe('Model fields tab — no version', () => {
  it('links to Edit model and names who can start a version', async () => {
    const root = createRootRoute({
      beforeLoad: () => ({
        auth: { dataAccess: false },
        context: { workspace: null },
      }),
    })

    const fields = createRoute({
      getParentRoute: () => root,
      path: '/models/$modelId/fields',
      component: Route.options.component,
      validateSearch: Route.options.validateSearch,
    })

    const edit = createRoute({
      getParentRoute: () => root,
      path: '/models/$modelId/edit',
    })

    const router = createRouter({
      routeTree: root.addChildren([fields, edit]),
      history: createMemoryHistory({
        initialEntries: [`/models/${MODEL_ID}/fields`],
      }),
    })

    await router.load()
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('No version yet')).toBeTruthy()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(
      requests.some((request) => {
        const url = new URL(request.url)

        return (
          url.pathname === '/api/db/dataset_schema_versions' &&
          url.searchParams.get('schema_id') === `eq.${MODEL_ID}`
        )
      }),
    ).toBe(true)
    expect(screen.queryByText(/from the header/)).toBeNull()
    expect(
      screen.getByText('Edit model', { selector: 'a' }).getAttribute('href'),
    ).toBe(`/models/${MODEL_ID}/edit`)
    expect(screen.getByText(/choose Start draft/)).toBeTruthy()
    expect(screen.getByText(/owners and admins/)).toBeTruthy()
  })
})
