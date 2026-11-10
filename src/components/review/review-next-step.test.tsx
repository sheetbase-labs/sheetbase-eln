import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkItemWire } from '#/lib/work-items/data'

let respond: () => Promise<Response> = async () => Response.json([])

const transport = vi.fn<typeof fetch>(() => respond())

vi.stubGlobal('fetch', transport)

const { ReviewNextStepPanel } = await import('./review-next-step')
const { dropSharedReads } = await import('#/lib/data-client')
const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  dropSharedReads()

  for (const [input, init] of transport.mock.calls) {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    expect(url.pathname).toBe('/api/db/my_work_items')
    expect(url.searchParams.get('order')).toBe('due_at.asc,created_at.desc')
    expect(url.searchParams.get('limit')).toBe('200')
    expect(init?.method).toBe('GET')
  }

  transport.mockClear()
  respond = async () => Response.json([])
})

afterAll(() => vi.unstubAllGlobals())

const step = { headline: 'Waiting for your decision', detail: 'Approve it.' }

async function renderPanel(action?: { label: string; onClick: () => void }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  clients.push(client)
  const root = createRootRoute({ component: Outlet })

  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <ReviewNextStepPanel
        step={step}
        currentRevisionId="rev-now"
        action={action}
      />
    ),
  })

  const destination = createRoute({
    getParentRoute: () => root,
    path: '/review/$revisionId',
    component: () => <p>Review destination</p>,
  })

  const router = createRouter({
    routeTree: root.addChildren([index, destination]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { client, router }
}

function review(revisionId: string, identifier: string): WorkItemWire {
  return {
    kind: 'review_requested',
    record_id: 'r',
    identifier,
    title: 'T',
    project_id: null,
    reason: '',
    due_at: null,
    state: 'needs_action',
    created_at: null,
    revision_id: revisionId,
  }
}

describe('ReviewNextStepPanel', () => {
  it('states what happens next', async () => {
    await renderPanel()
    expect(screen.getByText('Waiting for your decision')).toBeTruthy()
    expect(screen.getByText('Approve it.')).toBeTruthy()
  })

  it('offers the next review waiting, and not the one on screen', async () => {
    respond = async () =>
      Response.json([review('rev-now', 'EXP-1'), review('rev-next', 'EXP-2')])
    const { router } = await renderPanel()

    const link = await screen.findByRole('button', {
      name: 'Next review: EXP-2',
    })

    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/review/rev-next')
    await userEvent.click(link)
    expect(await screen.findByText('Review destination')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/review/rev-next')
  })

  it('says so when nothing else is waiting', async () => {
    respond = async () => Response.json([review('rev-now', 'EXP-1')])
    await renderPanel()
    expect(
      await screen.findByText('No other reviews waiting for you'),
    ).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Next review/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Next review/ })).toBeNull()
    expect(screen.getByText('No other reviews waiting for you')).toBeTruthy()
  })

  it('does not claim an empty inbox before the read settles', async () => {
    let release: ((response: Response) => void) | undefined

    const response = new Promise<Response>((resolve) => {
      release = resolve
    })

    respond = () => response
    await renderPanel()
    await waitFor(() => expect(transport).toHaveBeenCalledOnce())
    expect(screen.queryByText('No other reviews waiting for you')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: /Next review/ })).toBeNull()
    release?.(Response.json([]))
    expect(
      await screen.findByText('No other reviews waiting for you'),
    ).toBeTruthy()
  })

  it('does not claim an empty inbox when the server refuses the read', async () => {
    respond = async () =>
      Response.json(
        { error: { code: 'denied', message: 'denied' } },
        { status: 403 },
      )
    const { client } = await renderPanel()
    await waitFor(() =>
      expect(client.getQueryState(['work-items', 'list'])?.status).toBe(
        'error',
      ),
    )
    expect(screen.queryByText('No other reviews waiting for you')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: /Next review/ })).toBeNull()
  })

  it('runs the supplied next action without a signing transport', async () => {
    const onClick = vi.fn()
    await renderPanel({ label: 'Sign now', onClick })
    await userEvent.click(screen.getByRole('button', { name: 'Sign now' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
