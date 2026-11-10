import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
import type { WorkspaceMemberWire } from '#/lib/workspace-admin'
import type { EmailInvitationResult } from '#/lib/invitation-email'

const suspendMock = vi.fn()

const inviteMock =
  vi.fn<
    () => Promise<{ invitation: { id: string; email: string }; token: string }>
  >()

const emailMock = vi.fn<() => Promise<EmailInvitationResult>>()

interface MemberRouteFixture {
  role: string
  members: WorkspaceMemberWire[] | null
  gate: Promise<void> | null
  search: { invite?: string }
  workspaceId: string
  restrictedReads: string[]
}

const routeRef: MemberRouteFixture = {
  role: 'viewer',
  members: null,
  gate: null,
  search: {},
  workspaceId: 'ws',
  restrictedReads: [],
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  const resource = url.pathname.split('/').at(-1)
  routeRef.restrictedReads.push(url.pathname)

  switch (resource) {
    case 'workspace_memberships':
      if (routeRef.gate) await routeRef.gate

      return Response.json(
        routeRef.members ??
          ['current', 'old', 'revoked'].map((userId) => ({
            id: userId,
            user_id: userId,
            role: 'scientist',
            suspended_at: null,
            created_at: '2026-09-01T00:00:00Z',
          })),
      )
    case 'workspace_groups_list':
      return Response.json([
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Upstream',
          member_ids: ['old'],
        },
      ])
    case 'workspace_member_status':
      return Response.json(
        ['current', 'old', 'revoked'].map((user_id) => ({
          user_id,
          last_active_at: user_id === 'old' ? null : '2026-09-25T09:40:00Z',
          training_required: user_id === 'old' ? 2 : 0,
          training_overdue: user_id === 'revoked' ? 1 : 0,
        })),
      )
    case 'workspace_signature_certifications':
      return Response.json(
        ['current', 'old', 'revoked'].map((userId) => ({
          user_id: userId,
          name: userId,
          statement_version: userId === 'old' ? 0 : 1,
          certified_at: '2026-09-01T00:00:00Z',
          identity_verified_at: '2026-09-01T00:00:00Z',
          auth_method: 'password',
          verification_requested: false,
          revoked_at: userId === 'revoked' ? '2026-09-02T00:00:00Z' : null,
        })),
      )
    case 'suspend_member': {
      const body = z
        .object({ p_workspace_id: z.string(), p_user_id: z.string() })
        .parse(await new Response(init?.body).json())

      suspendMock(body)

      return Response.json({})
    }

    case 'create_invitation': {
      const result = await inviteMock()

      return Response.json({ ...result.invitation, token: result.token })
    }

    default:
      return Response.json([])
  }
})

const { Route, Members } = await import('./members')
const { dropSharedReads } = await import('#/lib/data-client')

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  dropSharedReads()
})

beforeEach(() => {
  routeRef.role = 'viewer'
  routeRef.members = null
  routeRef.gate = null
  routeRef.search = {}
  routeRef.workspaceId = 'ws'
  routeRef.restrictedReads = []
  suspendMock.mockReset()
  suspendMock.mockResolvedValue(undefined)
})

function renderMembers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(['user-names', ['current', 'old', 'revoked']], {
    current: 'current',
    old: 'old',
    revoked: 'revoked',
  })
  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/workspace/members',
    component: () => <Members sendInvitation={emailMock} />,
    validateSearch: Route.options.validateSearch,
    beforeLoad: () => ({
      context: {
        user: { id: 'viewer', name: 'Reader', email: 'reader@sheetbase.test' },
        workspace: {
          id: routeRef.workspaceId,
          name: 'Workspace',
          role: routeRef.role,
        },
      },
    }),
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [
        `/settings/workspace/members?${new URLSearchParams(routeRef.search)}`,
      ],
    }),
  })

  return {
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    router,
  }
}

