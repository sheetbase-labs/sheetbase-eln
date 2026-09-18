import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminApiCredentials } from './admin-api-credentials'
import type { CredentialWire } from '#/lib/api-credential-admin'

// jsdom does not implement ResizeObserver; Radix Checkbox reads it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({
    names: { 'cred-owner': 'Cred Owner' },
    userLabel: (id: string) =>
      id === 'cred-owner' ? 'Cred Owner' : id.slice(0, 8),
  }),
}))

afterEach(cleanup)

const sample: CredentialWire = {
  id: 'cred-1',
  workspaceId: 'ws-1',
  kind: 'service',
  displayPrefix: 'abcd1234',
  name: 'CI pipeline',
  scopes: ['projects:read'],
  createdAt: '2026-08-01T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdByUserId: 'cred-owner',
}

describe('AdminApiCredentials', () => {
  it('does not offer scientific:* scopes and creates with the selected product scopes', async () => {
    const onCreate = vi.fn()
    render(
      <AdminApiCredentials
        credentials={[sample]}
        isOwner
        revealed={null}
        onCreate={onCreate}
        onRevoke={vi.fn()}
        onRotate={vi.fn()}
        onDismissRevealed={vi.fn()}
      />,
    )
    expect(screen.queryByText('scientific:read')).toBeNull()
    await userEvent.type(screen.getByLabelText('Name'), 'Nightly export')
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'datasets:read' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Create credential' }),
    )
    expect(onCreate).toHaveBeenCalledWith(
      'Nightly export',
      ['projects:read', 'datasets:read'],
      null,
    )
  })

  it('hides the create form from non-owners and disables mutations', () => {
    render(
      <AdminApiCredentials
        credentials={[sample]}
        isOwner={false}
        revealed={null}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
        onRotate={vi.fn()}
        onDismissRevealed={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Create credential' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Revoke' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('shows the secret exactly once after creation', () => {
    render(
      <AdminApiCredentials
        credentials={[sample]}
        isOwner
        revealed={{
          id: 'new',
          secret: 'sb_ffffffff_0123456789abcdef0123456789abcdef',
          displayPrefix: 'ffffffff',
          name: 'Nightly export',
          scopes: ['projects:read'],
        }}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
        onRotate={vi.fn()}
        onDismissRevealed={vi.fn()}
      />,
    )
    expect(
      screen.getByText('sb_ffffffff_0123456789abcdef0123456789abcdef'),
    ).toBeTruthy()
  })
})
