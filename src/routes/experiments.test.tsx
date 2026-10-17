/**
 * The experiments list's empty state: it must read as a sentence, not
 * "No all experiments" (the tab label interpolated into the copy).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './experiments'

const ExperimentsRoute = Route.options.component as React.ComponentType

const router = vi.hoisted<{ search: Record<string, unknown> }>(() => ({
  search: {},
}))
const dataClient = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  rpc: vi.fn(),
}))
const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useSearch: () => router.search,
    useRouteContext: () => ({
      context: {
        user: { id: 'user-gp', name: 'Gareth P.' },
        workspace: { id: 'ws-1' },
      },
    }),
    options: config,
  }),
  useNavigate: () => navigateSpy,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: '/experiments' } }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: dataClient }))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

function renderList() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {React.createElement(ExperimentsRoute)}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  router.search = {}
  dataClient.list.mockResolvedValue([])
  dataClient.count.mockResolvedValue(0)
  dataClient.rpc.mockImplementation(async (name: string) => {
    if (name === 'my_project_permissions')
      return [
        {
          project_id: '00000000-0000-4000-8000-000000000001',
          access_level: 'owner',
          can_view: true,
          can_edit: true,
          can_review: false,
          can_manage: true,
          client_portal: false,
        },
      ]
    return undefined
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('experiments list rows', () => {
  // The list's rows carried no click handler: only the title link went
  // anywhere, so clicking a row did nothing (the Projects list had the same
  // shape until it was fixed).
  it('opens the experiment when its row is clicked', async () => {
    dataClient.list.mockResolvedValue([
      {
        id: 'exp-uuid-1',
        identifier: 'EXP-0001',
        title: 'AAV9 titration',
        project_id: '00000000-0000-4000-8000-000000000001',
        created_by_user_id: 'user-gp',
        status: 'draft',
        created_at: '2026-10-13T00:00:00.000Z',
        updated_at: '2026-10-14T00:00:00.000Z',
      },
    ])

    renderList()
    const title = await within(
      screen.getByRole('table', { name: 'Experiments' }),
    ).findByText('AAV9 titration')
    const row = title.closest('tr')
    expect(row).not.toBeNull()

    fireEvent.click(row!)

    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/experiments/$expId',
      params: { expId: 'exp-uuid-1' },
    })
  })
})

describe('experiments list empty state', () => {
  it('says "No experiments" on the All tab', async () => {
    renderList()

    expect(await screen.findByText('No experiments')).toBeDefined()
    expect(screen.queryByText(/No all experiments/)).toBeNull()
    expect(
      screen.getByText(/Searched IDs, titles, projects and owners\./),
    ).toBeDefined()
  })

  it('names the view it is empty of', async () => {
    router.search = { tab: 'drafts' }
    renderList()

    await waitFor(() =>
      expect(screen.getByText('No draft experiments')).toBeDefined(),
    )
    expect(screen.queryByText(/No drafts experiments/)).toBeNull()
  })
})

describe('experiments header reflows at 400 % zoom (QA4-zoom-experiments)', () => {
  // At a 1440 px window zoomed to 400 % the layout viewport is 360 px wide and
  // the shell leaves the column 312 px. On one non-wrapping row the title, the
  // count and "New experiment" need more than that: the action ended 18 px
  // past the viewport with no ancestor able to scroll to it, and the document
  // itself scrolled sideways (WCAG 1.4.10). The row wraps below `md` instead,
  // as the Inbox header does.
  it('wraps the title row rather than pushing the action off the column', async () => {
    renderList()

    const row = (await screen.findByText('Experiments', { selector: 'h1' }))
      .parentElement
    expect(row).not.toBeNull()
    // The header is `ListHeader` now, so the wrap is the header's guarantee:
    // the row wraps, and below `md` the actions take a line of their own
    // rather than being pushed past the column edge.
    expect(row!.className).toContain('flex-wrap')
    const actions = row!.parentElement!.querySelector(
      '[class*="max-md:w-full"]',
    )
    expect(actions).not.toBeNull()
    expect(
      row!.parentElement!.contains(screen.getByText('New experiment')),
    ).toBe(true)
  })
})
