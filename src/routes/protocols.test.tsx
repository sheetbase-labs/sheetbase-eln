/**
 * Protocols registry — the toolbar's Sort menu reorders the list the route
 * fetched. The keys are ones these records carry: they have no effective date,
 * so "Effective" is not offered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type * as router from '@tanstack/react-router'
import type { NotebookRecord } from '#/lib/notebook-data'
import { Route } from './protocols'

/** What each test wants the protocols read to return. */
interface ProtocolFixtures {
  protocols: NotebookRecord[]
}

const fixtures = vi.hoisted<ProtocolFixtures>(() => ({ protocols: [] }))

/** The options the file-route factory receives; the mock only stores them. */
type FileRouteOptions = Parameters<ReturnType<typeof router.createFileRoute>>[0]

/** The address bar's search values for the rendered route. */
const search = vi.hoisted<{ value: { q?: string } }>(() => ({
  value: {},
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time and this suite renders the route component directly, supplying the router context the shell would.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: FileRouteOptions) => ({
    fullPath: '/protocols',
    useRouteContext: () => ({ context: { user: { id: 'u1' } } }),
    useSearch: () => search.value,
    options: config,
  }),
  useNavigate: () => vi.fn(),
  useRouterState: () => true,
  Outlet: () => null,
  redirect: (options: { to: string }) => options,
  Link: ({
    to,
    children,
    ...props
  }: React.ComponentProps<'a'> & { to?: string }) => (
    <a href={to ?? '#'} {...props}>
      {children}
    </a>
  ),
}))

/** One stored record, in the snake_case shape the database returns. */
function wireOf(record: NotebookRecord) {
  return {
    id: record.id,
    workspace_id: 'ws-1',
    project_id: record.projectId,
    folder_id: record.folderId,
    kind: record.kind,
    identifier: record.identifier,
    title: record.title,
    status: record.status,
    tags: record.tags,
    structure_version: record.structureVersion,
    metadata_version: record.metadataVersion,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    archived_at: record.archivedAt,
    deleted_at: record.deletedAt,
    created_by_user_id: record.createdByUserId,
    updated_by_user_id: record.updatedByUserId,
    locked_at: record.lockedAt,
    locked_by_revision_id: record.lockedByRevisionId,
  }
}

// The one boundary this suite fakes: the same-origin `/api/db` transport. It
// is installed before the modules that capture `fetch` are imported.
vi.hoisted(() => {
  const transport: typeof fetch = async (input, _init) => {
    const url = new URL(
      z
        .union([z.string(), z.instanceof(URL), z.instanceof(Request)])
        .transform((value) => {
          if (value instanceof URL) return value.toString()

          if (value instanceof Request) return value.url

          return value
        })
        .parse(input),
      'http://localhost',
    )

    const rows = url.pathname.endsWith('/records')
      ? fixtures.protocols.map(wireOf)
      : []

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  globalThis.fetch = transport
})

function makeProtocol(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 'prt-1',
    projectId: null,
    kind: 'protocol_template',
    identifier: 'PRT-0001',
    title: 'Alpha protocol',
    status: 'active',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u1',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Protocols list component required')

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

beforeEach(() => {
  vi.resetAllMocks()
  search.value = {}
})

describe('protocols toolbar', () => {
  it('reorders the list when a sort key is chosen', async () => {
    const user = userEvent.setup()
    fixtures.protocols = [
      makeProtocol({
        id: 'prt-1',
        identifier: 'PRT-0001',
        title: 'Alpha protocol',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
      makeProtocol({
        id: 'prt-2',
        identifier: 'PRT-0002',
        title: 'Zeta protocol',
        updatedAt: '2026-06-01T00:00:00Z',
      }),
    ]
    renderRoute()

    expect(await screen.findAllByText('PRT-0002')).not.toHaveLength(0)
    const table = screen.getByRole('table', { name: 'Protocols' })

    const ids = () =>
      within(table)
        .getAllByText(/^PRT-\d+$/)
        .map((cell) => cell.textContent)

    // Most recently updated first, not the identifier order the page arrived in.
    expect(ids()).toEqual(['PRT-0002', 'PRT-0001'])

    screen.getByRole('button', { name: 'Sort' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('menuitem', { name: 'Protocol' }))

    expect(ids()).toEqual(['PRT-0001', 'PRT-0002'])
  })

  /**
   * The grid's own empty state is a single line inside a full-height frame that
   * leaves the screen's empty state — the one that offers the next action —
   * below the fold. A search with no matches must therefore render the screen's
   * EmptyState and no grid at all.
   */
  it('renders the empty state, not the grid, when nothing matches', async () => {
    fixtures.protocols = []
    search.value = { q: 'zzzz' }
    renderRoute()

    expect(await screen.findByText(/No protocols match/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
