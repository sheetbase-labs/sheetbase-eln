import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
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
import { z } from 'zod'

const updateSchema = z.object({
  p_project_id: z.string(),
  p_expected_revision: z.string(),
  p_title: z.string(),
  p_client_id: z.string().nullable(),
  p_modality: z.string().nullable(),
  p_stage: z.string().nullable(),
  p_lead_user_id: z.string().nullable(),
  p_default_reviewer_user_id: z.string().nullable(),
  p_agreement_reference: z.string().nullable(),
  p_started_on: z.string().nullable(),
})

const updates: Array<z.infer<typeof updateSchema>> = []
let archivedAt: string | null = null
let updateFailure: Error | null = null

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/update_project_details')) {
    if (updateFailure) throw updateFailure

    updates.push(updateSchema.parse(await new Response(init?.body).json()))

    return Response.json({})
  }

  if (url.pathname.endsWith('/project_list_summary'))
    return Response.json([
      {
        id: 'project-1',
        key: 'P1',
        title: 'AAV9 transfer',
        status: 'active',
        display_id: null,
        revision: '7',
        client_id: 'client-17',
        client_code: 'CL-017',
        client_name: 'Client 17',
        modality: 'AAV9',
        stage: 'Tech transfer',
        lead_user_id: 'gareth',
        lead_name: 'Gareth',
        default_reviewer_user_id: 'mei',
        agreement_reference: 'AGR-17',
        started_on: '2026-08-03',
        archived_at: archivedAt,
        updated_at: '2026-08-03',
        experiment_count: 0,
      },
    ])

  if (url.pathname.endsWith('/workspace_members_list'))
    return Response.json([
      { user_id: 'gareth', name: 'Gareth' },
      { user_id: 'mei', name: 'Mei' },
    ])

  if (url.pathname.endsWith('/clients'))
    return Response.json([
      { id: 'client-17', code: 'CL-017', name: 'Client 17' },
    ])

  return Response.json([])
})

const { Route } = await import('./settings')
const { dropSharedReads } = await import('#/lib/data-client')

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  dropSharedReads()
})

beforeEach(() => {
  updates.length = 0
  archivedAt = null
  updateFailure = null
})

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Project settings component required')

  const root = createRootRoute()

  const project = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId',
    beforeLoad: () => ({
      context: {
        user: { id: 'gareth' },
        workspace: { id: 'ws', role: 'member' },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => project,
    path: 'settings',
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([project.addChildren([route])]),
    history: createMemoryHistory({
      initialEntries: ['/projects/project-1/settings'],
    }),
  })

  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('PROJ-01 typed settings replacement', () => {
  it('changing only the title preserves loaded client, modality, lead, reviewer and start date', async () => {
    const user = userEvent.setup()
    renderRoute()
    await waitFor(async () =>
      expect(
        (await screen.findByRole('button', { name: /^Client/ })).textContent,
      ).toContain('Client 17'),
    )
    const title = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(title)
    await user.type(title, 'Renamed project')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(updates).toEqual([
        {
          p_project_id: 'project-1',
          p_expected_revision: '7',
          p_title: 'Renamed project',
          p_client_id: 'client-17',
          p_modality: 'AAV9',
          p_stage: 'Tech transfer',
          p_lead_user_id: 'gareth',
          p_default_reviewer_user_id: 'mei',
          p_agreement_reference: 'AGR-17',
          p_started_on: '2026-08-03',
        },
      ]),
    )
  })

  it('an archived project cannot submit details through the settings controls', async () => {
    archivedAt = '2026-09-01T12:00:00Z'
    renderRoute()
    expect(
      await screen.findByRole('button', { name: 'Save changes' }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('textbox', { name: 'Name' }).closest('fieldset'),
    ).toHaveProperty('disabled', true)
    expect(updates).toEqual([])
  })

  it('reports a refused save whose error is not a DataClientError', async () => {
    updateFailure = new Error('The project changed since you opened it.')
    const user = userEvent.setup()
    renderRoute()
    await waitFor(async () =>
      expect(
        (await screen.findByRole('button', { name: /^Client/ })).textContent,
      ).toContain('Client 17'),
    )
    const title = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(title)
    await user.type(title, 'Renamed project')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(
        screen.getByText('The project changed since you opened it.'),
      ).toBeTruthy(),
    )
  })
})
