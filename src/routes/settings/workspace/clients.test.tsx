import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { choose } from '../../../../tests/unit/picker'

const reads: string[] = []
const shares: Array<{ p_client_id: string; p_record_id: string }> = []

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  const resource = url.pathname.split('/').at(-1) ?? ''

  if (resource === 'share_record_with_client') {
    shares.push(
      z
        .object({ p_client_id: z.string(), p_record_id: z.string() })
        .parse(await new Response(init?.body).json()),
    )

    return Response.json({})
  }

  if (resource === 'client_portal_preview_records')
    return Response.json([
      {
        record_id: 'r1',
        identifier: 'EXP-1',
        title: 'Shared run',
        kind: 'experiment',
        status: 'approved',
        project_id: 'p1',
        shared_at: '2026-10-19T09:00:00Z',
        approved_at: '2026-10-19T09:30:00Z',
        approved_by_name: 'Ada Admin',
      },
    ])

  reads.push(resource)

  return Response.json(answer(resource))
})

const { Route } = await import('./clients')
const { dropSharedReads } = await import('#/lib/data-client')

function renderPage(role = 'owner') {
  const Clients = Route.options.component

  if (!Clients) throw new Error('Client settings component required')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(['workspace-admins', 'ws'], [])
  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/workspace/clients',
    beforeLoad: () => ({
      context: {
        user: { id: 'admin', name: 'Admin', email: 'admin@sheetbase.test' },
        workspace: { id: 'ws', name: 'Workspace', role },
      },
    }),
    component: Clients,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/settings/workspace/clients'],
    }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function answer(resource: string) {
  if (resource === 'clients')
    return [{ id: 'c1', code: 'CL-001', name: 'Acme Biologics' }]

  if (resource === 'client_portal_shares')
    return [
      {
        id: 's1',
        client_id: 'c1',
        record_id: 'r1',
        shared_at: '2026-10-19T09:00:00Z',
      },
    ]

  if (resource === 'records')
    return [
      {
        id: 'r1',
        identifier: 'EXP-1',
        title: 'Shared run',
        kind: 'experiment',
        status: 'approved',
      },
      {
        id: 'r2',
        identifier: 'EXP-2',
        title: 'Offered run',
        kind: 'experiment',
        status: 'approved',
      },
    ]

  return []
}

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  reads.length = 0
  shares.length = 0
  dropSharedReads()
})

describe('settings clients', () => {
  it('keeps the page to workspace admins', async () => {
    renderPage('member')
    expect(await screen.findByText('Only admins manage clients')).toBeTruthy()
    expect(reads).toEqual([])
  })

  it('lists what is shared and offers only records not yet shared', async () => {
    renderPage()
    expect(await screen.findByText('Shared run')).toBeTruthy()
    await userEvent.click(
      screen.getByRole('button', { name: 'Share an approved record' }),
    )
    const picker = within(await screen.findByRole('dialog'))
    expect(
      await picker.findByRole('option', { name: /EXP-2.*Offered run/ }),
    ).toBeTruthy()
    expect(picker.queryByRole('option', { name: /Shared run/ })).toBeNull()
  })

  it('shares the chosen record', async () => {
    renderPage()
    await screen.findByText('Shared run')
    await choose(userEvent.setup(), 'Share an approved record', /Offered run/)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await vi.waitFor(() =>
      expect(shares).toContainEqual({
        p_client_id: 'c1',
        p_record_id: 'r2',
      }),
    )
  })

  it('previews the client portal', async () => {
    renderPage()
    await screen.findByText('Shared run')
    fireEvent.click(screen.getByRole('button', { name: 'Preview as client' }))
    expect(await screen.findByText(/Approved .* by Ada Admin/)).toBeTruthy()
    expect(
      screen.getByText('No project shares automatically with this client'),
    ).toBeTruthy()
  })
})
