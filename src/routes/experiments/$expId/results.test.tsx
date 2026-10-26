/**
 * The experiment Results tab: the result datasets are located at the data
 * boundary (one display-id filter on `dataset_list_summary`), not by fetching
 * the registry and filtering it in the browser, and each section is named for
 * what it lists.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './results'

const ResultsRoute = Route.options.component as React.ComponentType

const dataClient = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))
const sonner = vi.hoisted(() => ({ toast: vi.fn() }))

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ expId: 'exp-1' }),
    options: config,
  }),
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(sonner.toast, { error: vi.fn() }),
  Toaster: () => null,
}))

/** The experiment links out to two datasets, one analysis and a protocol. */
const LINKS = [
  {
    id: 'l-1',
    target_kind: 'dataset',
    target_identifier: 'DS-0320',
    target_record_id: 'ds-320',
    link_type: 'dataset',
    created_at: '2026-09-25T10:00:00.000Z',
  },
  {
    id: 'l-2',
    target_kind: 'dataset',
    target_identifier: 'DS-0311',
    target_record_id: 'ds-311',
    link_type: 'general',
    created_at: '2026-09-25T10:01:00.000Z',
  },
  {
    id: 'l-3',
    target_kind: 'analysis',
    target_identifier: 'AN-0007',
    target_record_id: 'an-7',
    link_type: 'analysis',
    created_at: '2026-09-25T10:02:00.000Z',
  },
  {
    id: 'l-4',
    target_kind: 'protocol_template',
    target_identifier: 'PRT-0001',
    target_record_id: 'pr-1',
    link_type: 'protocol',
    created_at: '2026-09-25T10:03:00.000Z',
  },
]

const DATASET_ROWS = [
  {
    display_id: 'DS-0320',
    name: 'Ambr 250 harvest',
    model: 'ViCell v2',
    row_count: 96,
    issue_count: 0,
  },
  {
    display_id: 'DS-0311',
    name: 'Capillary isoelectric focusing',
    model: 'Titer v1',
    row_count: 12,
    issue_count: 2,
  },
]

function renderResults() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      {React.createElement(ResultsRoute)}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  dataClient.list.mockImplementation(async (resource: string, query = '') => {
    if (resource === 'record_links') return LINKS
    if (resource === 'records')
      return [{ decision: null, decision_notes: null }]
    if (resource === 'analysis_views') {
      return [
        { id: 'an-7', display_id: 'AN-0007', name: 'VCD by day', charts: [] },
      ]
    }
    if (resource === 'rpc/dataset_list_summary') {
      const wanted = DATASET_ROWS.filter((row) =>
        query.includes(row.display_id),
      )
      return wanted
    }
    return []
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('experiment results', () => {
  it('reads the result datasets through one display-id filter', async () => {
    renderResults()

    expect(await screen.findByText('Ambr 250 harvest')).toBeTruthy()
    expect(screen.getByText('Capillary isoelectric focusing')).toBeTruthy()

    // The registry is never fetched whole and filtered in the browser.
    const datasetReads = dataClient.list.mock.calls.filter(
      ([resource]) => resource === 'rpc/dataset_list_summary',
    )
    expect(datasetReads).toHaveLength(1)
    const query = String(datasetReads[0][1])
    expect(query).toContain('display_id=in.(DS-0320,DS-0311)')
    expect(query).toContain('select=')
  })

  it('names each section for what it lists', async () => {
    renderResults()

    const analyses = (await screen.findByText('Analyses')).closest('section')!
    const datasets = screen.getByText('Datasets').closest('section')!
    expect(await within(analyses).findByText('VCD by day')).toBeTruthy()
    expect(await within(datasets).findByText('Ambr 250 harvest')).toBeTruthy()
  })
})
