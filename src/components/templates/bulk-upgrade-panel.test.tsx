import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
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
import { Toaster, toast } from '#/components/ui/sonner'

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const notebooks = [
  { id: id(1), identifier: 'EXP-1', locked_at: null },
  { id: id(2), identifier: 'EXP-2', locked_at: null },
  { id: id(3), identifier: 'EXP-3', locked_at: '2026-09-01T00:00:00Z' },
]

const calls: Array<{ path: string; body: z.infer<ReturnType<typeof z.json>> }> =
  []

const clients: QueryClient[] = []
const unexpected: string[] = []

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
  const body = text ? z.json().parse(JSON.parse(text)) : null
  calls.push({ path, body })

  if (path === '/api/db/rpc/preview_notebook_template_upgrade') {
    const args = z.object({ p_record_id: z.string() }).parse(body)

    return Response.json({
      recordId: args.p_record_id,
      sourceVersionId: id(4),
      targetVersionId: id(5),
      automatic: [],
      conflicts:
        args.p_record_id === notebooks[1].id
          ? [
              {
                id: 'conflict',
                kind: 'sheet-placement-unresolved',
                allowedOutcomes: ['keep'],
              },
            ]
          : [],
    })
  }

  if (path === '/api/db/records')
    return Response.json([{ structure_version: 7 }])

  if (path === '/api/db/rpc/apply_notebook_template_upgrade')
    return Response.json(null)
  unexpected.push(path)

  return Response.json({ message: 'Unexpected request' }, { status: 500 })
})

const { BulkUpgradePanel } = await import('./bulk-upgrade-panel')

beforeEach(() => {
  calls.length = 0
  unexpected.length = 0
})

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.length = 0
  toast.dismiss()
  expect(unexpected).toEqual([])
})

afterAll(() => vi.unstubAllGlobals())

describe('BulkUpgradePanel', () => {
  it('updates in one pass and lists what it left, with a Review link for decisions', async () => {
    const user = userEvent.setup()
    const client = new QueryClient()
    clients.push(client)

    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    render(
      <RouterContextProvider router={router}>
        <QueryClientProvider client={client}>
          <BulkUpgradePanel
            templateId="t1"
            targetVersion={3}
            targetVersionId={id(5)}
            notebooks={notebooks}
          />
          <Toaster />
        </QueryClientProvider>
      </RouterContextProvider>,
    )
    expect(
      screen.getByText(/Update 3 notebooks to v3 in one pass/),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Update all to v3' }))
    await waitFor(() =>
      expect(
        calls.some(({ path }) =>
          path.endsWith('/apply_notebook_template_upgrade'),
        ),
      ).toBe(true),
    )
    expect(
      await screen.findByText('Needs your decision on 1 sheet'),
    ).toBeTruthy()
    expect(screen.getByText(/Signed: amend it first/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Review v3' })).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: 'Review v3' }).getAttribute('href'),
    ).toBe(`/templates/t1/update?record=${notebooks[1].id}`)
    expect(screen.queryByText('EXP-1')).toBeNull()
    expect(
      await screen.findByText('1 of 3 notebooks updated to v3'),
    ).toBeTruthy()
    expect(
      calls.filter(({ path }) =>
        path.endsWith('/preview_notebook_template_upgrade'),
      ),
    ).toHaveLength(2)
    expect(
      calls.flatMap(({ path, body }) =>
        path.endsWith('/apply_notebook_template_upgrade') ? [body] : [],
      ),
    ).toEqual([
      {
        p_record_id: notebooks[0].id,
        p_expected_structure_version: 7,
        p_target_version_id: id(5),
        p_decisions: [],
        p_parameter_inputs: [],
      },
    ])
  })
})
