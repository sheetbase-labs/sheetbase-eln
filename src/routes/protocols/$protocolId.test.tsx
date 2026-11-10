import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$protocolId'

const mocks = vi.hoisted(() => ({
  fetchProtocolVersions: vi.fn(),
  fetchProtocolAcknowledgements: vi.fn(),
  fetchProtocolAcknowledgeWriter: vi.fn(),
  acknowledgeProtocolVersion: vi.fn(),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time; this suite renders the route's own component with the params, search and context the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <Options,>(options: Options) => ({
      options,
      fullPath: '/protocols/$protocolId',
      useParams: () => ({ protocolId: 'p-1' }),
      useSearch: () => ({ section: 'training' }),
      useRouteContext: () => ({ context: { user: { id: 'me' } } }),
    }),
  useNavigate: () => vi.fn(),
  redirect: <Input,>(options: Input) => options,
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The training roster is a heavy panel with its own suite; the protocol header is this suite's subject.
vi.mock('#/components/protocols/protocol-training-roster', () => ({
  ProtocolTrainingRoster: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The document panel renders the protocol body from its own reads; the protocol header is this suite's subject.
vi.mock('#/components/protocols/protocol-document', () => ({
  ProtocolDocument: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The page's reads run through module-level functions over the shared client with no injection point; this suite answers them with fixed versions.
vi.mock('#/lib/controlled-protocols', () => ({
  fetchProtocolVersions: (...args: unknown[]) =>
    mocks.fetchProtocolVersions(...args),
  fetchProtocolAcknowledgements: (...args: unknown[]) =>
    mocks.fetchProtocolAcknowledgements(...args),
  fetchProtocolAcknowledgeWriter: (...args: unknown[]) =>
    mocks.fetchProtocolAcknowledgeWriter(...args),
  acknowledgeProtocolVersion: (...args: unknown[]) =>
    mocks.acknowledgeProtocolVersion(...args),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The record read runs through the module-level notebook client; the protocol's own record is fixed here so the header renders without an /api/db round trip.
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: async () => [] },
  notebookQueryKeys: { record: (id: string) => ['record', id] },
  fetchRecord: async () => ({
    id: 'p-1',
    kind: 'protocol_template',
    title: 'Harvest clarification',
    identifier: 'PRO-1',
    status: 'effective',
    createdByUserId: 'sam',
    updatedAt: '2026-09-01T00:00:00Z',
  }),
  fetchBlocksForRecord: async () => [],
  fetchLinksForRecord: async () => [],
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Recent-view tracking posts to the server from an effect; a jsdom render has no server runtime and the header does not read it.
vi.mock('#/lib/recents', () => ({ useRecentViewTracking: () => undefined }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The toggle reads and writes favourites through the shared client; the protocol header is this suite's subject.
vi.mock('#/components/favourites/favourite-toggle', () => ({
  FavouriteToggle: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- User names come from a server function, which needs the request runtime a jsdom render has none of.
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Toasts are painted by the app shell's Toaster; this suite renders the page alone, so the toast calls are recorded and never painted.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

afterEach(cleanup)

const VERSION_ID = '00000000-0000-4000-8000-000000000003'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.fetchProtocolVersions.mockResolvedValue([
    {
      id: VERSION_ID,
      workspace_id: '00000000-0000-4000-8000-000000000001',
      protocol_record_id: '00000000-0000-4000-8000-000000000002',
      version: 3,
      status: 'effective',
      effective_at: '2026-09-02T00:00:00+00:00',
      review_due_at: null,
      change_summary: 'Hold parameters clarified.',
      created_by_user_id: 'sam',
      created_at: '2026-08-28T00:00:00+00:00',
    },
  ])
  mocks.fetchProtocolAcknowledgements.mockResolvedValue([])
  mocks.fetchProtocolAcknowledgeWriter.mockResolvedValue(true)
  mocks.acknowledgeProtocolVersion.mockResolvedValue({
    protocol_version_id: VERSION_ID,
    user_id: 'me',
    acknowledged_at: '2026-09-03T00:00:00+00:00',
  })
})

// SAFETY: A file route's options carry the component this suite renders; the
// factory mocked above stores exactly the options object its route declares.
const ProtocolPage = Route.options.component as React.ComponentType

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <ProtocolPage />
    </QueryClientProvider>,
  )
}

describe('protocol header', () => {
  it('offers a new experiment from the effective version', async () => {
    renderScreen()
    expect(await screen.findByText('New experiment from this')).toBeTruthy()
  })
})

describe('protocol training tab', () => {
  it('records acknowledgement against the frozen version, not the record', async () => {
    renderScreen()
    expect(await screen.findByText('Training on v3')).toBeTruthy()
    await waitFor(() =>
      expect(mocks.fetchProtocolAcknowledgements).toHaveBeenCalledWith(
        expect.anything(),
        VERSION_ID,
      ),
    )
    // The superseded record-level model is gone: no manual "Record training".
    expect(
      screen.queryByRole('button', { name: /record training/i }),
    ).toBeNull()
  })

  it('offers acknowledgement to a writer and records it against the exact version', async () => {
    const user = userEvent.setup()
    renderScreen()

    const button = await screen.findByRole('button', {
      name: 'Read and acknowledge',
    })

    expect(button.hasAttribute('disabled')).toBe(false)
    await user.click(button)
    await waitFor(() =>
      expect(mocks.acknowledgeProtocolVersion).toHaveBeenCalledWith(
        expect.anything(),
        VERSION_ID,
      ),
    )
  })

  it('does not offer acknowledgement to a viewer the server would refuse', async () => {
    mocks.fetchProtocolAcknowledgeWriter.mockResolvedValue(false)
    renderScreen()
    await waitFor(() =>
      expect(mocks.fetchProtocolAcknowledgeWriter).toHaveBeenCalledWith(
        expect.anything(),
        '00000000-0000-4000-8000-000000000001',
      ),
    )

    const button = await screen.findByRole('button', {
      name: 'Read and acknowledge',
    })

    expect(button.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByText(
        'Only a workspace writer can acknowledge a protocol version.',
      ),
    ).toBeTruthy()
    expect(mocks.acknowledgeProtocolVersion).not.toHaveBeenCalled()
  })

  it('explains the empty state when no version is frozen yet', async () => {
    mocks.fetchProtocolVersions.mockResolvedValue([])
    renderScreen()
    expect(await screen.findByText('No frozen versions yet')).toBeTruthy()
    expect(
      screen.getByText(/an experiment can only start from a version/),
    ).toBeTruthy()
  })

  it('lets the reader switch to another frozen version', async () => {
    const user = userEvent.setup()
    const olderId = '00000000-0000-4000-8000-000000000002'
    mocks.fetchProtocolVersions.mockResolvedValue([
      {
        id: VERSION_ID,
        workspace_id: '00000000-0000-4000-8000-000000000001',
        protocol_record_id: '00000000-0000-4000-8000-000000000002',
        version: 3,
        status: 'effective',
        effective_at: '2026-09-02T00:00:00+00:00',
        review_due_at: null,
        change_summary: 'Hold parameters clarified.',
        created_by_user_id: 'sam',
        created_at: '2026-08-28T00:00:00+00:00',
      },
      {
        id: olderId,
        workspace_id: '00000000-0000-4000-8000-000000000001',
        protocol_record_id: '00000000-0000-4000-8000-000000000002',
        version: 2,
        status: 'superseded',
        effective_at: null,
        review_due_at: null,
        change_summary: 'First issue.',
        created_by_user_id: 'sam',
        created_at: '2026-07-01T00:00:00+00:00',
      },
    ])
    renderScreen()

    const picker = await screen.findByRole('combobox', {
      name: 'Protocol version',
    })

    await user.selectOptions(picker, olderId)
    expect(await screen.findByText('Training on v2')).toBeTruthy()
    await waitFor(() =>
      expect(mocks.fetchProtocolAcknowledgements).toHaveBeenCalledWith(
        expect.anything(),
        olderId,
      ),
    )
  })
})
