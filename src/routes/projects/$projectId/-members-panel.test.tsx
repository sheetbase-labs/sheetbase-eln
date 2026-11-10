import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const removed: Array<{ p_project_id: string; p_user_id: string }> = []

const changed: Array<{
  p_project_id: string
  p_user_id: string
  p_access_level: string
}> = []

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/remove_project_member')) {
    removed.push(
      z
        .object({ p_project_id: z.string(), p_user_id: z.string() })
        .parse(await new Response(init?.body).json()),
    )

    return Response.json(null)
  }

  if (url.pathname.endsWith('/set_project_member')) {
    changed.push(
      z
        .object({
          p_project_id: z.string(),
          p_user_id: z.string(),
          p_access_level: z.string(),
        })
        .parse(await new Response(init?.body).json()),
    )

    return Response.json(null)
  }

  if (url.pathname.endsWith('/project_members'))
    return Response.json([
      {
        user_id: 'u-mei',
        name: 'Mei L.',
        access_level: 'editor',
        workspace_role: 'member',
        project_role: null,
        is_lead: false,
        added_at: '2026-01-01T00:00:00Z',
      },
    ])

  return Response.json([])
})

const { ProjectMembers } = await import('./-members-panel')
const { dropSharedReads } = await import('#/lib/data-client')

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  removed.length = 0
  changed.length = 0
  dropSharedReads()
})

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(
    ['projects', 'summary'],
    [{ id: 'project-1', leadUserId: 'gareth', leadName: 'Gareth P.' }],
  )
  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId',
    beforeLoad: () => ({ context: { user: { id: 'gareth' } } }),
    component: () => <ProjectMembers projectId="project-1" />,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/projects/project-1'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('project members', () => {
  it('confirms before removing someone from the project', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Mei L.')
    await user.click(
      screen.getByRole('button', { name: 'Change access for Mei L.' }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Remove from project' }),
    )
    expect(removed).toEqual([])
    await user.click(
      await screen.findByRole('button', { name: 'Remove from project' }),
    )
    await waitFor(() =>
      expect(removed).toEqual([
        { p_project_id: 'project-1', p_user_id: 'u-mei' },
      ]),
    )
  })

  it('offers the access levels the table and help copy describe', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText('Mei L.')
    await user.click(
      screen.getByRole('button', { name: 'Change access for Mei L.' }),
    )

    for (const level of ['Editor', 'Reviewer', 'Viewer']) {
      expect(await screen.findByRole('menuitem', { name: level })).toBeTruthy()
    }

    await user.click(screen.getByRole('menuitem', { name: 'Reviewer' }))
    await waitFor(() =>
      expect(changed).toEqual([
        {
          p_project_id: 'project-1',
          p_user_id: 'u-mei',
          p_access_level: 'reviewer',
        },
      ]),
    )
  })
})
