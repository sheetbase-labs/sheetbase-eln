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

import { notebookDataClient } from '#/lib/notebook-data'

import { Route } from './experiments'

/** The route options the file-route factory stores; this suite reads `component`. */
interface FileRouteOptions {
  component?: React.ComponentType
}

/** The search the list accepts, as the route's own validator narrows it. */
interface ExperimentsSearch {
  tab?: string
  q?: string
  project?: string
  older?: boolean
  group?: 'project' | 'owner'
}

const router = vi.hoisted<{ search: ExperimentsSearch }>(() => ({ search: {} }))

const dataClient = { list: vi.fn(), count: vi.fn(), rpc: vi.fn() }

const navigateSpy = vi.hoisted(() => vi.fn())

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time, and this suite renders the route component on its own with the router context and search the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: FileRouteOptions) => ({
    useSearch: () => router.search,
    useRouteContext: () => ({
      context: {
        user: { id: 'user-gp', name: 'Gareth P.' },
        workspace: { id: 'ws-1', role: 'admin' },
      },
    }),
    options: config,
  }),
  useNavigate: () => navigateSpy,
  useRouterState: (options: {
    select: (state: { location: { pathname: string } }) => boolean
  }) => options.select({ location: { pathname: '/experiments' } }),
  Outlet: () => null,
  redirect: (options: { to: string; search?: Record<string, string> }) =>
    options,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

/**
 * jsdom has no layout: the grid's virtualiser measures a zero-height viewport
 * and would render no rows, so the row this test clicks could not exist. The
 * double returns the full row range, the same rows the browser renders; the
 * real virtualiser is exercised in `tests/browser/registry-grid.test.ts`.
 */
// oxlint-disable-next-line anti-slop/no-module-mocking -- jsdom has no layout: the real virtualiser measures a zero-height viewport and renders no rows, so this double returns the full range the browser would; the real one is exercised in tests/browser/registry-grid.test.ts.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 33,
        end: index * 33 + 33,
        size: 33,
      })),
    getTotalSize: () => count * 33,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}))

function renderList() {
  const ExperimentsRoute = Route.options.component

  if (!ExperimentsRoute)
    throw new Error('the experiments route declares no component')

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
  vi.spyOn(notebookDataClient, 'list').mockImplementation(dataClient.list)
  vi.spyOn(notebookDataClient, 'count').mockImplementation(dataClient.count)
  vi.spyOn(notebookDataClient, 'rpc').mockImplementation(dataClient.rpc)
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
  vi.restoreAllMocks()
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

    // The tick column and the added columns settle after the first paint, so
    // the row is read again until it is attached.
    const row = await waitFor(() => {
      const found = within(screen.getByRole('table', { name: 'Experiments' }))
        .getByText('AAV9 titration')
        .closest('tr')

      expect(found).not.toBeNull()

      return found
    })

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
