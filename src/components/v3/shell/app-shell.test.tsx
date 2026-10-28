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
import { getShellCounts } from '#/lib/shell-counts.server'
import {
  fetchUserPreferences,
  setActiveWorkspace,
  setUserPreference,
} from '#/lib/user-preferences'
import type { UserPreferences } from '#/lib/user-preferences'
import type { Notification } from '#/components/v3/types'
import { registerWorkspaceLeave } from '#/components/workspace/workspace-navigation'

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

/**
 * QA4-Shell-Badge: the reads the real server count runs, so one test can drive
 * a failed Inbox read all the way into the badge.
 */
const { shellConnect, shellQuery } = vi.hoisted(() => ({
  shellConnect: vi.fn(),
  shellQuery: vi.fn(),
}))
vi.mock('#/db/client.server', () => ({
  db: { $client: { connect: shellConnect, query: shellQuery } },
}))

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

// `mod` is ⌘ on macOS, Ctrl elsewhere; pin the platform so the ⌘B binding is
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
    activeProps,
    inactiveProps,
  }: {
    to?: unknown
    params?: Record<string, string>
    children?: React.ReactNode
    className?: string
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
    'aria-label'?: string
    activeOptions?: { exact?: boolean }
    activeProps?: React.AnchorHTMLAttributes<HTMLAnchorElement>
    inactiveProps?: React.AnchorHTMLAttributes<HTMLAnchorElement>
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
      {...(to === routerPath.current ? activeProps : inactiveProps)}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({
    invalidate,
    navigate,
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
  // The shell's binding is what is under test here, not the palette's
  // contents: the mock reports `open` so a test can see ⌘K reach it.
  SearchPalette: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Search palette" /> : null,
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
  children: React.ReactNode = <p>Content</p>,
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
      {children}
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

  it('collapses the sidebar to the rail with ⌘B and saves the preference', async () => {
    renderShell({
      pinned: [{ id: 'p-1', name: 'Assay development', tone: 'progress' }],
    })
    expect(screen.getByText('Assay development')).toBeTruthy()
    expect(screen.getByText('Pinned projects')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'b', metaKey: true })
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

describe('SHELL-01 one sidebar at every width', () => {
  afterEach(() => {
    routerPath.current = '/'
  })

  it('shows the icon rail where there is no room for the full navigation', () => {
    const { container } = renderShell()
    const rail = container.querySelector('nav[class*="w-12"]')!
    const full = container.querySelector<HTMLElement>('nav[class*="w-nav"]')!
    // The rail is the sidebar below the wide breakpoint: it is never hidden,
    // and the full navigation is what appears when there is room.
    expect(rail.className).toContain('flex')
    expect(rail.className).toContain('xl:hidden')
    expect(rail.className).not.toContain('hidden ')
    expect(full.className).toContain('hidden')
    expect(full.className).toContain('xl:flex')
  })

  it('minimises the sidebar to the rail with one control, and expands it again', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    expect(
      screen.getByRole('button', { name: 'Minimise navigation' }),
    ).toBeTruthy()

    await user.click(
      screen.getByRole('button', { name: 'Minimise navigation' }),
    )
    const rail = container.querySelector('nav[class*="w-12"]')!
    expect(rail.className).not.toContain('xl:hidden')
    expect(container.querySelector('nav[class*="w-nav"]')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Expand navigation' }))
    expect(container.querySelector('nav[class*="w-nav"]')).not.toBeNull()
  })

  it('mirrors the collapse in localStorage for the next load', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(
      screen.getByRole('button', { name: 'Minimise navigation' }),
    )
    await waitFor(() =>
      expect(localStorage.getItem('sheetbase-sidebar-collapsed')).toBe('1'),
    )
  })

  it('has no hamburger, no drawer and no second navigation surface', () => {
    const { container } = renderShell()
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
    expect(container.querySelector('nav[class*="md:hidden"]')).toBeNull()
  })

  it('shows the inbox count in the full navigation', () => {
    const { container } = renderShell({
      counts: { inbox: '5', datasets: '2', pipelines: '1' },
    })
    const full = container.querySelector<HTMLElement>('nav[class*="w-nav"]')!
    expect(
      within(full).getByRole('link', { name: /Inbox/ }).textContent,
    ).toContain('5')
  })

  it('renders no number for an inbox count it could not read, and the counts it has', () => {
    // QA4: a failed read states `null` (unknown), never zero — the badge must
    // not answer "0 there is nothing waiting" for a read that never landed.
    const { container } = renderShell({
      counts: { inbox: null, datasets: '2 errors', pipelines: '1 failed' },
    })
    const full = container.querySelector<HTMLElement>('nav[class*="w-nav"]')!
    const inbox = within(full).getByRole('link', { name: /Inbox/ })
    expect(inbox.textContent).not.toContain('0')
    expect(inbox.textContent).not.toMatch(/\d/)
    expect(inbox.textContent).toBe('Inbox')
    // The counts that did read are untouched by the one that did not.
    expect(
      within(full).getByRole('link', { name: /Datasets/ }).textContent,
    ).toContain('2 errors')
    expect(
      within(full).getByRole('link', { name: /Pipelines/ }).textContent,
    ).toContain('1 failed')
  })

  it('carries the workspace switcher in the top bar', async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByRole('button', { name: 'Switch workspace' })
    expect(trigger.textContent).toContain('Process Development')

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

  it('keeps the workspace switcher in the top bar below the sm breakpoint', () => {
    renderShell()
    const trigger = screen.getByRole('button', { name: 'Switch workspace' })
    // There is no phone drawer, so the trigger cannot fall back to
    // `hidden sm:flex`: it is the one place the top bar names the workspace.
    expect(trigger.className).not.toContain('hidden')
    expect(trigger.className).not.toContain('sm:flex')
    expect(trigger.className).toContain('min-w-16')
    expect(trigger.className).toContain('shrink')
  })

  it('offers the minimise control only where the full sidebar can render', () => {
    renderShell()
    // Below `xl` the rail is the only navigation, so the control is hidden
    // rather than flipping a state the frame cannot show.
    expect(
      screen.getByRole('button', { name: 'Minimise navigation' }).className,
    ).toContain('max-xl:hidden')
  })

  it('reflows the top bar at phone width instead of clipping a control', () => {
    const { container } = renderShell()
    const header = container.querySelector('header')!
    // At 320 the controls measured 356px in a 320px bar and the account menu sat
    // outside the viewport with no ancestor able to scroll to it (WCAG 1.4.10),
    // so below `md` the bar wraps and grows past its fixed row height.
    expect(header.className).toContain('max-md:flex-wrap')
    expect(header.className).toContain('max-md:h-auto')
    // Reflow, not removal: the account control stays in the bar.
    expect(
      within(header).getByRole('button', { name: 'Account: Gareth P.' }),
    ).toBeTruthy()
    // The phone search control is `size-10`, so its container keeps room for it
    // rather than being squeezed until the icon paints over the brand link.
    const search = within(header).getByRole('button', {
      name: 'Search',
    }).parentElement!
    expect(search.className).toContain('max-md:min-w-10')
  })

  it('declares no sidebar styles for frames that never render', () => {
    const { container } = renderShell()
    const full = container.querySelector<HTMLElement>('nav[class*="w-nav"]')!
    // The full navigation only renders from `xl` up, so `max-lg:*` on it or
    // its rows can never apply.
    expect(full.className).not.toContain('max-lg:')
    expect(full.innerHTML).not.toContain('max-lg:')
  })

  it('shows the phone back button away from the top-level destinations', () => {
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
    // SHELL-02: the navigation's Inbox badge labels the inbox destination, not
    // the bell, so clearing notifications must not move it.
    const nav = document.querySelector<HTMLElement>('nav[class*="w-nav"]')!
    expect(
      within(nav).getByRole('link', { name: /Inbox/ }).textContent,
    ).toContain('3')
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
    // The page open belongs to the workspace just left: land on Home.
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/' }))
  })

  it('keeps the active workspace when a page refuses to leave', async () => {
    const unregister = registerWorkspaceLeave(async () => false)
    try {
      const user = userEvent.setup()
      renderShell()
      await openWorkspaceMenu(user)
      await user.click(
        await screen.findByRole('menuitem', { name: 'Analytical' }),
      )
      expect((await screen.findByRole('alert')).textContent).toContain(
        'could not be opened',
      )
      expect(setActiveWorkspace).not.toHaveBeenCalled()
      expect(clearQueries).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
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
    expect(navigate).not.toHaveBeenCalledWith({ to: '/' })
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

    fireEvent.keyDown(window, { key: 'b', metaKey: true })
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
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/sign-in',
          search: { state: 'signed-out' },
        }),
      ),
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

// Ported from the deleted legacy shell suite (SHELL-01): the landmarks and the
// global shortcuts its tests covered, now asserted against the adopted shell.
describe('SHELL-01 landmarks in the v3 shell', () => {
  it('renders a skip link that lands on the shell main landmark', () => {
    renderShell()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip.getAttribute('href')).toBe('#main')
    expect(screen.getByRole('main').id).toBe('main')
    // The skip link has to land on the content the route rendered.
    expect(screen.getByRole('main').contains(screen.getByText('Content'))).toBe(
      true,
    )
  })

  it('marks the active destination aria-current=page and leaves the rest unmarked', () => {
    routerPath.current = '/projects'
    try {
      renderShell()
      const projects = screen.getAllByRole('link', { name: 'Projects' })
      expect(projects.length).toBeGreaterThan(1)
      for (const link of projects) {
        expect(link.getAttribute('aria-current')).toBe('page')
      }
      for (const link of screen.getAllByRole('link', { name: 'Schedule' })) {
        expect(link.getAttribute('aria-current')).toBeNull()
      }
    } finally {
      routerPath.current = '/'
    }
  })
})

describe('SHELL-03 global shortcuts reach the v3 shell', () => {
  it('opens the ⌘K palette from anywhere in the shell', async () => {
    const user = userEvent.setup()
    renderShell()
    expect(screen.queryByRole('dialog', { name: 'Search palette' })).toBeNull()
    await user.keyboard('{Meta>}k{/Meta}')
    // The palette's code loads on first open.
    expect(
      await screen.findByRole('dialog', { name: 'Search palette' }),
    ).toBeTruthy()
  })

  it('opens the Create menu on c and closes it again on Escape', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.keyboard('c')
    // The New menu's destinations, in the order the shell lists them.
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/experiments/new',
      '/samples',
      '/projects',
      '/sheets/new',
      '/analysis/new',
      '/import',
      '/materials',
      '/instruments',
      '/templates',
      '/protocols',
      '/pipelines',
      '/models',
    ])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('navigates on a g-sequence and ignores one typed into a field', async () => {
    const user = userEvent.setup()
    const first = renderShell()
    await user.keyboard('g')
    await user.keyboard('p')
    expect(navigate).toHaveBeenCalledWith({ to: '/projects' })
    first.unmount()

    navigate.mockClear()
    renderShell({}, <input aria-label="Route note" />)
    await user.click(screen.getByRole('textbox', { name: 'Route note' }))
    await user.keyboard('g')
    await user.keyboard('p')
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('QA4 · the shell badge and a count it could not read', () => {
  it('renders no number for a rejected inbox count, and the counts that did read', async () => {
    // The real server count, with the Inbox read rejecting: what reaches the
    // badge must be unknown, not a zero the read never landed on.
    shellConnect.mockResolvedValue({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('inbox_needs_action_counts')) throw new Error('down')
        return { rows: [] }
      }),
      release: vi.fn(),
    })
    shellQuery.mockImplementation(async (sql: string) =>
      sql.includes('dataset_value_flags')
        ? { rows: [{ n: '2' }] }
        : { rows: [{ n: '1' }] },
    )
    const counts = await getShellCounts('ws-1', 'u-1')
    expect(counts.inbox).toBeNull()

    const { container } = renderShell({ counts })
    const full = container.querySelector<HTMLElement>('nav[class*="w-nav"]')!
    const inbox = within(full).getByRole('link', { name: /Inbox/ })
    expect(inbox.textContent).not.toContain('0')
    expect(inbox.textContent).not.toMatch(/\d/)
    // The two counts that read are untouched by the one that did not.
    expect(
      within(full).getByRole('link', { name: /Datasets/ }).textContent,
    ).toContain('2 errors')
    expect(
      within(full).getByRole('link', { name: /Pipelines/ }).textContent,
    ).toContain('1 failed')
  })
})
