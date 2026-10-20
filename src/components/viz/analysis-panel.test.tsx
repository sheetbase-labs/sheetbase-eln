/**
 * SCI-02 analysis panel interaction tests. The panel composes dataset
 * selection, definition authoring, pure execution and saved-definition
 * persistence over canonical Datasets; the data layer is mocked so no
 * PostgREST is required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnalysisPanel, AnalysisResultTable } from './analysis-panel'
import { runAnalysis } from '#/lib/analysis-definition'
import type { AnalysisDefinition } from '#/lib/analysis-definition'
import type { ChartColumn } from '#/lib/chart-spec'
import type * as definitionsData from '#/lib/analysis-definitions-data'
import {
  deleteAnalysisDefinition,
  fetchAnalysisDefinitions,
} from '#/lib/analysis-definitions-data'
import type * as chartData from '#/lib/chart-data'
import { fetchCanonicalDataset, fetchDatasetRows } from '#/lib/chart-data'
import type * as flagsModule from '#/lib/dataset-flags'
import type { CanonicalDatasetSource } from '#/lib/chart-data'

vi.mock('#/lib/analysis-definitions-data', async (importOriginal) => {
  const actual = await importOriginal<typeof definitionsData>()
  return {
    ...actual,
    fetchAnalysisDefinitions: vi.fn(),
    saveAnalysisDefinition: vi
      .fn()
      .mockResolvedValue({ id: 'saved', version: 1 }),
    deleteAnalysisDefinition: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('#/lib/dataset-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof flagsModule>()
  return {
    ...actual,
    fetchActiveDatasetFlags: vi.fn().mockResolvedValue([]),
  }
})
vi.mock('#/lib/chart-data', async (importOriginal) => {
  const actual = await importOriginal<typeof chartData>()
  return {
    ...actual,
    sciDataClient: {} as never,
    fetchCanonicalDataset: vi.fn(),
    fetchDatasetRows: vi.fn(),
  }
})

const mockFetchDefinitions = vi.mocked(fetchAnalysisDefinitions)
const mockFetchDataset = vi.mocked(fetchCanonicalDataset)
const mockFetchRows = vi.mocked(fetchDatasetRows)

const FIELD_TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const FIELD_RECOVERY = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const FIELD_CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const DATASET: CanonicalDatasetSource = {
  datasetId: '11111111-1111-1111-8111-111111111111',
  name: 'Stability',
  workspaceId: 'ws-1',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 1,
  columns: [
    { id: FIELD_TIME, label: 'Time (h)', logicalType: 'decimal' },
    { id: FIELD_RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
    { id: FIELD_CONDITION, label: 'Condition', logicalType: 'category' },
  ],
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  mockFetchDefinitions.mockResolvedValue([])
  mockFetchDataset.mockResolvedValue(DATASET)
  // Rows are keyed by stable field_id, exactly as query_dataset_rows returns.
  mockFetchRows.mockResolvedValue({
    rows: [
      { [FIELD_TIME]: 0, [FIELD_RECOVERY]: 100, [FIELD_CONDITION]: '4C' },
      { [FIELD_TIME]: 24, [FIELD_RECOVERY]: 90, [FIELD_CONDITION]: '4C' },
      { [FIELD_TIME]: 0, [FIELD_RECOVERY]: 80, [FIELD_CONDITION]: '20C' },
      { [FIELD_TIME]: 24, [FIELD_RECOVERY]: 70, [FIELD_CONDITION]: '20C' },
    ],
    totalCount: 4,
    truncated: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel() {
  render(
    <AnalysisPanel datasets={[DATASET]} workspaceId="ws-1" userId="user-1" />,
    { wrapper: wrapper() },
  )
}

async function runDescriptive() {
  renderPanel()
  await screen.findByLabelText('Analysis dataset')
  fireEvent.change(screen.getByLabelText('Analysis dataset'), {
    target: { value: DATASET.datasetId },
  })
  fireEvent.click(screen.getByRole('button', { name: /Descriptive \/ ANOVA/i }))
  await waitFor(() =>
    expect(screen.getByLabelText('Measured value column')).toBeTruthy(),
  )
  const run = screen.getByRole('button', { name: /Run/i })
  const runButton = run as HTMLButtonElement
  await waitFor(() => expect(runButton.disabled).toBe(false))
  fireEvent.click(runButton)
}

describe('AnalysisPanel', () => {
  it('runs a grouped descriptive analysis against live rows', async () => {
    await runDescriptive()
    // Groups appear in codepoint-sorted order with computed statistics.
    expect(screen.getByText('20C')).toBeTruthy()
    expect(screen.getByText('4C')).toBeTruthy()
    expect(screen.getByText('median')).toBeTruthy()
  })

  it("selects the requested dataset once a deep link's sources arrive", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const tree = (datasets: CanonicalDatasetSource[]) => (
      <QueryClientProvider client={client}>
        <AnalysisPanel
          datasets={datasets}
          workspaceId="ws-1"
          userId="user-1"
          initialDatasetId={DATASET.datasetId}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(tree([]))
    const select = (await screen.findByLabelText(
      'Analysis dataset',
    )) as HTMLSelectElement
    expect(select.value).toBe('')
    rerender(tree([DATASET]))
    await waitFor(() => expect(select.value).toBe(DATASET.datasetId))
    // A later choice of "no dataset" is the person's and is kept.
    fireEvent.change(select, { target: { value: '' } })
    rerender(tree([DATASET]))
    expect(select.value).toBe('')
  })

  it('surfaces an honest execution error for an empty dataset', async () => {
    mockFetchRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      truncated: false,
    })
    await runDescriptive()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/dataset has no rows/i)
  })

  it('enables saving only with a name and persists through the data layer', async () => {
    await runDescriptive()
    const save = screen.getByRole('button', {
      name: /^Save$/,
    })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Analysis name'), {
      target: { value: 'Recovery summary' },
    })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.click(save)
    const { saveAnalysisDefinition } =
      await import('#/lib/analysis-definitions-data')
    await waitFor(() => expect(saveAnalysisDefinition).toHaveBeenCalledOnce())
  })

  it('lists saved analyses and loads one back into the editor', async () => {
    mockFetchDefinitions.mockResolvedValue([
      {
        id: 'def-1',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        name: 'Recovery summary',
        version: 3,
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [{ datasetId: DATASET.datasetId }],
          value: { fieldId: FIELD_RECOVERY },
          group: { fieldId: FIELD_CONDITION },
        },
        source_revisions: [],
        created_at: '',
        updated_at: '',
      },
    ])
    renderPanel()
    await screen.findByText('Recovery summary')
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Measured value column')).toBeTruthy(),
    )
    expect(screen.getByDisplayValue('Recovery summary')).toBeTruthy()
  })

  it('deletes a saved analysis only after the confirmation', async () => {
    mockFetchDefinitions.mockResolvedValue([
      {
        id: 'def-1',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        name: 'Recovery summary',
        version: 3,
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [{ datasetId: DATASET.datasetId }],
          value: { fieldId: FIELD_RECOVERY },
          group: { fieldId: FIELD_CONDITION },
        },
        source_revisions: [],
        created_at: '',
        updated_at: '',
      },
    ])
    renderPanel()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Recovery summary' }),
    )
    // The row action asks first: nothing is deleted until the dialog's action.
    expect(vi.mocked(deleteAnalysisDefinition)).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this saved analysis?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(vi.mocked(deleteAnalysisDefinition)).toHaveBeenCalledWith(
        expect.anything(),
        'def-1',
      ),
    )
  })

  it('states the method and its checks alongside the numbers', async () => {
    await runDescriptive()
    // R5-STUDIO-01: the result names the model it ran, its version and its
    // runner before any number is read.
    expect(screen.getByText('One-way ANOVA')).toBeTruthy()
    expect(screen.getByText('method v1')).toBeTruthy()
    expect(screen.getByText('sheetbase-analysis-kernel@1')).toBeTruthy()
    expect(screen.getByText('Between groups')).toBeTruthy()
    expect(screen.getByText('Assumption checks')).toBeTruthy()
    // Four observations cannot support Jarque–Bera; the check says so rather
    // than reporting a pass.
    expect(
      screen.getByText(/Jarque–Bera needs at least 8 residuals/),
    ).toBeTruthy()
  })
})

describe('AnalysisResultTable', () => {
  it('renders the term table, the method and a failed check as it stands', () => {
    // Deliberately heteroscedastic: the residual spread is far larger over
    // the second half, so the constant-variance check must fail visibly.
    const noise = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 8, -8, 8, -8, 8, -8]
    const definition: AnalysisDefinition = {
      definitionVersion: 1,
      kind: 'regression',
      datasets: [{ datasetId: DATASET.datasetId }],
      outcome: { fieldId: FIELD_RECOVERY },
      predictor: { fieldId: FIELD_TIME },
      degree: 1,
    }
    const columns: ChartColumn[] = [
      { id: FIELD_TIME, label: 'Time (h)', logicalType: 'decimal' },
      { id: FIELD_RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
    ]
    const rows = noise.map((d, index) => ({
      [FIELD_TIME]: index + 1,
      [FIELD_RECOVERY]: index + 1 + d,
    }))
    const result = runAnalysis(definition, columns, rows)
    if (!result.ok) throw new Error('expected a regression result')
    render(<AnalysisResultTable result={result.result} />)

    expect(
      screen.getByText('Linear model (ordinary least squares)'),
    ).toBeTruthy()
    expect(screen.getByText('Term')).toBeTruthy()
    expect(screen.getByText('95% CI')).toBeTruthy()
    expect(screen.getByText('Intercept')).toBeTruthy()
    expect(
      screen.getByText(/Fails · Residual variance is constant/),
    ).toBeTruthy()
    expect(
      screen.getByText(/transform(ing)? the outcome or weighting the fit/),
    ).toBeTruthy()
  })
})
