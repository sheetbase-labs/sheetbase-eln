/**
 * DSET-03.3 — the dataset Rows grid. The grid reads one window of a snapshot's
 * rows at a time and reaches the rest through "Load more", and the flagged
 * filter counts rows rather than the flags sitting on them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './rows'

const RowsRoute = Route.options.component as React.ComponentType

interface RowsSearch {
  q?: string
  flagged?: boolean
  row?: string
  field?: string
  snapshot?: string
  live?: boolean
}

const fixtures = vi.hoisted(() => {
  const state: { search: RowsSearch } = { search: {} }
  return state
})

const dataClient = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))
const navigateMock = vi.hoisted(() => vi.fn())
const routeContext = vi.hoisted(() => ({
  value: {
    workspace: { id: 'ws-1', name: 'Process Development', role: 'member' },
    user: { id: 'user-1', name: 'Priya' },
  },
}))

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
    useParams: () => ({ datasetId: 'ds-1' }),
    useSearch: () => fixtures.search,
    useNavigate: () => navigateMock,
    useRouteContext: () => ({ context: routeContext.value }),
    options: config,
  }),
  // The rows screen's no-snapshot empty state offers the snapshots tab.
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('#/components/v3/datasets/value-actions', () => ({
  ValueActions: () => null,
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

const PAGE_SIZE = 100
const TOTAL_ROWS = 120

const FIELDS = [
  {
    field_id: 'f-1',
    key: 'conc',
    label: 'Concentration',
    logical_type: 'numeric',
    display_order: 0,
  },
  {
    field_id: 'f-2',
    key: 'vol',
    label: 'Volume',
    logical_type: 'numeric',
    display_order: 1,
  },
]

/** Four active flags, sitting on three rows: r-1 twice, r-2 once, and r-110
 * once — the last sits beyond the first page, so it is outside the loaded
 * window until "Load more" reaches it. */
const FLAGS = [
  ['fl-1', 'r-1', 'f-1'],
  ['fl-2', 'r-1', 'f-2'],
  ['fl-3', 'r-2', 'f-1'],
  ['fl-4', 'r-110', 'f-1'],
].map(([id, rowId, fieldId]) => ({
  id,
  dataset_id: 'ds-1',
  row_id: rowId,
  field_id: fieldId,
  kind: 'out_of_range',
  source: 'manual',
  system_rule: null,
  reason: 'Outside the allowed range',
  comment: null,
  evaluated_value: null,
  threshold: null,
  evaluated_at: null,
  set_at: '2026-09-25T10:00:00.000Z',
  cleared_at: null,
  cleared_reason: null,
}))

const VERSION = {
  id: 'v-1',
  label: 'S-1',
  createdAt: '2026-09-25T10:00:00.000Z',
  createdByUserId: 'user-1',
  sourceDatasetRevision: 3,
  rowCount: TOTAL_ROWS,
}

