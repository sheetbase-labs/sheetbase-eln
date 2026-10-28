import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceCertification } from '#/lib/signature-certification'
import { Route } from './signatures'

const mocks = vi.hoisted(() => ({
  certifications: [] as WorkspaceCertification[],
  members: [] as { userId: string; role: string; suspendedAt: string | null }[],
  role: 'owner',
  verify: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'me', name: 'Ada Lovelace', email: 'ada@sheetbase.test' },
        workspace: { id: 'ws', name: 'Test workspace', role: mocks.role },
      },
    }),
  }),
}))
vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: async () => mocks.certifications,
  verifySignatureIdentity: (...args: unknown[]) => mocks.verify(...args),
}))
vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceMembers: async () => mocks.members,
  fetchWorkspaceSettings: async () => ({
    signaturePolicy: { reauth: 'batch' },
  }),
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))

function certification(
  userId: string,
  name: string,
  overrides: Partial<WorkspaceCertification> = {},
): WorkspaceCertification {
  return {
    userId,
    name,
    statementVersion: null,
    certifiedAt: null,
    revokedAt: null,
    identityVerifiedAt: null,
    identityVerifiedBy: null,
    verifiedEmail: null,
    verificationRequested: false,
    authMethod: null,
    ...overrides,
  }
}
function member(
  userId: string,
  role: string,
  suspendedAt: string | null = null,
) {
  return { userId, role, suspendedAt }
}
function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Signatures route component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.role = 'owner'
  mocks.certifications = [certification('me', 'Ada Lovelace')]
  mocks.members = [member('me', 'owner')]
  mocks.verify.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('electronic signature policy', () => {
  it('points to the person’s own signature rather than hosting it', async () => {
    renderRoute()
    expect(
      (await screen.findByRole('link', { name: 'My signature' })).getAttribute(
        'href',
      ),
    ).toBe('/settings/my-signature')
    expect(screen.queryByText('Certify signature')).toBeNull()
  })

  it('requires a deliberate independent email assertion from a different administrator', async () => {
    const user = userEvent.setup()
    mocks.role = 'admin'
    mocks.certifications = [
      certification('me', 'Ada Lovelace'),
      certification('other', 'Other Member', { verificationRequested: true }),
    ]
    mocks.members = [member('me', 'admin'), member('other', 'member')]
    renderRoute()
    await user.click(
      await screen.findByText('Verify Other Member independently'),
    )
    await user.type(
      screen.getByLabelText('Independently verified email'),
      'other@sheetbase.test',
    )
    expect(
      screen.getByRole('button', { name: 'Confirm verified identity' }),
    ).toHaveProperty('disabled', true)
    await user.click(
      screen.getByRole('checkbox', { name: /I have independently confirmed/ }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm verified identity' }),
    )
    await waitFor(() =>
      expect(mocks.verify).toHaveBeenCalledWith(
        expect.anything(),
        'other',
        'other@sheetbase.test',
      ),
    )
  })

  it('lists only people who can sign as missing a certified signature', async () => {
    mocks.certifications = [
      certification('me', 'Ada Lovelace'),
      certification('sci', 'Scientist Sam'),
      certification('view', 'Viewer Vic'),
      certification('client', 'Client Cy'),
      certification('gone', 'Suspended Sue'),
    ]
    mocks.members = [
      member('me', 'owner'),
      member('sci', 'scientist'),
      member('view', 'viewer'),
      member('client', 'client_viewer'),
      member('gone', 'member', '2026-10-01T00:00:00Z'),
    ]
    renderRoute()
    await screen.findByText('Scientist Sam')
    expect(screen.queryByText('Viewer Vic')).toBeNull()
    expect(screen.queryByText('Client Cy')).toBeNull()
    expect(screen.queryByText('Suspended Sue')).toBeNull()
  })
})
