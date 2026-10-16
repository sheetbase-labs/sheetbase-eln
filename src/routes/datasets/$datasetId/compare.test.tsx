/**
 * DSET-03.3 — the dataset Compare tab pages beyond the first 100 changes.
 * The route drives "Load more" from the server's whole-comparison counts and
 * requests the next p_offset instead of fixing offset 0.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './compare'

const CompareRoute = Route.options.component as React.ComponentType

const dataClient = vi.hoisted(() => ({
  list: vi.fn(),
  rpc: vi.fn(),
}))

const searchState = vi.hoisted<{
  current: { from?: string; to?: string }
}>(() => ({
  current: { from: 'v-1', to: 'v-2' },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ datasetId: 'ds-1' }),
    useSearch: () => searchState.current,
    useRouteContext: () => ({ context: {} }),
    fullPath: '/datasets/$datasetId/compare',
    options: config,
  }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

const TOTAL = 250

const versions = [
  { id: 'v-2', label: 'S-15', createdAt: '2026-09-25T10:11:00.000Z' },
  { id: 'v-1', label: 'S-14', createdAt: '2026-09-24T16:04:00.000Z' },
]

function page(offset: number) {
  const size = Math.min(100, Math.max(TOTAL - offset, 0))
  return {
    versionA: 'v-1',
    versionB: 'v-2',
    offset,
    limit: 100,
    counts: { added: TOTAL, removed: 0, changed: 0, flags: 0 },
    columns: [],
    rows: Array.from({ length: size }, (_, i) => ({
      rowId: `row-${offset + i}`,
      kind: 'added' as const,
      fields: [],
      flagFields: [],
    })),
  }
}

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CompareRoute />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  searchState.current = { from: 'v-1', to: 'v-2' }
  dataClient.rpc.mockImplementation(
    (name: string, args: Record<string, unknown>) => {
      if (name === 'dataset_version_list') return Promise.resolve(versions)
      if (name === 'compare_dataset_versions') {
        return Promise.resolve(page(Number(args.p_offset ?? 0)))
      }
      return Promise.resolve([])
    },
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dataset compare route paging', () => {
  it('loads the first 100 changes and pages through the rest on demand', async () => {
    const user = userEvent.setup()
    renderRoute()

    const loadMore = await screen.findByRole('button', {
      name: /Load more/,
    })
    expect(loadMore.textContent).toContain('150 left')
    expect(dataClient.rpc).toHaveBeenCalledWith(
      'compare_dataset_versions',
      expect.objectContaining({ p_limit: 100, p_offset: 0 }),
    )

    await user.click(loadMore)
    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith(
        'compare_dataset_versions',
        expect.objectContaining({ p_limit: 100, p_offset: 100 }),
      ),
    )
    await screen.findByRole('button', { name: /50 left/ })

    await user.click(screen.getByRole('button', { name: /50 left/ }))
    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith(
        'compare_dataset_versions',
        expect.objectContaining({ p_limit: 100, p_offset: 200 }),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull(),
    )
  })

  it('shows no differences and no paging for identical snapshots', async () => {
    dataClient.rpc.mockImplementation((name: string) => {
      if (name === 'dataset_version_list') return Promise.resolve(versions)
      if (name === 'compare_dataset_versions') {
        return Promise.resolve({
          versionA: 'v-1',
          versionB: 'v-2',
          offset: 0,
          limit: 100,
          counts: { added: 0, removed: 0, changed: 0, flags: 0 },
          columns: [],
          rows: [],
        })
      }
      return Promise.resolve([])
    })
    renderRoute()

    await screen.findByText('No differences between these snapshots.')
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
  })

  it('does not report an empty comparison or zero counts before the diff loads', async () => {
    dataClient.rpc.mockImplementation((name: string) => {
      if (name === 'dataset_version_list') return Promise.resolve(versions)
      // Executor form: tsconfig lib predates Promise.withResolvers (ES2024).
      return new Promise(() => {})
    })
    renderRoute()

    await screen.findByText('Loading the comparison…')
    expect(
      screen.queryByText('No differences between these snapshots.'),
    ).toBeNull()
    // The five change counters must not claim a measured zero before the
    // server has answered.
    expect(screen.queryAllByText('—')).toHaveLength(5)
  })

  it('compares two different snapshots when the URL asks for the same one twice', async () => {
    searchState.current = { from: 'v-2', to: 'v-2' }
    renderRoute()

    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith(
        'compare_dataset_versions',
        expect.objectContaining({ p_version_a: 'v-1', p_version_b: 'v-2' }),
      ),
    )
    // Each side excludes the other, so the same snapshot cannot be chosen twice.
    const toSelect = screen.getByLabelText<HTMLSelectElement>('To snapshot')
    expect([...toSelect.options].map((option) => option.value)).not.toContain(
      'v-1',
    )
    const fromSelect = screen.getByLabelText<HTMLSelectElement>('From snapshot')
    expect([...fromSelect.options].map((option) => option.value)).not.toContain(
      'v-2',
    )
  })
})
