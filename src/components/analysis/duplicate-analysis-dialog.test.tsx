import { choose } from '../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type { ChartSpec } from '#/lib/chart-spec'
import type { fetchCanonicalDataset } from '#/lib/chart-data'
import { DuplicateAnalysisDialog } from './duplicate-analysis-dialog'

const mocks = vi.hoisted(() => ({
  summaries: vi.fn(),
  canonical: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The dialog navigates to the copy it created; this suite renders the dialog alone and records that navigation instead of mounting the generated route tree.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Toasts are painted by the app shell's Toaster; this suite renders the dialog alone, so toast calls are recorded and never painted.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The dialog imports its reads and its create call directly, with no injection point; this suite answers them with two fixed datasets.
vi.mock('#/lib/analysis-studio-data', async (importOriginal) => ({
  ...(await importOriginal()),
  analysisStudioDataClient: {},
  fetchDatasetSummaries: (...a: unknown[]) => mocks.summaries(...a),
  createAnalysisView: (...a: unknown[]) => mocks.create(...a),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The canonical dataset read is imported directly by the dialog; this suite answers it per dataset id so the column matching can be asserted.
vi.mock('#/lib/chart-data', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchCanonicalDataset: (
    _client: Parameters<typeof fetchCanonicalDataset>[0],
    id: string,
  ) => mocks.canonical(id),
}))

const col = (id: string, label: string) => ({
  id,
  label,
  logicalType: 'decimal',
})

const view: AnalysisViewWire = {
  id: 'view-1',
  workspace_id: 'ws',
  owner_user_id: 'u',
  name: 'Dose response',
  display_id: null,
  version: 1,
  charts: [
    {
      specVersion: 1,
      type: 'scatter',
      datasets: [{ datasetId: 'ds-a' }],
      fields: {
        x: { fieldId: 'f1' },
        y: { fieldId: 'f2' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
        series: [],
      },
      overlays: { errorBars: null },
    },
  ],
  source_revisions: [],
  export_settings: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DuplicateAnalysisDialog
        view={view}
        workspaceId="ws"
        userId="u"
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

function dataset(id: string, name: string, columns: ReturnType<typeof col>[]) {
  return {
    datasetId: id,
    name,
    workspaceId: 'ws',
    schemaVersionId: 'sv',
    schemaVersionNumber: 1,
    revision: 3,
    columns,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DuplicateAnalysisDialog', () => {
  it('copies the analysis onto a dataset whose columns match by name', async () => {
    const user = userEvent.setup()
    mocks.summaries.mockResolvedValue([
      { id: 'ds-a', name: 'Plate 1' },
      { id: 'ds-b', name: 'Plate 2' },
    ])
    mocks.canonical.mockImplementation(async (id: string) =>
      id === 'ds-a'
        ? dataset('ds-a', 'Plate 1', [col('f1', 'Dose'), col('f2', 'Signal')])
        : dataset('ds-b', 'Plate 2', [col('g1', 'dose'), col('g2', 'Signal')]),
    )
    mocks.create.mockResolvedValue({ id: 'view-2' })
    mount()
    await choose(user, /Dataset/, /Plate 2/)
    expect(await screen.findByText(/Dose → dose/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save copy' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())

    const { name, charts }: { name: string; charts: ChartSpec[] } =
      mocks.create.mock.calls[0][1]

    const spec = charts[0]
    expect(name).toBe('Dose response on Plate 2')
    expect(spec.fields.x?.fieldId).toBe('g1')
    expect(spec.datasets).toEqual([{ datasetId: 'ds-b' }])
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/analysis/view-2' }),
    )
  })

  it('names the missing column and offers no copy', async () => {
    const user = userEvent.setup()
    mocks.summaries.mockResolvedValue([{ id: 'ds-b', name: 'Plate 2' }])
    mocks.canonical.mockImplementation(async (id: string) =>
      id === 'ds-a'
        ? dataset('ds-a', 'Plate 1', [col('f1', 'Dose'), col('f2', 'Signal')])
        : dataset('ds-b', 'Plate 2', [col('g1', 'Dose')]),
    )
    mount()
    await choose(user, /Dataset/, /Plate 2/)
    expect(await screen.findByText(/no column matching Signal/)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save copy' })
        .disabled,
    ).toBe(true)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
