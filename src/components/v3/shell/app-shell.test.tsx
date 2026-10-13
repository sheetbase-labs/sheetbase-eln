import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { AppShell } from './app-shell'
import {
  fetchUserPreferences,
  setActiveWorkspace,
  setUserPreference,
} from '#/lib/user-preferences'
import type { UserPreferences } from '#/lib/user-preferences'
import type { Notification } from '#/components/v3/types'

const { signOut, navigate, invalidate, cancelQueries, clearQueries, goBack } =
  vi.hoisted(() => ({
    signOut: vi.fn(),
    navigate: vi.fn(),
    invalidate: vi.fn(),
    cancelQueries: vi.fn(),
    clearQueries: vi.fn(),
    goBack: vi.fn(),
  }))

/** SHELL-02: the bell's write. Mocked so the test can prove it happens. */
const { markNotificationsRead } = vi.hoisted(() => ({
  markNotificationsRead: vi.fn(async () => 1),
}))
vi.mock('#/lib/notifications-data', () => ({ markNotificationsRead }))

/** The path the mocked router reports; MOB-01.1's back button depends on it. */
const routerPath = { current: '/' }
vi.mock('#/lib/auth-client', () => ({ authClient: { signOut } }))
beforeEach(() => {
  vi.clearAllMocks()
  // The collapse preference is mirrored in localStorage; clear it so a test that
  // toggles the rail cannot decide the starting state of the next one.
  localStorage.clear()
  signOut.mockResolvedValue({ data: { success: true }, error: null })
})

// `mod` is ⌘ on macOS, Ctrl elsewhere; pin the platform so the ⌘\ binding is
// exercised deterministically.
beforeAll(() => {
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  })
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
    onClick,
    'aria-label': ariaLabel,
  }: {
    to?: unknown
    params?: Record<string, string>
    children?: React.ReactNode
    className?: string
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
    'aria-label'?: string
  }) => (
    <a
      href={
        typeof to === 'string'
          ? to.replace(
              /\$([A-Za-z]+)/g,
              (segment, key: string) => params?.[key] ?? segment,
            )
          : '#'
      }
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({
    invalidate,
    history: { back: goBack },
    options: {
      context: { queryClient: { cancelQueries, clear: clearQueries } },
    },
  }),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: routerPath.current } }),
}))

vi.mock('#/components/v3/search/search-palette', () => ({
  SearchPalette: () => null,
}))

vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({}),
}))

vi.mock('#/lib/user-preferences', () => ({
  fetchUserPreferences: vi.fn(async () => ({ navCollapsed: false })),
  setUserPreference: vi.fn(async () => {}),
  setUserAppearance: vi.fn(async () => {}),
  setActiveWorkspace: vi.fn(async () => {}),
}))

afterEach(cleanup)

function renderShell(
  overrides: Partial<React.ComponentProps<typeof AppShell>['data']> = {},
) {
  return render(
    <AppShell
      data={{
        me: { id: 'u-1', name: 'Gareth P.', initials: 'GP', role: 'Member' },
        notifications: [],
        pinned: [],
        counts: { inbox: '3', datasets: '2', pipelines: '1' },
        workspace: { id: 'ws-1', name: 'Process Development' },
        workspaces: [
          { id: 'ws-1', name: 'Process Development' },
          { id: 'ws-2', name: 'Analytical' },
        ],
        ...overrides,
      }}
    >
      <main>Content</main>
    </AppShell>,
  )
}

/** One notification in the shape the shell's server snapshot delivers. */
function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    to: { kind: 'review', id: 'rec-1' },
    unread: true,
    html: 'Review requested',
    when: '5m',
    ...overrides,
  }
}

describe('v3 AppShell navigation (SHELL-01)', () => {
  it('renders every destination as a focusable link', () => {
    renderShell()
    for (const label of ['Home', 'Inbox', 'Schedule', 'Projects', 'Models']) {
      const links = screen.getAllByRole('link', { name: label })
      expect(links.length).toBeGreaterThan(0)
      expect(links[0].tagName).toBe('A')
      expect(links[0].getAttribute('tabindex')).toBeNull()
    }
  })

  it('shows the active workspace in the top-bar switcher', () => {
    renderShell()
    expect(
      screen.getByRole('button', { name: 'Switch workspace' }).textContent,
    ).toContain('Process Development')
  })

  it('renders live counts in the sidebar', () => {
    const { container } = renderShell()
    const sidebar = Array.from(container.querySelectorAll('nav')).find((n) =>
      n.className.includes('w-nav'),
    )!
    expect(within(sidebar).getByText('3')).toBeTruthy()
    expect(within(sidebar).getByText('2')).toBeTruthy()
    expect(within(sidebar).getByText('1')).toBeTruthy()
  })

  it('collapses the sidebar to the rail with ⌘\\ and saves the preference', async () => {
    renderShell({
      pinned: [{ id: 'p-1', name: 'Assay development', tone: 'progress' }],
    })
    expect(screen.getByText('Assay development')).toBeTruthy()
    expect(screen.getByText('Pinned projects')).toBeTruthy()
    fireEvent.keyDown(window, { key: '\\', metaKey: true })
    await waitFor(() =>
      expect(screen.queryByText('Pinned projects')).toBeNull(),
    )
    // The rail keeps Settings reachable.
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBe(1)
    // SHELL-02: the collapse is a per-user preference, not just local state.
    await waitFor(() =>
      expect(vi.mocked(setUserPreference)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ navCollapsed: true }),
      ),
    )
  })

  it('leaves no pinned heading when the caller has pinned nothing', () => {
    renderShell()
    expect(screen.queryByText('Pinned projects')).toBeNull()
  })

  it('opens the generated shortcuts dialog with ?', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.keyboard('?')
    expect(await screen.findByText('Keyboard shortcuts')).toBeTruthy()
    expect(screen.getByText('Search and jump')).toBeTruthy()
  })
})

