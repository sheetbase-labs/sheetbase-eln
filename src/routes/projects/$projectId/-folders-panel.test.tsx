import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act,
} from '@testing-library/react'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'

const moves: Array<{
  p_project_id: string
  p_record_ids: string[]
  p_folder_id: string | null
}> = []

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/move_records_to_folder')) {
    moves.push(
      z
        .object({
          p_project_id: z.string(),
          p_record_ids: z.array(z.string()),
          p_folder_id: z.string().nullable(),
        })
        .parse(await new Response(init?.body).json()),
    )

    return Response.json(1)
  }

  if (url.pathname.endsWith('/folders'))
    return Response.json([
      { id: 'f1', name: 'First destination', parent_id: null },
      { id: 'f2', name: 'Second destination', parent_id: null },
    ])

  if (url.pathname.endsWith('/project_members'))
    return Response.json([{ user_id: 'u1', access_level: 'editor' }])

  if (url.pathname.endsWith('/records'))
    return Response.json([
      {
        id: 'r1',
        identifier: 'EXP-001',
        title: 'Notebook',
        kind: 'experiment',
        status: 'draft',
        updated_at: '2026-10-22',
        folder_id: null,
      },
    ])

  return Response.json([])
})

const { ProjectFolders } = await import('./-folders-panel')
const { dropSharedReads } = await import('#/lib/data-client')

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  moves.length = 0
  dropSharedReads()
})

const project = {
  id: 'p1',
  key: 'P1',
  title: 'Project',
  status: 'active',
  displayId: null,
  clientId: null,
  clientCode: null,
  clientName: null,
  modality: null,
  stage: null,
  leadUserId: null,
  leadName: null,
  defaultReviewerUserId: null,
  agreementReference: null,
  startedOn: null,
  revision: '1',
  archivedAt: null,
  updatedAt: '2026-10-22',
  experimentCount: 1,
}

function mount(available = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(['projects', 'summary'], available ? [project] : [])
  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/projects/$projectId',
    beforeLoad: () => ({ context: { user: { id: 'u1' } } }),
    component: () => <ProjectFolders projectId="p1" />,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/projects/p1'] }),
  })

  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { ...view, client, router }
}

it('keeps folder selection usable when a project becomes available after loading', async () => {
  const user = userEvent.setup()
  const view = mount(false)
  await act(() => view.router.load())
  expect(view.container.textContent).toBe('')

  await act(() => view.client.setQueryData(['projects', 'summary'], [project]))
  expect(
    await within(view.container).findByRole('button', { name: 'New folder' }),
  ).toBeTruthy()
  await user.click(
    await within(view.container).findByRole('checkbox', {
      name: 'Select EXP-001',
    }),
  )
  expect(await within(view.container).findByText('1 selected')).toBeTruthy()

  await act(() => view.client.setQueryData(['projects', 'summary'], []))
  await waitFor(() => expect(view.container.textContent).toBe(''))
  await act(() => view.client.setQueryData(['projects', 'summary'], [project]))
  expect(await within(view.container).findByText('1 selected')).toBeTruthy()
})

it('moves to the second instance’s destination without reading the first dialog', async () => {
  const first = mount()
  const second = mount()

  for (const instance of [first, second]) {
    fireEvent.click(
      await within(instance.container).findByRole('checkbox', {
        name: 'Select EXP-001',
        hidden: true,
      }),
    )
    fireEvent.click(
      within(instance.container).getByRole('button', {
        name: 'Move…',
        hidden: true,
      }),
    )
  }

  const dialogs = await screen.findAllByRole('dialog', { hidden: true })
  expect(dialogs).toHaveLength(2)
  const firstDialog = within(dialogs[0])
  const secondDialog = within(dialogs[1])
  const user = userEvent.setup()

  async function pickDestination(
    dialog: ReturnType<typeof within>,
    option: string,
  ) {
    await user.click(
      dialog.getByRole('button', { name: 'Destination folder', hidden: true }),
    )

    await user.click(
      await screen.findByRole('option', { name: option, hidden: true }),
    )
  }

  await pickDestination(firstDialog, 'First destination')
  await pickDestination(secondDialog, 'Second destination')
  expect(
    secondDialog
      .getByRole('button', { name: 'Destination folder', hidden: true })
      .getAttribute('data-value'),
  ).toBe('f2')
  expect(
    secondDialog.getByRole<HTMLButtonElement>('button', {
      name: 'Move',
      hidden: true,
    }).disabled,
  ).toBe(false)
  fireEvent.click(
    secondDialog.getByRole('button', { name: 'Move', hidden: true }),
  )
  await waitFor(() =>
    expect(moves).toEqual([
      { p_project_id: 'p1', p_record_ids: ['r1'], p_folder_id: 'f2' },
    ]),
  )
  expect(
    firstDialog.getByRole('button', {
      name: 'Destination folder',
      hidden: true,
    }),
  ).toBeTruthy()
})