function page(offset: number) {
  const end = Math.min(offset + PAGE_SIZE, TOTAL_ROWS)
  const rows = []
  for (let n = offset + 1; n <= end; n += 1) {
    rows.push({
      rowId: `r-${n}`,
      revision: 1,
      values: { 'f-1': `val-${n}`, 'f-2': `vol-${n}` },
    })
  }
  return {
    datasetVersionId: VERSION.id,
    datasetId: 'ds-1',
    schemaVersionId: 'sv-1',
    totalCount: TOTAL_ROWS,
    offset,
    limit: PAGE_SIZE,
    rows,
  }
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      {React.createElement(RowsRoute)}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fixtures.search = {}
  dataClient.list.mockImplementation(async (resource: string) => {
    if (resource === 'dataset_schema_version_fields') return FIELDS
    if (resource === 'dataset_value_flags') return FLAGS
    return []
  })
  dataClient.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      if (name === 'dataset_version_list') return [VERSION]
      if (name === 'query_dataset_version_rows') {
        return page(Number(args.p_offset ?? 0))
      }
      return []
    },
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dataset rows grid', () => {
  it('does not substitute the latest snapshot when a cited version is unavailable', async () => {
    fixtures.search = { snapshot: 'unavailable-version' }
    renderGrid()
    await screen.findByText('Cited snapshot unavailable')
    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith('dataset_version_list', {
        p_dataset_id: 'ds-1',
      }),
    )
    expect(
      dataClient.rpc.mock.calls.some(
        ([name]) => name === 'query_dataset_version_rows',
      ),
    ).toBe(false)
  })

  it('opens a linked live value outside the snapshot window without requiring a snapshot', async () => {
    fixtures.search = { row: 'r-903', field: 'f-2', live: true }
    dataClient.rpc.mockImplementation(async (name: string) => {
      if (name === 'dataset_version_list') return []
      if (name === 'dataset_value_context')
        return {
          datasetId: 'ds-1',
          schemaVersionId: 'schema-live',
          totalCount: 1,
          offset: 0,
          limit: 1,
          rows: [
            {
              rowId: 'r-903',
              revision: 6,
              values: { 'f-1': 'live-903', 'f-2': 17.25 },
            },
          ],
        }
      return []
    })
    renderGrid()
    expect(await screen.findByText(/Live dataset value/)).toBeTruthy()
    expect((await screen.findAllByText('17.25')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Showing 1 of 1 row/)).toBeTruthy()
    expect(screen.queryByText('No snapshot to read rows from')).toBeNull()
    expect(dataClient.rpc).toHaveBeenCalledWith('dataset_value_context', {
      p_dataset_id: 'ds-1',
      p_row_id: 'r-903',
    })
    expect(dataClient.rpc).not.toHaveBeenCalledWith(
      'query_dataset_version_rows',
      expect.anything(),
    )
  })

  it('reaches every row of the snapshot through Load more', async () => {
    const user = userEvent.setup()
    renderGrid()

    expect((await screen.findAllByText('val-1')).length).toBeGreaterThan(0)
    expect(screen.queryByText('val-101')).toBeNull()
    expect(dataClient.rpc).toHaveBeenCalledWith('query_dataset_version_rows', {
      p_dataset_version_id: 'v-1',
      p_limit: PAGE_SIZE,
      p_offset: 0,
    })

    await user.click(screen.getByRole('button', { name: /Load more/ }))

    // The grid virtualises its rows, so the second page's last row is not in
    // the DOM; the screen's own count is what says every row is loaded.
    expect(await screen.findByText(/Showing 120 of 120 rows/)).toBeTruthy()
    expect(dataClient.rpc).toHaveBeenCalledWith('query_dataset_version_rows', {
      p_dataset_version_id: 'v-1',
      p_limit: PAGE_SIZE,
      p_offset: PAGE_SIZE,
    })
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
  })

  it('counts flagged rows, not the flags on them', async () => {
    fixtures.search = { flagged: true }
    renderGrid()

    expect(await screen.findByText('Only flagged rows (2)')).toBeTruthy()
    expect((await screen.findAllByText('val-1')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('val-2')).length).toBeGreaterThan(0)
    expect(screen.queryByText('val-3')).toBeNull()
  })

  it('counts only the flagged rows in the loaded window, matching the result line', async () => {
    const user = userEvent.setup()
    fixtures.search = { flagged: true }
    renderGrid()

    // The flagged filter reads the loaded window, so the count does too: two
    // flagged rows are loaded, matching "Showing 2 of 120 rows".
    expect(await screen.findByText('Only flagged rows (2)')).toBeTruthy()
    expect(screen.getByText(/Showing 2 of 120 rows/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Load more/ }))

    // The flag on r-110 arrives with the rest of the snapshot, and the count
    // converges on it as the result line does.
    expect(await screen.findByText('Only flagged rows (3)')).toBeTruthy()
    expect(screen.getByText(/Showing 3 of 120 rows/)).toBeTruthy()
  })

  it('offers a route to correct a value, since the grid is read-only (J-DAT-02)', async () => {
    renderGrid()

    expect(await screen.findByText('Correct by re-import')).toBeTruthy()
  })

  it('keeps every character of a burst typed faster than the route echoes it', async () => {
    renderGrid()
    const field = await screen.findByLabelText<HTMLInputElement>('Search rows')

    // Each change lands before the previous navigation has echoed `q` back, so
    // a field rendered straight from the route would lose the earlier keys.
    fireEvent.change(field, { target: { value: 'Q' } })
    fireEvent.change(field, { target: { value: 'QA' } })
    fireEvent.change(field, { target: { value: 'QA3' } })

    expect(field.value).toBe('QA3')
    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1))
    const navigated = navigateMock.mock.calls[0][0] as {
      search: (previous: RowsSearch) => RowsSearch
    }
    expect(navigated.search({})).toMatchObject({ q: 'QA3' })
  })

  it('adopts a query the route sets outside the field', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const tree = (
      <QueryClientProvider client={client}>
        {React.createElement(RowsRoute)}
      </QueryClientProvider>
    )
    const view = render(tree)
    const field = await screen.findByLabelText<HTMLInputElement>('Search rows')
    expect(field.value).toBe('')

    // A tab or a "Clear search" changes the route's query without a keystroke.
    fixtures.search = { q: 'QA3' }
    view.rerender(tree)

    await waitFor(() => expect(field.value).toBe('QA3'))
  })
})
