/**
 * R5-STUDIO-03 — the read-only analysis view.
 *
 * The staleness pill reports what the canonical source check answered: while it
 * is still running, or when it failed, the page must not claim the analysis is
 * up to date. "Edit in studio" carries the view being read, so the studio opens
 * it rather than an unrelated default.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$analysisId'
import type * as router from '@tanstack/react-router'
import type { AnalysisViewSourceStatus } from '#/lib/analysis-studio-data'

const mocks = vi.hoisted(() => ({
  datasets: [] as Record<string, unknown>[],
  columns: [] as Record<string, unknown>[],
  list: vi.fn(async (): Promise<unknown[]> => []),
  sourceStatus: vi.fn(async (): Promise<unknown> => null),
  update: vi.fn(async (): Promise<unknown> => ({ version: 4 })),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({
      options,
      useParams: () => ({ analysisId: 'view-1' }),
      useRouteContext: () => ({
        context: { user: { id: 'u1', name: 'Ada' }, workspace: { id: 'ws1' } },
      }),
    }),
    // The link's search is rendered into the href, so a test can see the view
    // the studio is asked to open.
    Link: ({
      to,
      search,
      children,
    }: {
      to?: unknown
      search?: Record<string, string | undefined>
      children?: React.ReactNode
    }) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(search ?? {})) {
        if (value !== undefined) params.set(key, value)
      }
      const query = params.toString()
      const target = typeof to === 'string' ? to : '#'
      return <a href={`${target}${query ? `?${query}` : ''}`}>{children}</a>
    },
    redirect: (options: unknown) => options,
  }
})

vi.mock('#/components/v3/datasets/datasets-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDatasetSummaries: () => ({ data: mocks.datasets, isLoading: false }),
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchProject: async () => ({ id: 'prj-1', title: 'Clarification programme' }),
}))

vi.mock('#/lib/analysis-studio-data', () => ({
  analysisStudioDataClient: { list: mocks.list, rpc: vi.fn() },
  analysisStudioQueryKeys: {
    sourceStatus: (id: string) => ['analysis-view', id, 'source-status'],
    citations: (id: string) => ['analysis-view', id, 'citations'],
  },
  fetchAnalysisViewSourceStatus: () => mocks.sourceStatus(),
  fetchAnalysisViewCitations: async () => [],
  updateAnalysisView: mocks.update,
  validateAnalysisSpec: () => ({ ok: true }),
}))

vi.mock('#/lib/chart-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveChartDataset: async () => ({
    source: {
      name: 'Clarification runs',
      schemaVersionNumber: 2,
      columns: mocks.columns,
    },
    totalCount: 3,
    rows: [],
    series: [],
  }),
  materialiseLiveChart: () => ({ rows: [], series: [], droppedPoints: 0 }),
}))

vi.mock('#/components/viz/chart-renderer', () => ({
  ChartRenderer: () => <div data-testid="chart" />,
}))

const VIEW = {
  id: 'view-1',
  workspace_id: 'ws-1',
  owner_user_id: 'user-1',
  name: 'Clarification trend',
  display_id: 'AV-0007',
  version: 3,
  spec: { datasets: [{ datasetId: 'ds-1' }] },
  source_revisions: [],
  export_settings: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
}

function sourceStatus(
  state: AnalysisViewSourceStatus['state'],
): AnalysisViewSourceStatus {
  return {
    viewId: 'view-1',
    displayId: 'AV-0007',
    name: 'Clarification trend',
    version: 3,
    state,
    staleCount: state === 'stale' ? 1 : 0,
    removedCount: 0,
    sources: [],
    citedByCount: 0,
    citedByLockedCount: 0,
    acknowledged: null,
  }
}

function renderView() {
  const AnalysisView = Route.options.component as React.ComponentType
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AnalysisView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.list.mockResolvedValue([VIEW])
  mocks.datasets = []
})

afterEach(() => {
  cleanup()
  mocks.list.mockReset()
  mocks.sourceStatus.mockReset()
})

describe('Read-only analysis view (R5-STUDIO-03)', () => {
  it('does not claim the sources are up to date while the check is still running', async () => {
    mocks.sourceStatus.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return sourceStatus('current')
    })
    renderView()

    expect(await screen.findByText('Checking sources…')).toBeTruthy()
    expect(screen.queryByText('Up to date')).toBeNull()
    // The canonical answer replaces it once the check completes.
    expect(await screen.findByText('Up to date')).toBeTruthy()
  })

  it('says the source check is unavailable when it fails, not that the analysis is current', async () => {
    mocks.sourceStatus.mockRejectedValue(new Error('status unavailable'))
    renderView()

    expect(await screen.findByText('Source check unavailable')).toBeTruthy()
    expect(screen.queryByText('Up to date')).toBeNull()
  })

  it('reports the canonical answer once the check completes', async () => {
    mocks.sourceStatus.mockResolvedValue(sourceStatus('stale'))
    const { unmount } = renderView()
    expect(await screen.findByText('Sources changed')).toBeTruthy()
    unmount()

    mocks.sourceStatus.mockResolvedValue(sourceStatus('current'))
    renderView()
    expect(await screen.findByText('Up to date')).toBeTruthy()
  })

  it('sends the studio the view it is reading', async () => {
    mocks.sourceStatus.mockResolvedValue(sourceStatus('current'))
    renderView()

    const link = await screen.findByRole('link', { name: 'Edit in studio' })
    const href = link.getAttribute('href') ?? ''
    expect(href).toContain('view=view-1')
    expect(href).toContain('dataset=ds-1')
  })

  it('agrees the citation verb with the count it states', async () => {
    mocks.sourceStatus.mockResolvedValue({
      ...sourceStatus('current'),
      citedByCount: 1,
    })
    const { unmount } = renderView()
    // One citation: "1 record cites this analysis".
    expect(
      await screen.findByText(
        /^1 record cites this analysis, so it keeps the versions it cited\./,
      ),
    ).toBeTruthy()
    unmount()

    mocks.sourceStatus.mockResolvedValue({
      ...sourceStatus('current'),
      citedByCount: 2,
    })
    renderView()
    expect(
      await screen.findByText(
        /^2 records cite this analysis, so it keeps the versions it cited\./,
      ),
    ).toBeTruthy()
  })

  it('climbs from the analysis to its dataset, experiment and project', async () => {
    mocks.sourceStatus.mockResolvedValue(sourceStatus('current'))
    mocks.datasets = [
      {
        id: 'DS-0311',
        uuid: 'ds-1',
        projectId: 'prj-1',
        experimentId: 'EXP-0142',
      },
    ]
    renderView()
    expect(await screen.findByText('Clarification programme')).toBeTruthy()
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/projects/$projectId')
    expect(hrefs).toContain('/experiments/$expId')
    expect(hrefs).toContain('/datasets/$datasetId')
    expect(screen.getByText('EXP-0142')).toBeTruthy()
    expect(screen.getByText('DS-0311')).toBeTruthy()
  })

  it('keeps the Analysis list as the root when the dataset is unknown', async () => {
    mocks.sourceStatus.mockResolvedValue(sourceStatus('current'))
    renderView()
    await screen.findByText('Up to date')
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toContain('/analysis')
  })
})

const chart = (y: string, label: string) => ({
  specVersion: 1,
  type: 'line',
  datasets: [{ datasetId: 'ds-1' }],
  fields: { x: { fieldId: 'load' }, y: { fieldId: y }, series: null },
  display: { axes: { x: { label: 'Load' }, y: { label } } },
  filters: [],
  transformations: [],
  typeParams: {},
  overlays: { errorBars: null, references: [] },
})

describe('An analysis with several charts', () => {
  beforeEach(() => {
    mocks.columns = [
      { id: 'load', label: 'Load', logicalType: 'decimal' },
      { id: 'yield', label: 'Step yield', logicalType: 'decimal' },
      { id: 'ntu', label: 'Turbidity out', logicalType: 'decimal' },
    ]
    mocks.list.mockResolvedValue([
      {
        ...VIEW,
        spec: chart('yield', 'Step yield (%)'),
        extra_charts: [chart('ntu', 'Turbidity out (NTU)')],
      },
    ])
    mocks.sourceStatus.mockResolvedValue(sourceStatus('current'))
  })
  afterEach(() => {
    mocks.columns = []
  })

  it('stacks each chart under a numbered title', async () => {
    renderView()
    expect(await screen.findByText('1 · Step yield (%)')).toBeTruthy()
    expect(screen.getByText('2 · Turbidity out (NTU)')).toBeTruthy()
    expect(screen.getAllByTestId('chart')).toHaveLength(2)
  })

  it('offers a save as the next version only after a change', async () => {
    renderView()
    await screen.findByText('1 · Step yield (%)')
    expect(screen.queryByRole('button', { name: 'Save as v4' })).toBeNull()
    fireEvent.click(screen.getByRole('group', { name: 'Chart 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove this chart' }))
    const save = await screen.findByRole('button', { name: 'Save as v4' })
    fireEvent.click(save)
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalled())
    const input = (mocks.update.mock.calls[0] as unknown as unknown[])[2] as {
      extra_charts: unknown[]
    }
    expect(input.extra_charts).toEqual([])
  })
})
