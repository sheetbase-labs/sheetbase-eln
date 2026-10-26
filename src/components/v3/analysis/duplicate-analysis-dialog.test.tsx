import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type { ChartSpec } from '#/lib/chart-spec'
import { DuplicateAnalysisDialog } from './duplicate-analysis-dialog'

const mocks = vi.hoisted(() => ({
  summaries: vi.fn(),
  canonical: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock('#/lib/analysis-studio-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  analysisStudioDataClient: {},
  fetchDatasetSummaries: (...a: unknown[]) => mocks.summaries(...a),
  createAnalysisView: (...a: unknown[]) => mocks.create(...a),
}))
vi.mock('#/lib/chart-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCanonicalDataset: (_c: unknown, id: string) => mocks.canonical(id),
}))

const col = (id: string, label: string) => ({
  id,
  label,
  logicalType: 'decimal',
})
const view = {
  id: 'view-1',
  name: 'Dose response',
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
      display: {},
      overlays: { errorBars: null },
    } as unknown as ChartSpec,
  ],
  export_settings: null,
} as unknown as AnalysisViewWire

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
    await screen.findByRole('option', { name: 'Plate 2' })
    await user.selectOptions(screen.getByRole('combobox'), 'ds-b')
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
    await screen.findByRole('option', { name: 'Plate 2' })
    await user.selectOptions(screen.getByRole('combobox'), 'ds-b')
    expect(await screen.findByText(/no column matching Signal/)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save copy' })
        .disabled,
    ).toBe(true)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
