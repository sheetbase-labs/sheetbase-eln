import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { Route } from './members'

const { suspendMock, routeRef } = vi.hoisted(() => ({
  suspendMock: vi.fn(),
  routeRef: {
    role: 'viewer',
    members: null as null | unknown[],
    gate: null as null | Promise<void>,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'viewer', name: 'Reader', email: 'reader@sheetbase.test' },
        workspace: { id: 'ws', name: 'Workspace', role: routeRef.role },
      },
    }),
  }),
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))
vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  suspendMember: (...args: unknown[]) => suspendMock(...args),
  fetchWorkspaceMembers: async () => {
    if (routeRef.gate) await routeRef.gate
    if (routeRef.members) return routeRef.members
    return ['current', 'old', 'revoked'].map((userId) => ({
      id: userId,
      userId,
      role: 'scientist',
      suspendedAt: null,
      createdAt: '2026-09-01T00:00:00Z',
    }))
  },
  fetchInvitations: async () => [],
  fetchClients: async () => [],
}))
vi.mock('#/lib/workspace-access', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceGroups: async () => [
    { id: 'group', name: 'Upstream', member_ids: ['old'] },
  ],
  fetchWorkspaceMemberStatus: async () =>
    ['current', 'old', 'revoked'].map((user_id) => ({
      user_id,
      last_active_at: user_id === 'old' ? null : '2026-09-25T09:40:00Z',
      training_required: user_id === 'old' ? 2 : 0,
      training_overdue: user_id === 'revoked' ? 1 : 0,
    })),
}))
vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: async () =>
    ['current', 'old', 'revoked'].map((userId) => ({
      userId,
      name: userId,
      statementVersion: userId === 'old' ? 0 : 1,
      certifiedAt: '2026-09-01T00:00:00Z',
      identityVerifiedAt: '2026-09-01T00:00:00Z',
      authMethod: 'password',
      verificationRequested: false,
      revokedAt: userId === 'revoked' ? '2026-09-02T00:00:00Z' : null,
    })),
}))

afterEach(cleanup)

beforeEach(() => {
  routeRef.role = 'viewer'
  routeRef.members = null
  routeRef.gate = null
  suspendMock.mockReset()
  suspendMock.mockResolvedValue(undefined)
})

function renderMembers() {
  const Component = Route.options.component
  if (!Component) throw new Error('Members component required')
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

describe('SET-02 members status', () => {
  it('shows current-statement certification, explicit groups and real training separately', async () => {
    renderMembers()
    const current = (await screen.findByText('current')).closest('tr')
    const old = (await screen.findByText('old')).closest('tr')
    const revoked = (await screen.findByText('revoked')).closest('tr')
    if (!current || !old || !revoked) throw new Error('Member rows required')
    expect(await within(current).findByText('Certified')).toBeTruthy()
    expect(within(old).queryByText('Certified')).toBeNull()
    expect(
      await within(old).findByText('Identity verified / not certified'),
    ).toBeTruthy()
    expect(await within(old).findByText('Upstream')).toBeTruthy()
    expect(await within(old).findByText('2 to read')).toBeTruthy()
    expect(await within(revoked).findByText('Revoked')).toBeTruthy()
    expect(await within(revoked).findByText('1 overdue')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull()
  })

  it('keeps a body state in the members table while the members load', async () => {
    let release: () => void = () => {}
    routeRef.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    renderMembers()

    const table = screen.getByRole('table', { name: 'Members' })
    // The header row plus the primitive's state row: never a bare header.
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(screen.queryByText('No members')).toBeNull()

    release()
    expect(await screen.findByText('current')).toBeTruthy()
  })

  it('states the empty members copy once the load returns no members', async () => {
    routeRef.members = []
    renderMembers()

    expect(await screen.findByText('No members')).toBeTruthy()
    expect(
      screen.getByText('Invite people to work in this workspace.'),
    ).toBeTruthy()
  })

  it('confirms before suspending, so a dropdown choice cannot end access alone', async () => {
    const user = userEvent.setup()
    // `workspace.admin` is owner-only in the capability map, so the row
    // management menu is only offered to an owner.
    routeRef.role = 'owner'
    renderMembers()

    await user.click(await screen.findByRole('button', { name: 'Manage old' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }))
    expect(suspendMock).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    await waitFor(() =>
      expect(suspendMock).toHaveBeenCalledWith(expect.anything(), {
        workspaceId: 'ws',
        userId: 'old',
      }),
    )
  })
})
