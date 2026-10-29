import { choose } from '../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './access'

/**
 * SET-02.3 — the access-request audit surface. Approvals must be attributable:
 * a decided request shows who decided it and when, a pending one the reader
 * cannot decide reads as waiting (never granted), and the decision travels
 * through the canonical RPC.
 */
const { decideMock, setDefaultMock } = vi.hoisted(() => ({
  decideMock: vi.fn(),
  setDefaultMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'reader', name: 'Reader' },
        workspace: { id: 'ws', name: 'Workspace', role: 'admin' },
      },
    }),
  }),
}))

vi.mock('#/components/v3/settings/data-access-roles', () => ({
  DataAccessRoles: () => null,
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({
    userLabel: (id: string) =>
      ({
        scientist: 'Ada Lovelace',
        reader: 'Reader',
        lead: 'Grace Hopper',
      })[id] ?? id,
  }),
}))

vi.mock('#/components/v3/projects/project-data', () => ({
  fetchWorkspaceMemberIdentities: async () => [
    { user_id: 'scientist', name: 'Ada Lovelace', role: 'scientist' },
    { user_id: 'lead', name: 'Grace Hopper', role: 'steward' },
  ],
  fetchProjectSummaries: async () => [
    { id: 'p1', title: 'Virus Stability' },
    { id: 'p2', title: 'Water Quality' },
  ],
}))

vi.mock('#/lib/workspace-access', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceAccessRules: async () => [],
  fetchWorkspaceGroups: async () => [
    { id: '00000000-0000-4000-8000-0000000000aa', name: 'QA', member_ids: [] },
  ],
  fetchProjectAccessDefaults: async () => ({
    private_to_lead: true,
    qa_view_group_id: null,
    client_portal_off: true,
  }),
  setProjectAccessDefaults: setDefaultMock,
  fetchMyProjectPermissions: async () =>
    new Map(
      ['p1', 'p2'].map((projectId) => [
        projectId,
        {
          can_view: true,
          can_edit: projectId === 'p1',
          can_review: false,
          client_portal: false,
          can_manage: projectId === 'p1',
        },
      ]),
    ),
  fetchProjectAccessRequests: async () => [
    {
      id: '00000000-0000-4000-8000-000000000001',
      project_id: 'p1',
      user_id: 'scientist',
      reason: 'QA verification of the turbidity repeat',
      status: 'pending',
      created_at: '2026-09-20T09:00:00Z',
      updated_at: '2026-09-20T09:00:00Z',
      decided_by_user_id: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      project_id: 'p2',
      user_id: 'reader',
      reason: 'Attach the calibration certificate',
      status: 'pending',
      created_at: '2026-09-20T09:05:00Z',
      updated_at: '2026-09-20T09:05:00Z',
      decided_by_user_id: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      project_id: 'p1',
      user_id: 'scientist',
      reason: 'Upstream process assessment',
      status: 'approved',
      created_at: '2026-09-19T09:00:00Z',
      updated_at: '2026-09-21T10:30:00Z',
      decided_by_user_id: 'lead',
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      project_id: 'p1',
      user_id: 'reader',
      reason: 'Read the protocol',
      status: 'denied',
      created_at: '2026-09-18T09:00:00Z',
      updated_at: '2026-09-21T11:00:00Z',
      decided_by_user_id: 'lead',
    },
  ],
  decideProjectAccessRequest: decideMock,
}))

afterEach(() => {
  cleanup()
  decideMock.mockReset()
  setDefaultMock.mockReset()
})

function renderAccess() {
  const Component = Route.options.component
  if (!Component) throw new Error('Access component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

async function rowFor(reason: string): Promise<HTMLElement> {
  const cell = await screen.findByText(reason)
  const row = cell.closest('tr')
  if (!row) throw new Error(`Row for ${reason} required`)
  return row
}

describe('SET-02.3 access requests audit', () => {
  it('shows who decided an approved request and when', async () => {
    renderAccess()
    const approved = await rowFor('Upstream process assessment')
    expect(
      await within(approved).findByText(/Approved by Grace Hopper · \d/),
    ).toBeTruthy()
  })

  it('shows the decider and outcome of a refused request', async () => {
    renderAccess()
    const denied = await rowFor('Read the protocol')
    expect(
      await within(denied).findByText(/Denied by Grace Hopper · \d/),
    ).toBeTruthy()
  })

  it('reads a pending request the reader cannot decide as waiting, not granted', async () => {
    renderAccess()
    const pending = await rowFor('Attach the calibration certificate')
    expect(
      await within(pending).findByText('Waiting for approval'),
    ).toBeTruthy()
    expect(
      within(pending).queryByRole('button', { name: 'Approve edit access' }),
    ).toBeNull()
  })

  it('decides a pending request through the canonical RPC', async () => {
    const user = userEvent.setup()
    renderAccess()
    const pending = await rowFor('QA verification of the turbidity repeat')
    await user.click(
      await within(pending).findByRole('button', {
        name: 'Approve edit access',
      }),
    )
    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith(expect.anything(), {
        requestId: '00000000-0000-4000-8000-000000000001',
        approve: true,
      }),
    )
  })
})

describe('QA access default for new projects', () => {
  it('saves the chosen group as the default through the canonical RPC', async () => {
    const user = userEvent.setup()
    renderAccess()
    await choose(user, 'QA group with view access', /QA/)
    await waitFor(() =>
      expect(setDefaultMock).toHaveBeenCalledWith(
        expect.anything(),
        '00000000-0000-4000-8000-0000000000aa',
      ),
    )
  })

  it('says the default is view-only and leaves existing projects alone', async () => {
    renderAccess()
    expect(
      await screen.findByText(/can’t edit, review or manage/),
    ).toBeTruthy()
  })
})
