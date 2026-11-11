/**
 * QA3-analysis-1 / QA3-analysis-2 — the Analysis list's "Cited in records" tab.
 *
 * The citations live in their own query, so it resolves after the first render.
 * A direct load of /analysis?tab=cited must still render the rows the tab count
 * advertises, and an empty filtered list must say which filter matched nothing
 * rather than claim the workspace has no analyses.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './index'
import type * as router from '@tanstack/react-router'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type { ChartSpec } from '#/lib/chart-spec'

/**
 * A saved chart as the database holds it. These fixtures leave out the fields
 * the list never reads, so only `type` and `datasets` are supplied.
 */
function storedChart(chart: {
  type?: string
  datasets?: { datasetId: string }[]
}): ChartSpec {
  // SAFETY: the list reads only a chart's type and datasets, which the fixture supplies.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The fixture is a partial chart on purpose; the `unknown` hop is what lets a partial stand in for the whole spec.
  return chart as unknown as ChartSpec
}

const mocks = vi.hoisted(() => {
  const view = (
    over: Partial<AnalysisViewWire>,
  ): Partial<AnalysisViewWire> => ({
    workspace_id: 'ws-1',
    charts: [storedChart({ type: 'chart', datasets: [{ datasetId: 'ds-1' }] })],
    source_revisions: [],
    export_settings: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    ...over,
  })

  const search: Record<string, string | undefined> = {}
  const citations: { target_identifier: string }[] = []
  const definitions: unknown[] = []

  return {
    search,
    citations,
    definitions,
    views: [
      view({
        id: 'view-1',
        owner_user_id: 'user-1',
        name: 'VCD by day',
        display_id: 'AN-0001',
        version: 2,
      }),
      view({
        id: 'view-2',
        owner_user_id: 'user-2',
        name: 'Yield curve',
        display_id: 'AN-0002',
        version: 1,
      }),
    ],
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time, and the mocked search is how this suite drives the tab and filter the shell would supply.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()

  return {
    ...actual,
    createFileRoute: () => (options: { component?: React.ComponentType }) => ({
      options,
      useSearch: () => mocks.search,
      useRouteContext: () => ({ context: { user: { id: 'user-1' } } }),
    }),
    useNavigate: () => vi.fn(),
    Link: ({ children }: { children?: React.ReactNode }) => (
      <a href="#">{children}</a>
    ),
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- The shared client opens over the app's transport at import time; every read this page makes goes through the doubles below.
vi.mock('#/lib/data-client', () => ({ createDataClient: () => ({}) }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The saved analyses are the data under test; the list's own grouping, filters and empty states are what these tests exercise.
vi.mock('#/lib/analysis-studio-data', () => ({
  analysisStudioQueryKeys: {
    views: ['analysis-views'],
    datasets: ['analysis-datasets'],
  },
  fetchAnalysisViews: async () => mocks.views,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Definition rows are a separate read the list only counts; the double answers none.
vi.mock('#/lib/analysis-definitions-data', () => ({
  analysisDefinitionQueryKeys: { all: ['analysis-definitions'] },
  fetchAnalysisDefinitions: async () => mocks.definitions,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Dataset summaries are a separate read the list only counts; the double answers none.
vi.mock('#/lib/dataset-explorer-data', () => ({
  fetchDatasetSummaries: async () => [],
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Citations are the data under test, and the double also delays the answer to the ordering a real reload has.
vi.mock('#/lib/notebook-data', () => ({
  // The citations query resolves after the view list on a real reload; the
  // delay keeps that ordering so the test exercises the late-resolving path.
  notebookDataClient: {
    list: async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })

      return mocks.citations
    },
  },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- User names are a server read; the list's owner column is the only place this suite reads one.
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

// The dropdown is irrelevant to list rendering and pulls in the floating layer.
// oxlint-disable-next-line anti-slop/no-module-mocking -- The row menu mounts a floating layer this suite never opens; its items are replaced by plain wrappers so the list renders in jsdom.
vi.mock('#/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => null,
}))

const DEFAULT_VIEWS = [...mocks.views]

function renderHome(citations: { target_identifier: string }[]) {
  mocks.citations = citations
  // SAFETY: `index.tsx` registers its page as the route's component, so the factory above always supplies one.
  const AnalysisHome = Route.options.component as React.ComponentType

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <AnalysisHome />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  mocks.search = {}
  mocks.views = [...DEFAULT_VIEWS]
  mocks.definitions = []
})

describe('Analysis list — cited in records tab', () => {
  it('renders the cited rows on a direct load, not only after a click', async () => {
    mocks.search = { tab: 'cited' }

    renderHome([{ target_identifier: 'AN-0001' }])

    // The desktop table and the phone list both render each analysis.
    expect((await screen.findAllByText('AN-0001')).length).toBeGreaterThan(0)
    expect(screen.queryByText('No analyses yet')).toBeNull()
    expect(screen.queryByText('No analyses are cited in records')).toBeNull()
    expect(screen.queryAllByText('AN-0002')).toEqual([])
  })

  it('says the filter matched nothing rather than claiming no analyses', async () => {
    mocks.search = { tab: 'cited' }

    renderHome([])

    expect(
      await screen.findByText('No analyses are cited in records'),
    ).toBeTruthy()
    expect(screen.queryByText('No analyses yet')).toBeNull()
  })

  it('keeps the first-run copy when the workspace has no analyses at all', async () => {
    mocks.search = {}

    mocks.views = []
    renderHome([])

    expect(await screen.findByText('No analyses yet')).toBeTruthy()
  })
})

describe('Analysis list — chart views and statistics together', () => {
  it('lists a saved statistic beside the chart views and says which is which', async () => {
    mocks.definitions = [
      {
        id: 'def-12345678-0000',
        owner_user_id: 'user-1',
        name: 'Titre summary',
        version: 1,
        definition: {
          kind: 'descriptive',
          datasets: [{ datasetId: 'ds-1' }],
        },
        created_at: '2026-09-03T00:00:00.000Z',
        updated_at: '2026-09-03T00:00:00.000Z',
      },
    ]

    renderHome([])

    expect(
      (await screen.findAllByText('Titre summary')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Statistics · descriptive')).toBeTruthy()
    expect(screen.getAllByText('Chart · chart').length).toBe(2)
    expect(screen.getByText('3 analyses')).toBeTruthy()
  })
})

describe('Analysis list — malformed saved spec (J-DAT-10)', () => {
  it('still lists every analysis when one stored spec has no datasets', async () => {
    mocks.search = { q: 'a' }
    mocks.views = [
      ...DEFAULT_VIEWS,
      {
        ...DEFAULT_VIEWS[0],
        id: 'view-3',
        display_id: 'AN-0003',
        name: 'Broken spec',
        charts: [storedChart({ type: 'chart' })],
      },
    ]

    renderHome([])

    expect((await screen.findAllByText('AN-0003')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('AN-0001').length).toBeGreaterThan(0)
  })
})

describe('analysis list tab strip reflows at 400 % zoom (QA4-zoom-analysis)', () => {
  // At 400 % zoom the column is 312 px wide and "All / Mine / Cited in
  // records / Drafts" is wider than that. The strip had no scroll of its own,
  // so the last tab sat 17 px past the viewport and the document scrolled
  // sideways (WCAG 1.4.10). It scrolls inside its own strip instead, as the
  // Experiments and Projects strips already do.
  it('scrolls the tab strip instead of the page', () => {
    renderHome([])

    const strip = screen.getByRole('navigation', {
      name: 'Analysis lists',
    }).parentElement

    expect(strip).not.toBeNull()
    expect(strip!.className).toContain('overflow-x-auto')
  })
})
