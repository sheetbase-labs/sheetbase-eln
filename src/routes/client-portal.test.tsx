/**
 * The client portal: the section comes from the URL (`?tab=`), so a portal
 * section is linkable and Back returns to the previous one, and only a client
 * account is offered the Reply action.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './client-portal'

// SAFETY: `client-portal.tsx` declares `component` in its route options, so the
// factory-built route always carries one; the router reads it the same way.
const ClientPortalRoute = Route.options.component as React.ComponentType

const portal = vi.hoisted(() => ({
  fetchClientPortalIdentity: vi.fn(),
  fetchClientPortalMessages: vi.fn(),
  fetchClientPortalMilestones: vi.fn(),
  fetchClientPortalProjects: vi.fn(),
  fetchClientPortalRecords: vi.fn(),
  fetchClientPortalReports: vi.fn(),
  postClientPortalMessage: vi.fn(),
}))

const navigate = vi.hoisted(() => vi.fn())
const signOutMock = vi.hoisted(() => vi.fn())

const routerMock = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  options: {
    context: {
      queryClient: { cancelQueries: vi.fn(async () => {}), clear: vi.fn() },
    },
  },
}))

interface PortalSearchState {
  value: { tab?: string }
}

const search = vi.hoisted(() => {
  const state: PortalSearchState = { value: {} }

  return state
})

const routeContext = vi.hoisted(() => ({
  value: {
    workspace: { id: 'ws-1', name: 'Process Development', role: 'viewer' },
    user: { id: 'user-1', name: 'Sam Lee' },
  },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route module builds its route object from `createFileRoute` at import time; rendering that component needs the framework's hooks replaced with the URL state, context and navigate spy these tests drive.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component?: React.ComponentType }) => ({
    useSearch: () => search.value,
    useRouteContext: () => ({ context: routeContext.value }),
    useNavigate: () => navigate,
    options: config,
  }),
  redirect: <Options,>(options: Options) => options,
  useRouter: () => routerMock,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- `authClient` is a Better Auth client built at module scope over its own fetch; the sign-out outcome and its refusal are what these tests assert.
vi.mock('#/lib/auth-client', () => ({
  authClient: { signOut: signOutMock },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- `client-portal` opens its data client at module scope, so the portal reads cannot be reached through a fetch seam; these fixtures are the rows the sections render.
vi.mock('#/lib/client-portal', async (importOriginal) => ({
  ...(await importOriginal()),
  ...portal,
}))

function renderPortal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      {React.createElement(ClientPortalRoute)}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  search.value = {}
  routeContext.value.workspace = {
    id: 'ws-1',
    name: 'Process Development',
    role: 'viewer',
  }
  portal.fetchClientPortalIdentity.mockResolvedValue(null)
  portal.fetchClientPortalMessages.mockResolvedValue([])
  portal.fetchClientPortalMilestones.mockResolvedValue([])
  portal.fetchClientPortalProjects.mockResolvedValue([])
  portal.fetchClientPortalRecords.mockResolvedValue([])
  portal.fetchClientPortalReports.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('client portal sign-out', () => {
  it('ends the session, clears the cache and returns to sign-in', async () => {
    signOutMock.mockResolvedValue({ data: { success: true }, error: null })
    const user = userEvent.setup()
    renderPortal()
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sign-in',
        search: { state: 'signed-out' },
      }),
    )
    expect(routerMock.options.context.queryClient.clear).toHaveBeenCalled()
  })

  it('says so when the sign-out is not confirmed and stays on the page', async () => {
    signOutMock.mockResolvedValue({ data: null, error: new Error('x') })
    const user = userEvent.setup()
    renderPortal()
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not be confirmed',
    )
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('client portal', () => {
  it('opens the section the URL names', async () => {
    search.value = { tab: 'messages' }
    portal.fetchClientPortalIdentity.mockResolvedValue({ clientCode: 'ACME' })
    renderPortal()

    expect(await screen.findByLabelText('Message your CDMO team')).toBeTruthy()
    expect(screen.queryByText('No shared projects yet')).toBeNull()
  })

  it('offers Reply to a client account only', async () => {
    search.value = { tab: 'messages' }
    portal.fetchClientPortalIdentity.mockResolvedValue({ clientCode: 'ACME' })
    renderPortal()

    await screen.findByLabelText('Message your CDMO team')
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy()

    cleanup()
    portal.fetchClientPortalIdentity.mockResolvedValue(null)
    renderPortal()

    expect(
      await screen.findByText('Messaging is for client portal accounts.', {
        exact: false,
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it('records the chosen section in the URL', async () => {
    const user = userEvent.setup()
    renderPortal()

    const nav = await screen.findByRole('navigation', { name: 'Portal' })
    await user.click(within(nav).getByRole('button', { name: 'Messages' }))

    expect(navigate).toHaveBeenCalledWith({ search: { tab: 'messages' } })
  })

  it('names the viewer’s own role and marks the page as a client-view preview', async () => {
    routeContext.value.workspace = {
      id: 'ws-1',
      name: 'Process Development',
      role: 'owner',
    }
    renderPortal()

    // The account is the Owner (as /settings/workspace/members reports), so the
    // portal must not claim the viewer is a client viewer. It marks the page as
    // a preview in the topbar and names the role in the access panel.
    expect(await screen.findAllByText('Client view preview')).toHaveLength(2)
    expect(screen.queryByText('Client viewer')).toBeNull()
    expect(screen.getByText('Owner')).toBeTruthy()
    expect(screen.getByText(/preview of the client view/i)).toBeTruthy()
  })

  it('states the client viewer role for a client account', async () => {
    routeContext.value.workspace = {
      id: 'ws-1',
      name: 'Process Development',
      role: 'client_viewer',
    }
    portal.fetchClientPortalIdentity.mockResolvedValue({ clientCode: 'ACME' })
    renderPortal()

    expect(await screen.findByText('Your access')).toBeTruthy()
    expect(screen.getByText('Client viewer')).toBeTruthy()
    expect(screen.queryByText('Client view preview')).toBeNull()
  })

  it('names the page with the topbar H1 above the section headings', async () => {
    renderPortal()

    const page = await screen.findByRole('heading', { level: 1 })
    expect(page.textContent).toBe('Client portal')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'No shared projects yet',
      }),
    ).toBeTruthy()
  })
})
