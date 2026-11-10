/**
 * R5-SURF-01 — the dataset detail's search-param tabs. `?view=` selects the
 * Imports, Used by and History panels (linkable and reloadable), and the tab
 * nav offers each as a real link. With no tab the index route shows the
 * Overview screen, which the Overview tab links to.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as DetailRoute } from './$datasetId'
import { Route as IndexRoute } from './$datasetId/index'

const fixtures = vi.hoisted(() => {
  /** A nullable text fixture field, kept wide for the cases that set one. */
  const nullableText = (value: string | null): string | null => value

  const routerState: RouterStateFixture = {
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
      experimentId: nullableText(null),
      reviewState: null,
      updated: '2026-09-25',
      updatedAt: '2026-09-25T10:11:00.000Z',
      archived: false,
    },
    routerState,
  }
})

const dataClient = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))

/** The router state this route reads, as the test sets it per case. */
interface RouterStateFixture {
  search: { view?: string }
  pathname: string
  params: { datasetId: string }
  context: { context: { user: { id: string; name: string } } }
}

/** The props this route hands to a link. */
interface MockLinkProps {
  to?: string
  search?: Record<string, string | number | boolean | undefined>
  children?: React.ReactNode
}

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route module builds its route object from createFileRoute at import time; exercising the layout needs the framework's route object replaced and the router offers no seam to inject one.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  createFileRoute:
    () =>
    <TConfig,>(config: TConfig) => ({
      useParams: () => fixtures.routerState.params,
      useSearch: () => fixtures.routerState.search,
      useRouteContext: () => fixtures.routerState.context,
      useNavigate: () => vi.fn(),
      options: config,
      fullPath: '/datasets/$datasetId',
    }),
  useSearch: () => fixtures.routerState.search,
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => string
  }) => select({ location: { pathname: fixtures.routerState.pathname } }),
  Outlet: () => null,
  redirect: <TOptions,>(options: TOptions) => options,
  Link: ({ to, search, children }: MockLinkProps) => (
    <a data-to={to} data-search={search ? JSON.stringify(search) : undefined}>
      {children}
    </a>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Route hooks read the shared data client directly at import time; the test drives one fixed dataset row through this module boundary.
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route reads user labels through this hook; the test names users deterministically.
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => `name:${id}` }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The list hook owns its own query; the layout test supplies the one dataset row it renders.
vi.mock('#/components/datasets/datasets-data', async (importOriginal) => ({
  ...(await importOriginal()),
  useDatasetSummaries: () => ({
    data: [fixtures.datasetRow],
    isLoading: false,
  }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Each tab pane is an independent component with its own data hooks; the layout test stubs it so it can assert which pane the search parameter selects.
vi.mock('#/components/datasets/dataset-imports-tab', () => ({
  DatasetImportsTab: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="imports-panel">{datasetId}</div>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Each tab pane is an independent component with its own data hooks; the layout test stubs it so it can assert which pane the search parameter selects.
vi.mock('#/components/datasets/dataset-used-by-tab', () => ({
  DatasetUsedByTab: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="used-by-panel">{datasetId}</div>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The pipeline menu is an independent component with its own query and dialog; the layout test stubs it to keep its assertions about the action menu.
vi.mock('#/components/datasets/dataset-run-pipeline', () => ({
  DatasetRunPipeline: () => null,
  DatasetPipelineMenuItems: () => null,
  useDatasetPipelineRuns: () => ({
    candidates: [],
    start: vi.fn(),
    pending: false,
    dialog: null,
  }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Each tab pane is an independent component with its own data hooks; the layout test stubs it so it can assert which pane the search parameter selects.
vi.mock('#/components/datasets/dataset-history-tab', () => ({
  DatasetHistoryTab: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="history-panel">{datasetId}</div>
  ),
}))

// SAFETY: `$datasetId.tsx` declares `component` in its route options, so the
// layout the module exports is the detail component this test renders.
const DetailLayout = DetailRoute.options.component as React.ComponentType

// SAFETY: `$datasetId/index.tsx` declares `component` in its route options, so
// the index module exports the overview component this test renders.
const DetailIndex = IndexRoute.options.component as React.ComponentType

/** A route search object as these cases build it: text values only. */
type DetailSearchInput = Record<string, string | number | boolean | undefined>

// SAFETY: the detail route's parser reads only `view` from the search object,
// and these cases supply text values for it; the assertion narrows the
// framework's route-option wrapper to the plain parser function it holds.
const validateSearch = DetailRoute.options.validateSearch as (
  search: DetailSearchInput,
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

  it('offers Chart and Analyse on every tab, opening the studio on this dataset', async () => {
    for (const pathname of ['/datasets/ds-1', '/datasets/ds-1/rows']) {
      fixtures.routerState.pathname = pathname
      renderRoute(DetailLayout)
      await userEvent.click(
        screen.getByRole('button', { name: 'More dataset actions' }),
      )
      expect(await screen.findByText('Download CSV')).toBeTruthy()
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