describe('SET-02 members status', () => {
  it('refuses client accounts without restricted reads across role and workspace changes', async () => {
    routeRef.role = 'client_viewer'
    const view = renderMembers()

    expect(
      await screen.findByRole('button', { name: 'Open the client portal' }),
    ).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Members' })).toBeNull()
    expect(routeRef.restrictedReads).toEqual([])

    routeRef.role = 'owner'
    await act(() => view.router.invalidate())
    expect(await screen.findByText('current')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Invite people' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()

    routeRef.workspaceId = 'other-workspace'
    await act(() => view.router.invalidate())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('current')).toBeTruthy()

    routeRef.restrictedReads = []
    routeRef.role = 'client_viewer'
    await act(() => view.router.invalidate())
    expect(screen.queryByRole('table', { name: 'Members' })).toBeNull()
    expect(routeRef.restrictedReads).toEqual([])

    routeRef.role = 'viewer'
    await act(() => view.router.invalidate())
    expect(await screen.findByText('current')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

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

    const table = await screen.findByRole('table', { name: 'Members' })
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
      expect(suspendMock).toHaveBeenCalledWith({
        p_workspace_id: 'ws',
        p_user_id: 'old',
      }),
    )
  })

  it('leaves the invite address unflagged until the dialog is used', async () => {
    const user = userEvent.setup()
    routeRef.role = 'owner'
    renderMembers()

    await user.click(
      await screen.findByRole('button', { name: 'Invite people' }),
    )
    const email = await screen.findByRole('textbox', { name: /Email address/ })
    // The dialog opens on an empty address and Send is disabled; saying the
    // address is wrong before anyone has used the field is a false complaint.
    expect(email.getAttribute('aria-invalid')).toBeNull()
    expect(email.hasAttribute('aria-describedby')).toBe(false)
    expect(screen.queryByText('Enter an email address.')).toBeNull()

    const send = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create invitation link',
    })

    expect(send.disabled).toBe(true)

    await user.type(email, 'not-an-email')
    expect(screen.getByText('Enter an email address.')).toBeTruthy()
    expect(email.getAttribute('aria-invalid')).toBe('true')

    await user.clear(email)
    await user.type(email, 'qa@cdmo.example')
    expect(screen.queryByText('Enter an email address.')).toBeNull()
    expect(send.disabled).toBe(false)
  })

  it('explains a rejected invite address and links the reason to the field', async () => {
    const user = userEvent.setup()
    routeRef.role = 'owner'
    renderMembers()

    await user.click(
      await screen.findByRole('button', { name: 'Invite people' }),
    )
    const email = await screen.findByRole('textbox', { name: /Email address/ })
    await user.type(email, 'not-an-email')

    const describedBy = email.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const message = describedBy ? document.getElementById(describedBy) : null
    expect(message?.textContent).toBe('Enter an email address.')
    expect(email.getAttribute('aria-invalid')).toBe('true')

    const send = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create invitation link',
    })

    expect(send.disabled).toBe(true)
  })

  it('shows the one-time invitation link after inviting when the install has no mail server', async () => {
    const user = userEvent.setup()
    routeRef.role = 'owner'
    emailMock.mockResolvedValue({ sent: false, reason: 'no_mail_server' })
    inviteMock.mockResolvedValue({
      invitation: { id: 'inv-1', email: 'qa@cdmo.example' },
      token: 'tok 123',
    })
    renderMembers()

    await user.click(
      await screen.findByRole('button', { name: 'Invite people' }),
    )
    await user.type(
      await screen.findByRole('textbox', { name: /Email address/ }),
      'qa@cdmo.example',
    )
    await user.click(
      screen.getByRole('button', { name: 'Create invitation link' }),
    )

    const link = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Invitation link',
    })

    expect(link.value).toBe(
      `${window.location.origin}/accept-invitation?token=tok%20123`,
    )
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(screen.getByText('Send this link to the invitee')).toBeTruthy()
  })

  it('emails the invitation when the install can send mail, keeping the link as a fallback', async () => {
    const user = userEvent.setup()
    routeRef.role = 'owner'
    emailMock.mockResolvedValue({ sent: true })
    inviteMock.mockResolvedValue({
      invitation: { id: 'inv-2', email: 'qa@cdmo.example' },
      token: 'tok 456',
    })
    renderMembers()

    await user.click(
      await screen.findByRole('button', { name: 'Invite people' }),
    )
    await user.type(
      await screen.findByRole('textbox', { name: /Email address/ }),
      'qa@cdmo.example',
    )
    await user.click(
      screen.getByRole('button', { name: 'Create invitation link' }),
    )

    expect(
      await screen.findByText('Invitation sent to qa@cdmo.example'),
    ).toBeTruthy()
    expect(emailMock).toHaveBeenCalledWith({
      data: { workspaceId: 'ws', invitationId: 'inv-2', token: 'tok 456' },
    })

    const link = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Invitation link',
    })

    expect(link.value).toContain('token=tok%20456')
  })

  it('says so and keeps the link when the email does not go out', async () => {
    const user = userEvent.setup()
    routeRef.role = 'owner'
    emailMock.mockResolvedValue({ sent: false, reason: 'send_failed' })
    inviteMock.mockResolvedValue({
      invitation: { id: 'inv-3', email: 'qa@cdmo.example' },
      token: 'tok 789',
    })
    renderMembers()

    await user.click(
      await screen.findByRole('button', { name: 'Invite people' }),
    )
    await user.type(
      await screen.findByRole('textbox', { name: /Email address/ }),
      'qa@cdmo.example',
    )
    await user.click(
      screen.getByRole('button', { name: 'Create invitation link' }),
    )

    expect(await screen.findByText(/didn’t go out/)).toBeTruthy()
  })

  it('opens the invite dialog on Administrator for the signature-certification deep link', async () => {
    routeRef.role = 'owner'
    routeRef.search = { invite: 'admin' }
    renderMembers()

    const role = await screen.findByRole<HTMLSelectElement>('combobox', {
      name: 'Role',
    })

    expect(role.value).toBe('admin')
  })
})
