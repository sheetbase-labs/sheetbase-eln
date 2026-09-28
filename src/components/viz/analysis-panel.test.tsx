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

import { AnalysisPanel } from './analysis-panel'
import type * as definitionsData from '#/lib/analysis-definitions-data'
import { fetchAnalysisDefinitions } from '#/lib/analysis-definitions-data'
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
  fireEvent.click(
    screen.getByRole('button', { name: /Descriptive statistics/i }),
  )
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
})
