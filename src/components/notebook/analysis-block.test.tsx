/**
 * SCI-03 analysis block preview tests. A frozen block re-executes the pinned
 * definition over pinned inputs with no live reads; a live block loads the
 * saved definition through the mocked data client. No PostgREST required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockPreview } from './block-preview'
import type { FrozenAnalysis } from '#/lib/analysis-block'
import type * as definitionsData from '#/lib/analysis-definitions-data'
import { fetchAnalysisDefinition } from '#/lib/analysis-definitions-data'
import type * as scientificSheetData from '#/lib/scientific-sheet-data'
import {
  fetchAllScientificRows,
  fetchScientificTable,
} from '#/lib/scientific-sheet-data'

vi.mock('#/lib/analysis-definitions-data', async (importOriginal) => {
  const actual = await importOriginal<typeof definitionsData>()
  return {
    ...actual,
    fetchAnalysisDefinition: vi.fn(),
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

const mockFetchDefinition = vi.mocked(fetchAnalysisDefinition)
const mockFetchTable = vi.mocked(fetchScientificTable)
const mockFetchRows = vi.mocked(fetchAllScientificRows)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function renderPreview(payload: unknown) {
  render(
    <BlockPreview block={{ id: 'b1', type: 'analysis', payload } as never} />,
    {
      wrapper: wrapper(),
    },
  )
}

const FROZEN: FrozenAnalysis = {
  revisionId: null,
  frozenAt: '2026-08-23T10:00:00Z',
  frozenByUserId: 'user-1',
  definition: {
    definitionVersion: 1,
    kind: 'descriptive',
    datasets: [{ tableId: '11111111-1111-1111-8111-111111111111' }],
    value: {
      columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
      fieldName: 'recovery',
    },
    group: null,
  },
  definitionName: 'Recovery summary',
  definitionVersion: 2,
  datasetProvenance: [
    {
      tableId: '11111111-1111-1111-8111-111111111111',
      schemaVersion: 3,
      rowCount: 2,
      checksum: 'deadbeefdeadbeefdeadbeefdeadbeef',
    },
  ],
  data: {
    columns: [
      {
        columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
        fieldName: 'recovery',
        label: 'Recovery (%)',
        logicalType: 'decimal',
      },
    ],
    rows: [{ recovery: 10 }, { recovery: 30 }],
  },
}

describe('analysis block preview', () => {
  it('renders the frozen result from pinned inputs only — no live reads', async () => {
    renderPreview({ title: 'Recovery', definitionId: 'def-1', frozen: FROZEN })
    expect(screen.getByText(/Frozen snapshot/i)).toBeTruthy()
    // Pinned descriptive statistics for [10, 30]: mean 20, median 20.
    await screen.findByRole('table')
    expect(screen.getAllByText('20').length).toBeGreaterThan(0)
    expect(screen.getByText(/deadbeef/)).toBeTruthy()
    expect(mockFetchDefinition).not.toHaveBeenCalled()
    expect(mockFetchTable).not.toHaveBeenCalled()
  })

  it('renders a live block by loading the saved definition and its rows', async () => {
    mockFetchDefinition.mockResolvedValue({
      id: 'def-1',
      workspace_id: 'ws',
      owner_user_id: 'user-1',
      name: 'Recovery summary',
      version: 5,
      definition: FROZEN.definition,
      source_revisions: [],
      created_at: '',
      updated_at: '',
    })
    mockFetchTable.mockResolvedValue({
      id: '11111111-1111-1111-8111-111111111111',
      resource_name: 'sheet_alpha',
      name: 'Stability',
      schema_version: 3,
      lifecycle: 'active',
      columns: [
        {
          id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
          field_name: 'recovery',
          label: 'Recovery (%)',
          display_order: 0,
          logical_type: 'decimal',
          nullable: true,
          unit: null,
          validation: {},
          width: null,
          options: [],
        },
      ],
    } as never)
    mockFetchRows.mockResolvedValue([
      { id: 'r1', version: 1, recovery: 100 },
      { id: 'r2', version: 1, recovery: 300 },
    ] as never)

    renderPreview({ title: 'Recovery', definitionId: 'def-1' })
    await waitFor(() =>
      expect(screen.getByText(/Recovery summary · v5/)).toBeTruthy(),
    )
    await screen.findByRole('table')
    expect(screen.getByText('mean')).toBeTruthy()
  })

  it('surfaces an honest state when the referenced definition is gone', async () => {
    mockFetchDefinition.mockResolvedValue(null)
    renderPreview({ title: 'Gone', definitionId: 'deleted-def' })
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('prompts configuration for an empty draft', () => {
    renderPreview({})
    expect(screen.getByText(/No analysis configured/i)).toBeTruthy()
  })
})
