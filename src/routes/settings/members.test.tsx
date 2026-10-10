import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './members'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'viewer', name: 'Reader', email: 'reader@sheetbase.test' },
        workspace: { id: 'ws', name: 'Workspace', role: 'viewer' },
      },
    }),
  }),
}))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))
vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceMembers: async () =>
    ['current', 'old', 'revoked'].map((userId) => ({
      id: userId,
      userId,
      role: 'scientist',
      suspendedAt: null,
      createdAt: '2026-09-01T00:00:00Z',
    })),
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

describe('SET-02 members status', () => {
  it('shows current-statement certification, explicit groups and real training separately', async () => {
    const Component = Route.options.component
    if (!Component) throw new Error('Members component required')
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Component />
      </QueryClientProvider>,
    )
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
})
