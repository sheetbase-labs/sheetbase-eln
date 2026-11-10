import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'
import type { WorkspaceCertification } from '#/lib/signature-certification'
import type { WorkspaceMember } from '#/lib/workspace-admin'

const certifications: WorkspaceCertification[] = []

const members: Array<Pick<WorkspaceMember, 'userId' | 'role' | 'suspendedAt'>> =
  []

const state = {
  certifications,
  members,
  role: 'owner',
}

const verificationSchema = z.object({
  p_user_id: z.string(),
  p_email: z.string(),
})

const verifications: Array<z.infer<typeof verificationSchema>> = []

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/workspace_signature_certifications'))
    return Response.json(
      state.certifications.map((c) => ({
        user_id: c.userId,
        name: c.name,
        statement_version: c.statementVersion,
        certified_at: c.certifiedAt,
        revoked_at: c.revokedAt,
        identity_verified_at: c.identityVerifiedAt,
        identity_verified_by: c.identityVerifiedBy,
        verified_email: c.verifiedEmail,
        verification_requested: c.verificationRequested,
        auth_method: c.authMethod,
      })),
    )

  if (url.pathname.endsWith('/workspace_memberships'))
    return Response.json(
      state.members.map((m) => ({
        id: 'membership-' + m.userId,
        workspace_id: 'ws',
        user_id: m.userId,
        role: m.role,
        suspended_at: m.suspendedAt,
        client_id: null,
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:00:00Z',
      })),
    )

  if (url.pathname.endsWith('/verify_signature_identity')) {
    verifications.push(
      verificationSchema.parse(await new Response(init?.body).json()),
    )

    return Response.json(null)
  }

  return Response.json([])
})

const { Route } = await import('./signatures')
const { dropSharedReads } = await import('#/lib/data-client')

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
  role: WorkspaceMember['role'],
  suspendedAt: string | null = null,
) {
  return { userId, role, suspendedAt }
}

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Signatures route component required')

  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        user: { id: 'me', name: 'Ada Lovelace', email: 'ada@sheetbase.test' },
        workspace: { id: 'ws', name: 'Test workspace', role: state.role },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/workspace/signatures',
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/settings/workspace/signatures'],
    }),
  })

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
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  state.role = 'owner'
  state.certifications = [certification('me', 'Ada Lovelace')]
  state.members = [member('me', 'owner')]
  verifications.length = 0
})

afterEach(() => {
  cleanup()
  dropSharedReads()
})

afterAll(() => vi.unstubAllGlobals())

describe('electronic signature policy', () => {
  it('points to the person’s own signature rather than hosting it', async () => {
    renderRoute()
    expect(
      (await screen.findByRole('link', { name: 'My signature' })).getAttribute(
        'href',
      ),
    ).toBe('/settings/account/signature')
    expect(screen.queryByText('Certify signature')).toBeNull()
  })

  it('requires a deliberate independent email assertion from a different administrator', async () => {
    const user = userEvent.setup()
    state.role = 'admin'
    state.certifications = [
      certification('me', 'Ada Lovelace'),
      certification('other', 'Other Member', { verificationRequested: true }),
    ]
    state.members = [member('me', 'admin'), member('other', 'member')]
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
      expect(verifications).toEqual([
        { p_user_id: 'other', p_email: 'other@sheetbase.test' },
      ]),
    )
  })

  it('lists only people who can sign as missing a certified signature', async () => {
    state.certifications = [
      certification('me', 'Ada Lovelace'),
      certification('sci', 'Scientist Sam'),
      certification('view', 'Viewer Vic'),
      certification('client', 'Client Cy'),
      certification('gone', 'Suspended Sue'),
    ]
    state.members = [
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
