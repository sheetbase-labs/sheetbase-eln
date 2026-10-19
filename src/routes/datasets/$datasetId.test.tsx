/**
 * R5-SURF-01 — the dataset detail's search-param tabs. `?view=` selects the
 * Imports, Used by and History panels (linkable and reloadable), and the tab
 * nav offers each as a real link. With no tab the index route shows the
 * Overview screen, which the Overview tab links to.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as DetailRoute } from './$datasetId'
import { Route as IndexRoute } from './$datasetId/index'

const fixtures = vi.hoisted(() => {
  const routerState: {
    search: { view?: string }
    pathname: string
    params: { datasetId: string }
    context: { context: { user: { id: string; name: string } } }
  } = {
    search: {},
    pathname: '/datasets/ds-1',
    params: { datasetId: 'ds-1' },
    context: { context: { user: { id: 'user-1', name: 'Priya' } } },
  }
  return {
    datasetRow: {
      id: 'DS-0001',
      uuid: 'ds-1',
      name: 'Ambr dataset',
      model: 'ambr',
      projectId: null,
      createdByUserId: 'user-1',
      rows: 31,
      issues: 0,
      outOfRange: 0,
      missingUnit: 0,
      missingUnitFields: [],
      experimentId: null as string | null,
      reviewState: null,
      updated: '2026-09-25',
      updatedAt: '2026-09-25T10:11:00.000Z',
      archived: false,
    },
    routerState,
  }
})

const dataClient = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => fixtures.routerState.params,
    useSearch: () => fixtures.routerState.search,
    useRouteContext: () => fixtures.routerState.context,
    useNavigate: () => vi.fn(),
    options: config,
    fullPath: '/datasets/$datasetId',
  }),
  useSearch: () => fixtures.routerState.search,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: fixtures.routerState.pathname } }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  Link: ({
    to,
    search,
    children,
  }: {
    to?: string
    search?: Record<string, unknown>
    children?: React.ReactNode
  }) => (
    <a
      data-to={typeof to === 'string' ? to : undefined}
      data-search={search ? JSON.stringify(search) : undefined}
    >
      {children}
    </a>
  ),
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => `name:${id}` }),
}))

vi.mock('#/components/v3/datasets/datasets-data', async (importOriginal) => ({
  ...(await importOriginal()),
  useDatasetSummaries: () => ({
    data: [fixtures.datasetRow],
    isLoading: false,
  }),
}))

vi.mock('#/components/v3/datasets/dataset-imports-tab', () => ({
  DatasetImportsTab: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="imports-panel">{datasetId}</div>
  ),
}))
vi.mock('#/components/v3/datasets/dataset-used-by-tab', () => ({
  DatasetUsedByTab: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="used-by-panel">{datasetId}</div>
  ),
}))
vi.mock('#/components/v3/datasets/dataset-history-tab', () => ({
  DatasetHistoryTab: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="history-panel">{datasetId}</div>
  ),
}))

const DetailLayout = DetailRoute.options.component as React.ComponentType
const DetailIndex = IndexRoute.options.component as React.ComponentType

const validateSearch = DetailRoute.options.validateSearch as (
  search: Record<string, unknown>,
) => { view?: string }

function renderRoute(component: React.ComponentType) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      {React.createElement(component)}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  dataClient.rpc.mockResolvedValue([])
  fixtures.routerState.search = {}
  fixtures.routerState.pathname = '/datasets/ds-1'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dataset detail tab search parameter', () => {
  it('accepts only the three data tabs', () => {
    expect(validateSearch({ view: 'imports' })).toEqual({ view: 'imports' })
    expect(validateSearch({ view: 'used-by' })).toEqual({ view: 'used-by' })
    expect(validateSearch({ view: 'history' })).toEqual({ view: 'history' })
    expect(validateSearch({ view: 'columns' })).toEqual({ view: undefined })
    expect(validateSearch({})).toEqual({ view: undefined })
  })

  it('links each tab to its own search parameter', () => {
    renderRoute(DetailLayout)

    const imports = screen.getByText('Imports').closest('a')
    const usedBy = screen.getByText('Used by').closest('a')
    const history = screen.getByText('History').closest('a')
    expect(imports?.getAttribute('data-search')).toBe('{"view":"imports"}')
    expect(usedBy?.getAttribute('data-search')).toBe('{"view":"used-by"}')
    expect(history?.getAttribute('data-search')).toBe('{"view":"history"}')
  })

  it('offers Chart and Analyse on every tab, opening the studio on this dataset', () => {
    for (const pathname of ['/datasets/ds-1', '/datasets/ds-1/rows']) {
      fixtures.routerState.pathname = pathname
      renderRoute(DetailLayout)
      expect(screen.getByText('Download CSV')).toBeTruthy()
      expect(
        screen.getByText('Chart').closest('a')?.getAttribute('data-search'),
      ).toBe('{"mode":"chart","dataset":"ds-1","returnTo":"/datasets/ds-1"}')
      expect(
        screen.getByText('Analyse').closest('a')?.getAttribute('data-search'),
      ).toBe('{"mode":"analyse","dataset":"ds-1","returnTo":"/datasets/ds-1"}')
      cleanup()
    }
  })

  it('names the experiment that made the dataset as a link, and climbs through it', () => {
    fixtures.datasetRow.experimentId = 'EXP-0142'
    try {
      renderRoute(DetailLayout)
      const links = screen
        .getAllByText('EXP-0142')
        .map((node) => node.closest('a')?.getAttribute('data-to'))
      expect(links).toContain('/experiments/$expId')
      expect(links).toContain('/experiments/EXP-0142')
    } finally {
      fixtures.datasetRow.experimentId = null
    }
  })

  it('renders the panel selected by the view search parameter', () => {
    for (const [view, testId] of [
      ['imports', 'imports-panel'],
      ['used-by', 'used-by-panel'],
      ['history', 'history-panel'],
    ] as const) {
      fixtures.routerState.search = { view }
      const rendered = renderRoute(DetailLayout)
      expect(screen.getByTestId(testId).textContent).toBe('ds-1')
      rendered.unmount()
    }
  })

  it('renders the Overview screen when no tab is selected', () => {
    renderRoute(DetailIndex)
    // The index is the Overview the tab links to: the dataset's own facts,
    // not a redirect to Snapshots.
    expect(screen.getByText('ambr')).toBeTruthy()
    expect(screen.getByText('31')).toBeTruthy()
    expect(screen.getByText('Not linked to an experiment')).toBeTruthy()
  })
})
