/**
 * SCI-02 analysis panel interaction tests. The panel composes dataset
 * selection, definition authoring, pure execution and saved-definition
 * persistence over canonical Datasets; the data layer is mocked so no
 * PostgREST is required.
 */
import userEvent from '@testing-library/user-event'
import { choose } from '../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnalysisPanel, AnalysisResultTable } from './analysis-panel'
import { runAnalysis } from '#/lib/analysis-definition'
import type { AnalysisDefinition } from '#/lib/analysis-definition'
import type { ChartColumn } from '#/lib/chart-spec'
import type * as definitionsData from '#/lib/analysis-definitions-data'
import {
  deleteAnalysisDefinition,
  fetchAnalysisDefinitions,
  saveAnalysisDefinition,
} from '#/lib/analysis-definitions-data'
import type * as chartData from '#/lib/chart-data'
import { resolveDatasetRef } from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'

vi.mock('#/lib/analysis-definitions-data', async (importOriginal) => {
  const actual = await importOriginal<typeof definitionsData>()
  return {
    ...actual,
    fetchAnalysisDefinitions: vi.fn(),
    saveAnalysisDefinition: vi.fn(),
    deleteAnalysisDefinition: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('#/lib/chart-data', async (importOriginal) => {
  const actual = await importOriginal<typeof chartData>()
  return {
    ...actual,
    sciDataClient: {} as never,
    resolveDatasetRef: vi.fn(),
  }
})

const mockFetchDefinitions = vi.mocked(fetchAnalysisDefinitions)
const mockResolveDataset = vi.mocked(resolveDatasetRef)

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
  vi.mocked(saveAnalysisDefinition).mockImplementation(
    async (_client, input, workspaceId, userId) => ({
      id: input.id ?? 'saved',
      workspace_id: workspaceId,
      owner_user_id: userId,
      name: input.name,
      definition: input.definition,
      source_revisions: input.source_revisions,
      version: 1,
      created_at: '',
      updated_at: '',
    }),
  )
  mockFetchDefinitions.mockResolvedValue([])
  // Rows are keyed by stable field_id, exactly as query_dataset_rows returns.
  mockResolveDataset.mockResolvedValue({
    source: DATASET,
    flags: [],
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
  await choose(userEvent.setup(), 'Analysis dataset', /Stability/)
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
  it('authors and saves against the examined snapshot schema and revision', async () => {
    const snapshotId = '22222222-2222-4222-8222-222222222222'
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['dataset-version-summaries', DATASET.datasetId], [])
    client.setQueryData(
      ['analysis-definition-rows', DATASET.datasetId, snapshotId],
      {
        source: {
          ...DATASET,
          revision: 2,
          schemaVersionNumber: 3,
          columns: [
            {
              id: FIELD_RECOVERY,
              label: 'Original recovery',
              logicalType: 'decimal',
            },
          ],
        },
        rows: [{ [FIELD_RECOVERY]: 7 }, { [FIELD_RECOVERY]: 13 }],
        flags: [],
        truncated: false,
        totalCount: 2,
      },
    )
    render(
      <QueryClientProvider client={client}>
        <AnalysisPanel
          datasets={[DATASET]}
          workspaceId="ws-1"
          userId="user-1"
          initialDatasetId={DATASET.datasetId}
          initialSnapshotId={snapshotId}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Descriptive \/ ANOVA/i }),
    )
    expect(
      screen.getByRole('option', { name: 'Original recovery' }),
    ).toBeTruthy()
    expect(
      screen.getByLabelText<HTMLSelectElement>('Measured value column').value,
    ).toBe(FIELD_RECOVERY)
    fireEvent.change(screen.getByLabelText('Analysis name'), {
      target: { value: 'Original recovery' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(saveAnalysisDefinition).toHaveBeenCalledOnce())
    const input = vi.mocked(saveAnalysisDefinition).mock.calls[0][1]
    expect(input.definition.datasets).toEqual([
      { datasetId: DATASET.datasetId, datasetVersionId: snapshotId },
    ])
    expect(input.source_revisions).toEqual([
      { datasetId: DATASET.datasetId, revision: 2, schemaVersionNumber: 3 },
    ])
  })

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
    const select = await screen.findByLabelText('Analysis dataset')
    expect(select.textContent).toBe('Select a dataset')
    rerender(tree([DATASET]))
    await waitFor(() => expect(select.textContent).toContain('Stability'))
    // A later choice of "no dataset" is the person's and is kept.
    await choose(userEvent.setup(), 'Analysis dataset', 'Select a dataset')
    rerender(tree([DATASET]))
    expect(select.textContent).toBe('Select a dataset')
  })

  it('synchronises studio source changes without losing a loaded snapshot', async () => {
    const other = { ...DATASET, datasetId: 'other', name: 'Other dataset' }
    const snapshotId = '22222222-2222-4222-8222-222222222222'
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['dataset-version-summaries', DATASET.datasetId], [])
    mockFetchDefinitions.mockResolvedValue([
      {
        id: 'pinned',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        name: 'Pinned recovery',
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [
            { datasetId: DATASET.datasetId, datasetVersionId: snapshotId },
          ],
          value: { fieldId: FIELD_RECOVERY },
        },
        source_revisions: [],
        version: 1,
        created_at: '',
        updated_at: '',
      },
    ])
    function Studio() {
      const [source, setSource] = useState(other.datasetId)
      return (
        <QueryClientProvider client={client}>
          <label>
            Studio source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              {[DATASET, other].map((dataset) => (
                <option key={dataset.datasetId} value={dataset.datasetId}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <AnalysisPanel
            datasets={[DATASET, other]}
            workspaceId="ws-1"
            userId="user-1"
            initialDatasetId={source}
            onDatasetChange={setSource}
          />
        </QueryClientProvider>
      )
    }
    render(<Studio />)
    const studio = screen.getByLabelText<HTMLSelectElement>('Studio source')
    const panel = screen.getByLabelText('Analysis dataset')
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }))
    await waitFor(() => expect(studio.value).toBe(DATASET.datasetId))
    expect(panel.textContent).toContain('Stability')
    expect(screen.getByText(/Reading snapshot/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()

    await choose(userEvent.setup(), 'Analysis dataset', /Other dataset/)
    expect(studio.value).toBe(other.datasetId)
    expect(screen.queryByText(/Reading (a )?snapshot/)).toBeNull()
    expect(screen.queryByLabelText('Measured value column')).toBeNull()

    fireEvent.change(studio, { target: { value: DATASET.datasetId } })
    await waitFor(() => expect(panel.textContent).toContain('Stability'))
    expect(screen.queryByText(/Reading snapshot/)).toBeNull()
  })

  it('surfaces an honest execution error for an empty dataset', async () => {
    mockResolveDataset.mockResolvedValue({
      source: DATASET,
      flags: [],
      rows: [],
      totalCount: 0,
      truncated: false,
    })
    await runDescriptive()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/dataset has no rows/i)
  })

  it('shows a changed-source error instead of presenting scientific results', async () => {
    mockResolveDataset.mockRejectedValue(
      new Error('Dataset changed while loading; reload before analysing'),
    )
    renderPanel()
    await choose(userEvent.setup(), 'Analysis dataset', /Stability/)
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Dataset changed/,
    )
    expect(
      screen.queryByRole('table', { name: 'Descriptive statistics per group' }),
    ).toBeNull()
  })

  it('adopts a saved analysis immediately for citation and subsequent updates', async () => {
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
    await waitFor(() => expect(saveAnalysisDefinition).toHaveBeenCalledOnce())
    expect(
      await screen.findByRole('button', { name: /Cite in a notebook/ }),
    ).toBeTruthy()
    expect(screen.getByText('median')).toBeTruthy()
    expect(screen.getByLabelText('Analysis dataset').textContent).toContain(
      'Stability',
    )
    fireEvent.click(screen.getByRole('button', { name: /^Update$/ }))
    await waitFor(() => expect(saveAnalysisDefinition).toHaveBeenCalledTimes(2))
    expect(vi.mocked(saveAnalysisDefinition).mock.calls[1][1].id).toBe('saved')
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
