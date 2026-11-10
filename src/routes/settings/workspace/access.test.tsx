import { choose } from '../../../../tests/unit/picker'
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
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * SET-02.3 — the access-request audit surface. Approvals must be attributable:
 * a decided request shows who decided it and when, a pending one the reader
 * cannot decide reads as waiting (never granted), and the decision travels
 * through the canonical RPC.
 */
const decisionSchema = z.object({
  p_request_id: z.string(),
  p_approve: z.boolean(),
})

const defaultSchema = z.object({ p_qa_view_group_id: z.string().nullable() })
const decisions: Array<z.infer<typeof decisionSchema>> = []
const defaults: Array<z.infer<typeof defaultSchema>> = []
const firstProjectId = '00000000-0000-4000-8000-0000000000b1'
const secondProjectId = '00000000-0000-4000-8000-0000000000b2'

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/decide_project_access_request')) {
    decisions.push(decisionSchema.parse(await new Response(init?.body).json()))

    return Response.json(null)
  }

  if (url.pathname.endsWith('/set_project_access_defaults')) {
    defaults.push(defaultSchema.parse(await new Response(init?.body).json()))

    return Response.json(null)
  }

  if (url.pathname.endsWith('/workspace_members_list'))
    return Response.json([
      { user_id: 'scientist', name: 'Ada Lovelace', role: 'scientist' },
      { user_id: 'lead', name: 'Grace Hopper', role: 'steward' },
    ])

  if (url.pathname.endsWith('/project_list_summary'))
    return Response.json([
      {
        id: firstProjectId,
        key: 'P1',
        title: 'Virus Stability',
        status: 'active',
        updated_at: '2026-09-20',
        experiment_count: 0,
      },
      {
        id: secondProjectId,
        key: 'P2',
        title: 'Water Quality',
        status: 'active',
        updated_at: '2026-09-20',
        experiment_count: 0,
      },
    ])

  if (url.pathname.endsWith('/workspace_groups_list'))
    return Response.json([
      {
        id: '00000000-0000-4000-8000-0000000000aa',
        name: 'QA',
        member_ids: [],
      },
    ])

  if (url.pathname.endsWith('/project_access_defaults'))
    return Response.json([
      {
        private_to_lead: true,
        qa_view_group_id: null,
        client_portal_off: true,
      },
    ])

  if (url.pathname.endsWith('/my_project_permissions'))
    return Response.json(
      [firstProjectId, secondProjectId].map((projectId) => ({
        project_id: projectId,
        access_level: projectId === firstProjectId ? 'editor' : 'viewer',
        can_view: true,
        can_edit: projectId === firstProjectId,
        can_review: false,
        client_portal: false,
        can_manage: projectId === firstProjectId,
      })),
    )

  if (url.pathname.endsWith('/project_access_requests'))
    return Response.json([
      {
        id: '00000000-0000-4000-8000-000000000001',
        project_id: firstProjectId,
        user_id: 'scientist',
        reason: 'QA verification of the turbidity repeat',
        status: 'pending',
        created_at: '2026-09-20T09:00:00Z',
        updated_at: '2026-09-20T09:00:00Z',
        decided_by_user_id: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        project_id: secondProjectId,
        user_id: 'reader',
        reason: 'Attach the calibration certificate',
        status: 'pending',
        created_at: '2026-09-20T09:05:00Z',
        updated_at: '2026-09-20T09:05:00Z',
        decided_by_user_id: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        project_id: firstProjectId,
        user_id: 'scientist',
        reason: 'Upstream process assessment',
        status: 'approved',
        created_at: '2026-09-19T09:00:00Z',
        updated_at: '2026-09-21T10:30:00Z',
        decided_by_user_id: 'lead',
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        project_id: firstProjectId,
        user_id: 'reader',
        reason: 'Read the protocol',
        status: 'denied',
        created_at: '2026-09-18T09:00:00Z',
        updated_at: '2026-09-21T11:00:00Z',
        decided_by_user_id: 'lead',
      },
    ])

  return Response.json([])
})

const { Route } = await import('./access')
const { dropSharedReads } = await import('#/lib/data-client')
const { dataAccessKeys } = await import('#/lib/data-access')

afterEach(() => {
  cleanup()
  dropSharedReads()
  decisions.length = 0
  defaults.length = 0
})

afterAll(() => vi.unstubAllGlobals())

function renderAccess() {
  const Component = Route.options.component

  if (!Component) throw new Error('Access component required')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  client.setQueryData(dataAccessKeys.roles('ws'), [])
  client.setQueryData(['user-names', ['scientist', 'reader', 'lead']], {
    scientist: 'Ada Lovelace',
    reader: 'Reader',
    lead: 'Grace Hopper',
  })

  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        user: { id: 'reader', name: 'Reader' },
        workspace: { id: 'ws', name: 'Workspace', role: 'admin' },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/workspace/access',
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/settings/workspace/access'],
    }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

async function rowFor(reason: string): Promise<HTMLElement> {
  const cell = await screen.findByText(reason)
  const row = cell.closest('tr')

  if (!row) throw new Error(`Row for ${reason} required`)

  return row
}

describe('SET-02.3 access requests audit', () => {
  it('shows who decided an approved request and when', async () => {
    renderAccess()
    const approved = await rowFor('Upstream process assessment')
    expect(
      await within(approved).findByText(/Approved by Grace Hopper · \d/),
    ).toBeTruthy()
  })

  it('shows the decider and outcome of a refused request', async () => {
    renderAccess()
    const denied = await rowFor('Read the protocol')
    expect(
      await within(denied).findByText(/Denied by Grace Hopper · \d/),
    ).toBeTruthy()
  })

  it('reads a pending request the reader cannot decide as waiting, not granted', async () => {
    renderAccess()
    const pending = await rowFor('Attach the calibration certificate')
    expect(
      await within(pending).findByText('Waiting for approval'),
    ).toBeTruthy()
    expect(
      within(pending).queryByRole('button', { name: 'Approve edit access' }),
    ).toBeNull()
  })

  it('decides a pending request through the canonical RPC', async () => {
    const user = userEvent.setup()
    renderAccess()
    const pending = await rowFor('QA verification of the turbidity repeat')
    await user.click(
      await within(pending).findByRole('button', {
        name: 'Approve edit access',
      }),
    )
    await waitFor(() =>
      expect(decisions).toEqual([
        {
          p_request_id: '00000000-0000-4000-8000-000000000001',
          p_approve: true,
        },
      ]),
    )
  })
})

describe('default view group for new projects', () => {
  it('saves the chosen group as the default through the canonical RPC', async () => {
    const user = userEvent.setup()
    renderAccess()
    await choose(user, 'Default view group for new projects', /QA/)
    await waitFor(() =>
      expect(defaults).toEqual([
        { p_qa_view_group_id: '00000000-0000-4000-8000-0000000000aa' },
      ]),
    )
  })

  it('says the default is view-only and leaves existing projects alone', async () => {
    renderAccess()
    expect(await screen.findByText(/can’t edit, review or manage/)).toBeTruthy()
  })
})
