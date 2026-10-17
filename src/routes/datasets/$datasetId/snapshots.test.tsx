/**
 * DSET-03.3 — the dataset Snapshots tab. Verifies the manual "Create snapshot"
 * action (writer-only, label, success toast and RPC refusal toast) and the
 * complete snapshot inspector with its compare link.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './snapshots'
import type { SnapshotVersion } from '#/components/v3/datasets/snapshot-data'

const SnapshotsRoute = Route.options.component as React.ComponentType

const dataClient = vi.hoisted(() => ({
  list: vi.fn(),
  rpc: vi.fn(),
}))
const product = vi.hoisted(() => ({ snapshotDataset: vi.fn() }))
const explorer = vi.hoisted(() => ({ keepDatasetVersion: vi.fn() }))
const sonner = vi.hoisted(() => ({ toast: vi.fn() }))
const routeContext = vi.hoisted(() => ({
  value: {
    workspace: { id: 'ws-1', name: 'Process Development', role: 'member' },
    user: { name: 'Gareth P.', email: 'gareth@example.com' },
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
    useRouteContext: () => ({ context: routeContext.value }),
    options: config,
  }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [k, v] of Object.entries(params))
        href = href.replace(`$${k}`, encodeURIComponent(String(v)))
    }
    if (search) {
      const qs = new URLSearchParams(
        Object.entries(search)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
      if (qs) href += `?${qs}`
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

vi.mock('#/lib/dataset-product', async (importOriginal) => ({
  ...(await importOriginal()),
  snapshotDataset: product.snapshotDataset,
}))

vi.mock('#/lib/dataset-explorer-data', async (importOriginal) => ({
  ...(await importOriginal()),
  keepDatasetVersion: explorer.keepDatasetVersion,
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: sonner.toast,
  Toaster: () => null,
}))

function version(overrides: Partial<SnapshotVersion>): SnapshotVersion {
  return {
    id: 'v-2',
    label: 'S-15',
    createdAt: '2026-09-25T10:11:00.000Z',
    createdByUserId: 'u-1',
    createdByCredentialId: null,
    createdByName: 'Gareth P.',
    sourceDatasetRevision: 12,
    rowCount: 96,
    contentHash: 'sha256:abc123',
    rowsRemovedAt: null,
    change: null,
    retention: {
      reason: 'cited_by_signed_record',
      keptUntil: '2041-09-25T00:00:00.000Z',
      policy: { citedYears: 15, uncitedYears: 2 },
    },
    source: {
      kind: 'manual',
      runId: null,
      definitionName: null,
      triggerKind: null,
      status: null,
      label: null,
      startedAt: null,
    },
    citedBy: {
      signedRevisions: [
        {
          revisionId: '11111111-1111-1111-1111-111111111111',
          signedAt: '2026-09-25T12:00:00.000Z',
          signerUserId: 'u-2',
        },
      ],
      pipelineRuns: [],
      analyses: [],
    },
    ...overrides,
  }
}

const versions = [
  version({ id: 'v-2', label: 'S-15' }),
  version({
    id: 'v-1',
    label: 'S-14',
    createdAt: '2026-09-24T16:04:00.000Z',
    sourceDatasetRevision: 11,
    rowCount: 88,
    retention: { reason: 'kept', keptUntil: '2038-01-01T00:00:00.000Z' },
    citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
  }),
]

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SnapshotsRoute />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  routeContext.value = {
    workspace: { id: 'ws-1', name: 'Process Development', role: 'member' },
    user: { name: 'Gareth P.', email: 'gareth@example.com' },
  }
  dataClient.rpc.mockResolvedValue(versions)
  dataClient.list.mockResolvedValue([
    { id: 'ds-1', revision: 12, lifecycle: 'active' },
  ])
  product.snapshotDataset.mockResolvedValue({
    id: 'v-3',
    label: 'Gareth P. · saved by hand',
  })
  explorer.keepDatasetVersion.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dataset snapshots route', () => {
  it('creates a manual snapshot with the entered label and reports success', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('S-15')
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }))

    const dialog = await screen.findByRole('dialog')
    const label = within(dialog).getByRole('textbox')
    await user.clear(label)
    await user.type(label, 'Gareth P. · before cleaning')
    await user.click(
      within(dialog).getByRole('button', { name: 'Save snapshot' }),
    )

    await waitFor(() =>
      expect(product.snapshotDataset).toHaveBeenCalledWith(
        dataClient,
        expect.objectContaining({
          datasetId: 'ds-1',
          expectedRevision: 12,
          label: 'Gareth P. · before cleaning',
        }),
      ),
    )
    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith(
        expect.stringContaining('Gareth P. · saved by hand'),
      ),
    )
    // One confirmed save writes one snapshot and closes the dialog; a second
    // click is only possible once it is reopened deliberately.
    expect(product.snapshotDataset).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('surfaces an RPC refusal as a toast without crashing the tab', async () => {
    product.snapshotDataset.mockRejectedValueOnce({
      code: 'SB001',
      message: 'stale Dataset revision',
    })
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('S-15')
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Save snapshot' }))

    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith('Could not save the snapshot', {
        description: 'This dataset changed elsewhere. Refresh and try again.',
      }),
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('disables snapshot creation for a non-writer', async () => {
    routeContext.value = {
      workspace: { id: 'ws-1', name: 'Process Development', role: 'viewer' },
      user: { name: 'Gareth P.', email: 'gareth@example.com' },
    }
    renderRoute()

    await screen.findByText('S-15')
    const button = screen.getByRole('button', { name: 'Create snapshot' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByText(/You have read access to this dataset/),
    ).toBeTruthy()
  })

  it('blames a failed revision read, not the archive state', async () => {
    dataClient.list.mockRejectedValueOnce(new Error('offline'))
    renderRoute()

    await screen.findByText(/current revision could not be read/)
    expect(
      screen.queryByText(/Archived datasets cannot be snapshotted/),
    ).toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create snapshot',
      }).disabled,
    ).toBe(true)
  })

  it('shows the selected snapshot read model and a compare link to both versions', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('S-15')
    // Default selection is the newest snapshot (S-15).
    expect(screen.getByText('sha256:abc123')).toBeTruthy()
    expect(screen.getByText(/Signed record 11111111/)).toBeTruthy()
    expect(screen.getByText('Saved by hand')).toBeTruthy()

    await user.click(screen.getAllByText('S-14')[0])

    const compare = screen.getAllByRole('link', {
      name: 'Compare snapshots',
    })[0]
    expect(compare.getAttribute('href')).toBe(
      '/datasets/ds-1/compare?from=v-1&to=v-2',
    )
  })

  it('warns before removal and keeps a prunable snapshot with a reason', async () => {
    const user = userEvent.setup()
    dataClient.rpc.mockResolvedValue([
      version({
        id: 'v-9',
        label: 'S-5',
        rowCount: 40,
        retention: {
          reason: 'uncited_after_archive',
          keptUntil: '2027-10-03T00:00:00.000Z',
          policy: { citedYears: 15, uncitedYears: 2 },
        },
        citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
      }),
    ])
    renderRoute()

    await screen.findByText('S-5')
    expect(
      screen.getByText('S-5 is due for row removal on 2027-10-03.'),
    ).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'Keep S-5' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByRole('textbox'),
      'Still needed for the 2027 review',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Keep snapshot' }),
    )

    await waitFor(() =>
      expect(explorer.keepDatasetVersion).toHaveBeenCalledWith(
        dataClient,
        'v-9',
        'Still needed for the 2027 review',
      ),
    )
    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith(
        'Snapshot S-5 kept',
        expect.objectContaining({
          description: expect.stringContaining('not be removed by retention'),
        }),
      ),
    )
  })

  it('does not offer Keep to a non-writer but still shows the warning', async () => {
    routeContext.value = {
      workspace: { id: 'ws-1', name: 'Process Development', role: 'viewer' },
      user: { name: 'Gareth P.', email: 'gareth@example.com' },
    }
    dataClient.rpc.mockResolvedValue([
      version({
        id: 'v-9',
        label: 'S-5',
        rowCount: 40,
        retention: {
          reason: 'uncited_after_archive',
          keptUntil: '2027-10-03T00:00:00.000Z',
          policy: { citedYears: 15, uncitedYears: 2 },
        },
        citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
      }),
    ])
    renderRoute()

    await screen.findByText('S-5')
    expect(
      screen.getByText('S-5 is due for row removal on 2027-10-03.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Keep S-5' })).toBeNull()
  })

  it('reports a tombstoned snapshot clearly instead of an empty view', async () => {
    dataClient.rpc.mockResolvedValue([
      version({
        id: 'v-3',
        label: 'S-3',
        rowCount: 0,
        rowsRemovedAt: '2026-09-12T00:00:00.000Z',
        retention: {
          reason: 'uncited_after_archive',
          keptUntil: '2026-01-01T00:00:00.000Z',
          policy: { citedYears: 15, uncitedYears: 2 },
        },
        citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
      }),
    ])
    renderRoute()

    await screen.findByText('S-3')
    expect(screen.getAllByText('Rows removed').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/Links and citations still open this page/),
    ).toBeTruthy()
    expect(screen.getByText(/nothing left to compare/)).toBeTruthy()
    // The warning banner targets the prunable snapshot, not the tombstone.
    expect(screen.queryByText(/due for row removal/)).toBeNull()
  })
})
