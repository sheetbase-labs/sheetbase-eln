/**
 * DSET-03.3 — the dataset Snapshots tab. Verifies the manual "Create snapshot"
 * action (writer-only, label, success toast and RPC refusal toast) and the
 * complete snapshot inspector with its compare link.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
const sonner = vi.hoisted(() => ({ toast: vi.fn() }))
const routeContext = vi.hoisted(() => ({
  value: {
    workspace: { id: 'ws-1', name: 'Process Development', role: 'member' },
    user: { name: 'Gareth P.', email: 'gareth@example.com' },
  },
}))

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
    await user.click(within(dialog).getByRole('button', { name: 'Save snapshot' }))

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
    await user.click(
      screen.getByRole('button', { name: 'Save snapshot' }),
    )

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
})
