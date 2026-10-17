/**
 * Protocols registry — the toolbar's Sort menu reorders the list the route
 * fetched. The keys are ones these records carry: they have no effective date,
 * so "Effective" is not offered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Templates from '#/lib/templates'
import type { NotebookRecord } from '#/lib/notebook-data'
import { Route } from './protocols'

const fixtures = vi.hoisted(() => ({ protocols: [] as unknown[] }))
const search = vi.hoisted(() => ({ value: {} }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    fullPath: '/protocols',
    useRouteContext: () => ({ context: { user: { id: 'u1' } } }),
    useSearch: () => search.value,
    options: config,
  }),
  useNavigate: () => vi.fn(),
  useRouterState: () => true,
  Outlet: () => null,
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: unknown
    children?: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string | null) => id ?? '—' }),
}))

vi.mock('#/lib/templates', async (importOriginal) => {
  const actual = await importOriginal<typeof Templates>()
  return {
    ...actual,
    fetchTemplates: vi.fn(async () => fixtures.protocols),
  }
})

/**
 * jsdom has no layout: the grid's virtualiser measures a zero-height viewport
 * and would render no rows at all, so the order this test is about could not be
 * observed. The double returns the full row range — the same rows the browser
 * run renders — and only the five methods the grid calls. The real virtualiser
 * is exercised in `tests/browser/registry-grid.test.ts`, which asserts the
 * virtual renderer's own `data-index` attribute.
 */
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
})
