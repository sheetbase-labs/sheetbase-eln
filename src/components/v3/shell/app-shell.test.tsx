import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { setUserPreference } from '#/lib/user-preferences'

const { signOut, navigate, invalidate, cancelQueries, clearQueries, goBack } =
  vi.hoisted(() => ({
    signOut: vi.fn(),
    navigate: vi.fn(),
    invalidate: vi.fn(),
    cancelQueries: vi.fn(),
    clearQueries: vi.fn(),
    goBack: vi.fn(),
  }))

/** The path the mocked router reports; MOB-01.1's back button depends on it. */
const routerPath = { current: '/' }
vi.mock('#/lib/auth-client', () => ({ authClient: { signOut } }))
beforeEach(() => {
  vi.clearAllMocks()
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
    children,
    className,
  }: {
    to?: unknown
    children?: React.ReactNode
    className?: string
  }) => (
    <a href={typeof to === 'string' ? to : '#'} className={className}>
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
    renderShell()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('collapses the sidebar to the rail with ⌘\\ and saves the preference', async () => {
    renderShell()
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
    for (const label of ['Today', 'Scan', 'Inbox']) {
      const link = within(bar).getByRole('link', { name: label })
      expect(link.className).toContain('min-h-14')
    }
    expect(within(bar).getByRole('button', { name: 'Menu' })).toBeTruthy()
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
