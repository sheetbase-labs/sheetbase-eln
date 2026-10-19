import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { ProtocolVersionsPanel } from './protocol-versions-panel'

const mocks = vi.hoisted(() => ({
  fetchProtocolVersions: vi.fn(),
  submitProtocolRevision: vi.fn(),
  approveProtocolRevision: vi.fn(),
  makeProtocolVersionEffective: vi.fn(),
  index: {
    data: undefined as object | undefined,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('#/lib/controlled-protocols', () => ({
  PROTOCOL_REVISION_KIND: 'protocol_revision',
  fetchProtocolVersions: (...args: unknown[]) =>
    mocks.fetchProtocolVersions(...args),
}))

vi.mock('#/lib/protocol-revisions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  submitProtocolRevision: (...args: unknown[]) =>
    mocks.submitProtocolRevision(...args),
  approveProtocolRevision: (...args: unknown[]) =>
    mocks.approveProtocolRevision(...args),
  makeProtocolVersionEffective: (...args: unknown[]) =>
    mocks.makeProtocolVersionEffective(...args),
}))

vi.mock('#/components/v3/models/model-approval-data', () => ({
  useModelApprovalIndex: () => ({ data: mocks.index.data }),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  formatNotebookDateTime: (iso: string) => iso.slice(0, 10),
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const WS = '00000000-0000-4000-8000-000000000001'
const RECORD = '00000000-0000-4000-8000-000000000002'
const V2 = '00000000-0000-4000-8000-000000000012'
const V1 = '00000000-0000-4000-8000-000000000011'
const REQ = '00000000-0000-4000-8000-000000000099'

function version(over: Partial<ProtocolVersion>): ProtocolVersion {
  return {
    id: V1,
    workspace_id: WS,
    protocol_record_id: RECORD,
    version: 1,
    status: 'effective',
    effective_at: '2026-09-02T00:00:00+00:00',
    review_due_at: null,
    change_summary: 'First issue.',
    created_by_user_id: 'sam',
    created_at: '2026-08-28T00:00:00+00:00',
    ...over,
  }
}

function pendingIndex(decisions: { role: string }[] = []) {
  const request = {
    id: REQ,
    object_id: V2,
    state: 'pending',
    required_approver_roles: [
      'admin',
      'owner',
      'reviewer',
      'scientist',
      'steward',
    ],
    approved_by_user_ids: [],
    require_independence: true,
    submitted_by_user_id: 'sam',
    submitted_at: '2026-09-01T00:00:00+00:00',
  }
  const rows = decisions.map((d, i) => ({
    id: `d${i}`,
    request_id: REQ,
    decision: 'approved',
    role: d.role,
    user_id: `u${i}`,
  }))
  return {
    data: {
      requests: [request],
      decisions: rows,
      byVersion: new Map([[V2, [request]]]),
      byRequest: new Map([[REQ, rows]]),
    },
  }
}

afterEach(cleanup)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.index.data = undefined
  mocks.fetchProtocolVersions.mockResolvedValue([
    version({ id: V1, version: 1 }),
  ])
})

function renderPanel(role: string, userId = 'me') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProtocolVersionsPanel
        protocolRecordId={RECORD}
        workspaceId={WS}
        role={role}
        user={{ id: userId, name: 'Me' }}
      />
    </QueryClientProvider>,
  )
}

describe('ProtocolVersionsPanel', () => {
  it('offers Start experiment on the effective version', async () => {
    renderPanel('scientist')
    expect(await screen.findByText('v1 is the effective version.')).toBeTruthy()
    const start = screen.getAllByRole('link', { name: 'Start experiment' })
    expect(start.length).toBeGreaterThan(0)
  })

  it('submits the current text as a new version with the change summary', async () => {
    const user = userEvent.setup()
    mocks.submitProtocolRevision.mockResolvedValue({
      versionId: V2,
      request: {},
    })
    renderPanel('scientist')
    await user.click(
      await screen.findByRole('button', {
        name: 'Submit the current text as a new version',
      }),
    )
    await user.type(
      await screen.findByLabelText(/What changed/),
      'Tighter hold',
    )
    await user.click(
      screen.getByRole('button', { name: 'Submit for approval' }),
    )
    await waitFor(() =>
      expect(mocks.submitProtocolRevision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workspaceId: WS,
          protocolRecordId: RECORD,
          changeSummary: 'Tighter hold',
        }),
      ),
    )
  })

  it('hides the submit action from a viewer', async () => {
    renderPanel('viewer')
    await screen.findByText('v1 is the effective version.')
    expect(
      screen.queryByRole('button', {
        name: 'Submit the current text as a new version',
      }),
    ).toBeNull()
  })

  it('gives technical reviewers the Approve action first, QA only after', async () => {
    mocks.fetchProtocolVersions.mockResolvedValue([
      version({ id: V2, version: 2, status: 'in_review', effective_at: null }),
      version({ id: V1, version: 1 }),
    ])
    mocks.index.data = pendingIndex().data
    const first = renderPanel('reviewer')
    await screen.findByText(/Waiting for technical review/)
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    first.unmount()

    renderPanel('steward')
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('lets QA approve and release once technical review is done', async () => {
    mocks.fetchProtocolVersions.mockResolvedValue([
      version({ id: V2, version: 2, status: 'in_review', effective_at: null }),
    ])
    mocks.index.data = pendingIndex([{ role: 'steward' }]).data
    renderPanel('reviewer')
    expect(
      await screen.findByRole('button', { name: 'Approve and release' }),
    ).toBeTruthy()
    expect(
      screen.getByText(/Technical review done; waiting for QA/),
    ).toBeTruthy()
  })

  it('does not offer the author their own version to approve', async () => {
    mocks.fetchProtocolVersions.mockResolvedValue([
      version({ id: V2, version: 2, status: 'in_review', effective_at: null }),
    ])
    mocks.index.data = pendingIndex().data
    renderPanel('steward', 'sam')
    await screen.findByText(/Waiting for technical review/)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})
