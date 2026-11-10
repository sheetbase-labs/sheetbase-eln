/** J-NBK-01: starts a notebook through the real transport and opens it. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
import { Toaster, toast } from '#/components/ui/sonner'

const PROJECT = '00000000-0000-4000-8000-0000000000a1'
const READ_ONLY = '00000000-0000-4000-8000-0000000000a2'
const VERSION = '00000000-0000-4000-8000-000000000001'

const calls: Array<{ path: string; body: z.infer<ReturnType<typeof z.json>> }> =
  []

const unexpected: string[] = []
const clients: QueryClient[] = []
let refusal = false

const perm = {
  can_edit: true,
  can_review: false,
  can_manage: false,
  can_view: true,
  client_portal: false,
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(
    new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    ),
    init,
  )

  const path = new URL(request.url).pathname
  const text = await request.text()
  calls.push({ path, body: text ? z.json().parse(JSON.parse(text)) : null })

  if (path === '/api/db/projects')
    return Response.json([
      {
        id: READ_ONLY,
        title: 'Aardvark (view only)',
        archived_at: null,
        status: 'active',
      },
      { id: PROJECT, title: 'Bravo', archived_at: null, status: 'active' },
    ])

  if (path === '/api/db/rpc/my_project_permissions')
    return Response.json([
      { project_id: PROJECT, access_level: 'editor', ...perm },
      {
        project_id: READ_ONLY,
        access_level: 'viewer',
        ...perm,
        can_edit: false,
      },
    ])

  if (path === '/api/db/rpc/instantiate_notebook_template_version') {
    if (refusal)
      return Response.json({ message: 'permission denied' }, { status: 403 })

    return Response.json({
      record: { id: 'rec-1', project_id: PROJECT, identifier: 'EXP-9' },
      templateVersionId: VERSION,
      composition: [],
      idempotent: false,
    })
  }

  unexpected.push(path)

  return Response.json({ message: 'Unexpected request' }, { status: 500 })
})

const { UseTemplateDialog } = await import('./use-template-dialog')

const { notebookTemplateVersionFromWire } =
  await import('#/lib/notebook-template-data')

function version() {
  return notebookTemplateVersionFromWire({
    id: VERSION,
    template_id: '00000000-0000-4000-8000-000000000009',
    version: 2,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: {
      formatVersion: 1,
      parameters: [],
      placements: [
        {
          id: '00000000-0000-4000-8000-000000000999',
          kind: 'narrative',
          order: 1,
          blockType: 'rich_text',
          payload: {},
        },
      ],
    },
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: '2026-01-02T00:00:00.000Z',
    published_by_user_id: null,
    reason: null,
    signed_by_user_id: null,
    signed_meaning: null,
    signed_at: null,
    retired_at: null,
    retired_by_user_id: null,
  })
}

function renderDialog(v: ReturnType<typeof version> | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  clients.push(client)
  const root = createRootRoute()

  const notebook = createRoute({
    getParentRoute: () => root,
    path: '/experiments/$expId/notebook',
  })

  const router = createRouter({
    routeTree: root.addChildren([notebook]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={client}>
        <UseTemplateDialog templateName="Depth filter" version={v} />
        <Toaster />
      </QueryClientProvider>
    </RouterContextProvider>,
  )

  return router
}

beforeEach(() => {
  calls.length = 0
  unexpected.length = 0
  refusal = false
})

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.length = 0
  toast.dismiss()
  expect(unexpected).toEqual([])
})

afterAll(() => vi.unstubAllGlobals())

describe('UseTemplateDialog', () => {
  it('is disabled with a reason when nothing is published', () => {
    renderDialog(null)

    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Use template',
    })

    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toMatch(/Publish a version first/)
  })

  it('instantiates the published version in an editable project and opens it', async () => {
    const router = renderDialog(version())
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    const project = await screen.findByRole('button', { name: /^Project/ })
    await waitFor(() => expect(project.textContent).toContain('Bravo'))
    fireEvent.click(project)
    const dialogs = await screen.findAllByRole('dialog')
    const picker = dialogs[dialogs.length - 1]
    await within(picker).findByRole('option', { name: /Bravo/ })
    expect(
      within(picker).queryByRole('option', { name: /Aardvark/ }),
    ).toBeNull()
    fireEvent.keyDown(picker, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Start notebook' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/experiments/rec-1/notebook',
      ),
    )

    const call = calls.find(
      ({ path }) =>
        path === '/api/db/rpc/instantiate_notebook_template_version',
    )

    expect(call?.body).toMatchObject({
      p_version_id: VERSION,
      p_target_project_id: PROJECT,
      p_title: null,
      p_parameter_inputs: [],
    })
    expect(
      z.object({ p_idempotency_key: z.string() }).parse(call?.body)
        .p_idempotency_key,
    ).toEqual(expect.any(String))
  })

  it('retains the form on refusal and changes the idempotency key for retry', async () => {
    refusal = true
    const router = renderDialog(version())
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    const start = await screen.findByRole('button', { name: 'Start notebook' })
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    fireEvent.click(start)
    await screen.findByText(
      /You don’t have permission|You don't have permission/,
    )
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('dialog')).toBeTruthy()

    const first = calls.find(({ path }) =>
      path.endsWith('/instantiate_notebook_template_version'),
    )

    refusal = false
    fireEvent.click(start)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/experiments/rec-1/notebook',
      ),
    )

    const attempts = calls.filter(({ path }) =>
      path.endsWith('/instantiate_notebook_template_version'),
    )

    expect(attempts).toHaveLength(2)
    const args = z.object({ p_idempotency_key: z.string() })
    expect(args.parse(attempts[1].body).p_idempotency_key).not.toBe(
      args.parse(first?.body).p_idempotency_key,
    )
  })
})
