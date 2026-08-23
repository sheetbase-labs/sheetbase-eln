/**
 * SCI-02 analysis panel interaction tests. The panel composes dataset
 * selection, definition authoring, pure execution and saved-definition
 * persistence; the data client is mocked so no PostgREST is required.
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
import type * as scientificSheetData from '#/lib/scientific-sheet-data'
import {
  fetchAllScientificRows,
  fetchScientificTable,
} from '#/lib/scientific-sheet-data'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

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
vi.mock('#/lib/scientific-sheet-data', async (importOriginal) => {
  const actual = await importOriginal<typeof scientificSheetData>()
  return {
    ...actual,
    scientificDataClient: {} as never,
    fetchScientificTable: vi.fn(),
    fetchAllScientificRows: vi.fn(),
  }
})

const mockFetchDefinitions = vi.mocked(fetchAnalysisDefinitions)
const mockFetchTable = vi.mocked(fetchScientificTable)
const mockFetchRows = vi.mocked(fetchAllScientificRows)

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const DATASET = {
  id: '11111111-1111-1111-8111-111111111111',
  resource_name: 'sheet_alpha',
  name: 'Stability',
  schema_version: 1,
  lifecycle: 'active' as const,
  columns: [
    {
      id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01',
      field_name: 'time_h',
      label: 'Time (h)',
      display_order: 0,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
    {
      id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
      field_name: 'recovery',
      label: 'Recovery (%)',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
    {
      id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
      field_name: 'condition',
      label: 'Condition',
      display_order: 2,
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
  ],
} as unknown as ScientificTableWire

beforeEach(() => {
  mockFetchDefinitions.mockResolvedValue([])
  mockFetchTable.mockResolvedValue(DATASET)
  mockFetchRows.mockResolvedValue([
    { id: 'r1', version: 1, time_h: 0, recovery: 100, condition: '4C' },
    { id: 'r2', version: 1, time_h: 24, recovery: 90, condition: '4C' },
    { id: 'r3', version: 1, time_h: 0, recovery: 80, condition: '20C' },
    { id: 'r4', version: 1, time_h: 24, recovery: 70, condition: '20C' },
  ] as never)
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
    target: { value: DATASET.id },
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
    mockFetchRows.mockResolvedValue([])
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
          datasets: [{ tableId: DATASET.id }],
          value: {
            columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
            fieldName: 'recovery',
          },
          group: {
            columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
            fieldName: 'condition',
          },
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