describe('MOB-01.1 phone shell', () => {
  afterEach(() => {
    routerPath.current = '/'
  })

  it('keeps the bench destinations in the phone bottom bar', () => {
    renderShell()
    const bar = screen.getByRole('link', { name: 'Scan' }).closest('nav')!
    expect(bar.className).toContain('md:hidden')
    // SHELL-01: the home destination carries one label everywhere in the shell.
    for (const label of ['Home', 'Scan', 'Inbox']) {
      const link = within(bar).getByRole('link', { name: new RegExp(label) })
      expect(link.className).toContain('min-h-14')
    }
    expect(within(bar).getByRole('button', { name: 'Menu' })).toBeTruthy()
  })

  it('agrees the Inbox badge between the bottom bar and the navigation drawer', async () => {
    const user = userEvent.setup()
    renderShell({ counts: { inbox: '5', datasets: '2', pipelines: '1' } })
    const bar = screen.getByRole('link', { name: 'Scan' }).closest('nav')!
    expect(
      within(bar).getByRole('link', { name: /Inbox/ }).textContent,
    ).toContain('5')

    await user.click(screen.getByRole('button', { name: 'Menu' }))
    const drawer = await screen.findByRole('dialog')
    expect(
      within(drawer).getByRole('link', { name: /Inbox/ }).textContent,
    ).toContain('5')
  })

  it('offers the workspace switcher in the phone drawer', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    const drawer = await screen.findByRole('dialog')
    const trigger = within(drawer).getByRole('button', {
      name: 'Switch workspace',
    })
    expect(trigger.textContent).toContain('Process Development')

    // A phone can change it, not only read it.
    await user.click(trigger)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Analytical' }),
    )
    await waitFor(() =>
      expect(setActiveWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'ws-2',
      ),
    )
  })

  it('shows the phone back button away from the bottom bar and hides it on it', () => {
    routerPath.current = '/records/abc'
    const first = renderShell()
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back.className).toContain('md:hidden')
    fireEvent.click(back)
    expect(goBack).toHaveBeenCalled()
    first.unmount()

    routerPath.current = '/'
    renderShell()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})

