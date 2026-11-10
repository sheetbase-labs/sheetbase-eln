import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight']) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

const requests: Request[] = []
let refuseRemoval = false
let removed = false

const rule = {
  id: 'rule-1',
  workspace_id: 'ws',
  model_key: 'contact',
  name: 'Range check',
  field_keys: ['value'],
  condition: { field: 'value', op: 'gt', value: 10 },
  effect: 'warn',
  message: 'Value is out of range',
  created_at: '2026-11-09T00:00:00Z',
  updated_at: '2026-11-09T00:00:00Z',
}

const fixtureFetch: typeof fetch = (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  requests.push(request)
  const url = new URL(request.url)

  if (
    request.method === 'POST' &&
    url.pathname === '/api/db/rpc/remove_model_rule'
  ) {
    if (refuseRemoval) {
      return Promise.resolve(
        Response.json(
          {
            error: { code: 'conflict', message: 'Rule is in use.' },
          },
          { status: 409 },
        ),
      )
    }

    removed = true

    return Promise.resolve(Response.json(null))
  }

  if (request.method === 'GET') {
    switch (url.pathname) {
      case '/api/db/model_rules':
        return Promise.resolve(Response.json(removed ? [] : [rule]))
      case '/api/db/record_models':
        return Promise.resolve(
          Response.json([{ id: 'model-1', name: 'Contact' }]),
        )
      case '/api/db/record_model_versions':
        return Promise.resolve(
          Response.json(
            url.searchParams.has('model_id')
              ? [{ id: 'version-1' }]
              : [
                  {
                    definition: {
                      fields: [
                        {
                          id: 'field-1',
                          field_name: 'value',
                          label: 'Value',
                          logical_type: 'decimal',
                          nullable: true,
                          display_order: 0,
                          lifecycle: 'active',
                          validation: {},
                          options: [],
                        },
                      ],
                    },
                  },
                ],
          ),
        )
    }
  }

  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}

// Keep the real singleton DataClient and domain mappers; fixture only HTTP.
vi.stubGlobal('fetch', fixtureFetch)

const { Route } = await import('./rules')
const { dropSharedReads } = await import('#/lib/data-client')

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

afterEach(() => {
  cleanup()
  client.clear()
  dropSharedReads()
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  requests.length = 0
  refuseRemoval = false
  removed = false
})

async function renderScreen() {
  const root = createRootRoute({
    beforeLoad: () => ({ context: { workspace: { id: 'ws', role: 'owner' } } }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/models/$modelId/rules',
    component: Route.options.component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/models/contact/rules'] }),
  })

  await router.load()

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('model rules', () => {
  it('confirms before removing a rule', async () => {
    const user = userEvent.setup()
    await renderScreen()
    await screen.findByText('Range check')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(
      requests.filter((request) => request.method === 'POST'),
    ).toHaveLength(0)
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }))
    await screen.findByText('No rules yet')
    const writes = requests.filter((request) => request.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.url).toBe('http://localhost/api/db/rpc/remove_model_rule')
    expect(await writes[0]?.json()).toEqual({ p_rule_id: 'rule-1' })
    expect(screen.queryByText('Range check')).toBeNull()
  })

  it('shows why a refused removal failed', async () => {
    const user = userEvent.setup()
    refuseRemoval = true
    await renderScreen()
    await screen.findByText('Range check')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Rule is in use.',
    )
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.getByText('Range check')).toBeTruthy()
  })
})