describe('SHELL-02 notification bell and SHELL-01 workspace switch', () => {
  async function openWorkspaceMenu(user: UserEvent) {
    const trigger = screen.getByRole('button', { name: 'Switch workspace' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
  }

  it('marks every unread notification read through the API, clearing the bell', async () => {
    const user = userEvent.setup()
    renderShell({
      notifications: [
        notification({ id: 'n-1' }),
        notification({ id: 'n-2', html: 'Material lot expiring' }),
      ],
    })

    await user.click(
      screen.getByRole('button', { name: 'Notifications, 2 unread' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Mark all read' }),
    )

    // The action is a write, not a local flag: the ids go to the same RPC the
    // legacy bell uses, and the shell re-resolves so the rows stay read.
    await waitFor(() =>
      expect(markNotificationsRead).toHaveBeenCalledWith(expect.anything(), [
        'n-1',
        'n-2',
      ]),
    )
    expect(invalidate).toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeTruthy(),
    )
    // SHELL-02: the phone bar's Inbox badge labels the inbox destination, not
    // the bell, so clearing notifications must not move it.
    const bar = screen.getByRole('link', { name: 'Scan' }).closest('nav')!
    expect(within(bar).getByText('3')).toBeTruthy()
  })

  it('opens a row on the record its target names and marks that row read', async () => {
    const user = userEvent.setup()
    renderShell({
      notifications: [
        notification({
          id: 'n-9',
          to: { kind: 'pipeline-run', id: 'run-9' },
          html: 'Pipeline run failed',
        }),
      ],
    })
    await user.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' }),
    )
    const row = await screen.findByRole('link', {
      name: /Pipeline run failed/,
    })
    expect(row.getAttribute('href')).toBe('/pipelines/runs/run-9')

    await user.click(row)
    await waitFor(() =>
      expect(markNotificationsRead).toHaveBeenCalledWith(expect.anything(), [
        'n-9',
      ]),
    )
    // The popover dismisses once the row is read.
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull()
  })

  it('keeps the bell open with the reason when the write fails', async () => {
    const user = userEvent.setup()
    markNotificationsRead.mockRejectedValueOnce(new Error('offline'))
    renderShell({ notifications: [notification({ id: 'n-1' })] })
    await user.click(
      screen.getByRole('button', { name: 'Notifications, 1 unread' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Mark all read' }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not be marked read',
    )
    expect(
      screen.getByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeTruthy()
  })

  it('switches workspace and re-resolves the shell when the switch succeeds', async () => {
    const user = userEvent.setup()
    renderShell()
    await openWorkspaceMenu(user)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Analytical' }),
    )
    await waitFor(() =>
      expect(setActiveWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'ws-2',
      ),
    )
    expect(invalidate).toHaveBeenCalled()
  })

  it('reports a refused switch instead of re-resolving onto it', async () => {
    const user = userEvent.setup()
    vi.mocked(setActiveWorkspace).mockRejectedValueOnce(new Error('denied'))
    renderShell()
    await openWorkspaceMenu(user)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Analytical' }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not be opened',
    )
    expect(invalidate).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Switch workspace' }).textContent,
    ).toContain('Process Development')
  })

  it('applies the stored collapse preference when the user has not touched it', async () => {
    vi.mocked(fetchUserPreferences).mockResolvedValueOnce({
      appearance: 'system',
      navCollapsed: true,
    })
    renderShell({
      pinned: [{ id: 'p-1', name: 'Assay development', tone: 'progress' }],
    })
    await waitFor(() =>
      expect(screen.queryByText('Pinned projects')).toBeNull(),
    )
  })

  it('never lets a late preference response undo a collapse the user made', async () => {
    // Executor form: tsconfig lib predates Promise.withResolvers (ES2024).
    let release: (value: UserPreferences) => void = () => {}
    vi.mocked(fetchUserPreferences).mockReturnValueOnce(
      new Promise<UserPreferences>((resolve) => {
        release = resolve
      }),
    )
    renderShell({
      pinned: [{ id: 'p-1', name: 'Assay development', tone: 'progress' }],
    })
    expect(screen.getByText('Pinned projects')).toBeTruthy()

    fireEvent.keyDown(window, { key: '\\', metaKey: true })
    await waitFor(() =>
      expect(screen.queryByText('Pinned projects')).toBeNull(),
    )

    // The response that arrives after the toggle must not reopen the sidebar.
    release({ appearance: 'system', navCollapsed: false })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('Pinned projects')).toBeNull()
  })
})

describe('v3 AccountMenu native signout', () => {
  async function chooseSignOut() {
    const user = userEvent.setup()
    renderShell()
    screen.getByRole('button', { name: 'Account: Gareth P.' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  }

  it('clears authenticated cache and navigates only after native success', async () => {
    await chooseSignOut()
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sign-in',
        search: { state: 'signed-out' },
      }),
    )
    expect(signOut).toHaveBeenCalledOnce()
    expect(cancelQueries).toHaveBeenCalledOnce()
    expect(clearQueries).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledOnce()
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      clearQueries.mock.invocationCallOrder[0],
    )
    expect(clearQueries.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    )
  })

  it.each(['transport', 'denial', 'missing-success'])(
    'keeps the current route and cache on %s failure',
    async (failure) => {
      if (failure === 'transport')
        signOut.mockRejectedValueOnce(new Error('Network unavailable'))
      else
        signOut.mockResolvedValueOnce({
          data: null,
          error: failure === 'denial' ? { message: 'Denied' } : null,
        })
      await chooseSignOut()
      await screen.findByRole('alert')
      expect(navigate).not.toHaveBeenCalled()
      expect(cancelQueries).not.toHaveBeenCalled()
      expect(clearQueries).not.toHaveBeenCalled()
      expect(invalidate).not.toHaveBeenCalled()
    },
  )

  it('keeps unsaved editors mounted and does not end their session', async () => {
    const guard = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', guard)
    try {
      await chooseSignOut()
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Your edits have not been discarded',
      )
      expect(signOut).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
      expect(clearQueries).not.toHaveBeenCalled()
      expect(screen.getByText('Content')).toBeTruthy()
    } finally {
      window.removeEventListener('beforeunload', guard)
    }
  })

  it('signs out while offline, keeping unsynced work on the device (EXP-05.5)', async () => {
    // Being offline is no longer a reason to refuse sign-out: the device store
    // keeps the drafts, and signing back in as the same user restores them. The
    // only thing that blocks sign-out is an editor with work it has not saved.
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await chooseSignOut()
      await waitFor(() => expect(signOut).toHaveBeenCalled())
      // The server cache is cleared; the device store is not, and is not touched.
      expect(clearQueries).toHaveBeenCalled()
    } finally {
      online.mockRestore()
    }
  })

  it('still refuses to sign out while an editor holds unsaved work', async () => {
    const listener = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', listener)
    try {
      await chooseSignOut()
      await screen.findByRole('alert')
      expect(signOut).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('beforeunload', listener)
    }
  })
})
