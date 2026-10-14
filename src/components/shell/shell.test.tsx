import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  APP_SHELL_MAIN_ID,
  APP_SHELL_NAV_ID,
  AppShell,
  ShellProvider,
  SPECIALIST_NAV_HREFS,
  defaultNavSections,
  useShell,
} from '#/components/shell'
import type { AppShellNavItem } from '#/components/shell'
import type { FavouriteItem } from '#/lib/favourites'
import { notebookDataClient } from '#/lib/notebook-data'
import { currentPlatform } from '#/lib/shortcuts'

// The ⌘K / Ctrl+K binding is platform-aware (SHELL-03); press the modifier the
// active platform expects so the test is portable.
const paletteKeys =
  currentPlatform() === 'mac' ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}'

// Stub auth-client so signOut never hits the network.
vi.mock('#/lib/auth-client', () => ({
  authClient: { signOut: vi.fn(() => Promise.resolve()) },
}))

// FIND-02: the command palette lists favourites. Stub the data layer so
// palette tests are deterministic and never touch the network; tests that
// need specific items override the returned fixtures. vi.hoisted keeps the
// mock usable inside the hoisted vi.mock factory.
const fetchFavouriteItemsMock = vi.hoisted(() =>
  vi.fn<() => Promise<FavouriteItem[]>>(() => Promise.resolve([])),
)
vi.mock('#/lib/favourites', async () => {
  const actual = await vi.importActual<object>('#/lib/favourites')
  return {
    ...actual,
    fetchFavouriteItems: fetchFavouriteItemsMock,
  }
})

// Theme provider stubs to a fixed value so the shell renders deterministically.
vi.mock('#/components/theme-provider', () => ({
  useTheme: () => ({
    theme: 'light' as const,
    setTheme: vi.fn(),
  }),
}))

// Stub the router hooks/Link the shell uses so no route tree is required.
// navigateMock is hoisted so keyboard/palette tests can assert destinations.
const navigateMock = vi.hoisted(() => vi.fn())
let currentPathname = '/projects'
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => navigateMock,
  useRouterState: ({
    select,
  }: {
    select: (s: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: currentPathname } }),
  Link: ({
    to,
    children,
    ...props
  }: { to: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  currentPathname = '/projects'
  navigateMock.mockReset()
  fetchFavouriteItemsMock.mockReset()
  fetchFavouriteItemsMock.mockImplementation(() => Promise.resolve([]))
})

function renderShell(props: Parameters<typeof AppShell>[0]) {
  const user = userEvent.setup()
  // The palette reads favourites through TanStack Query; the real app gets
  // its provider from @tanstack/react-router-ssr-query, tests provide one.
  const utils = render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell {...props} />
    </QueryClientProvider>,
  )
  return { user, ...utils }
}

const baseContext = {
  workspace: { name: 'OXB Labs' },
  user: { name: 'Gareth Price', email: 'gareth@oxb.dev', role: 'Scientist' },
}

describe('AppShell', () => {
  beforeAll(() => {
    // jsdom does not implement ResizeObserver; Radix tooltips/sheets read it.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // cmdk scrolls the selected item into view; jsdom does not implement it.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('keeps specialist tools out of the default navigation', () => {
    const hrefs = defaultNavSections.flatMap((section) =>
      section.items.map((item) => item.to),
    )
    for (const href of SPECIALIST_NAV_HREFS) {
      expect(hrefs).not.toContain(href)
    }
    expect(hrefs).not.toContain('/agent-operations')
    expect(hrefs).not.toContain('/plate-designer')
  })

  it('gives every canonical destination one predictable product plane', () => {
    const destinations = defaultNavSections.flatMap((section) =>
      section.items.map((item) => ({ section: section.label, ...item })),
    )
    expect(new Set(destinations.map((item) => item.to)).size).toBe(
      destinations.length,
    )
    expect(destinations.find((item) => item.to === '/samples')?.label).toBe(
      'Samples',
    )
    expect(destinations.find((item) => item.to === '/templates')?.label).toBe(
      'Templates',
    )
    expect(destinations.find((item) => item.to === '/pipelines')?.label).toBe(
      'Pipelines',
    )
  })

  it('renders primary landmarks and a skip link', () => {
    currentPathname = '/'
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: <p>Hello</p>,
    })
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
    expect(
      screen.getByRole('complementary', { name: 'Application navigation' }),
    ).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy()
  })

  it('marks the last breadcrumb as the current page', () => {
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Projects' }],
      children: null,
    })
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const currentLocations = within(breadcrumb)
      .getAllByText('Projects')
      .filter((element) => element.getAttribute('aria-current') === 'page')
    expect(currentLocations).toHaveLength(2)
    expect(
      within(breadcrumb).getByRole('link', { name: 'Sheetbase home' }),
    ).toBeTruthy()
  })

  it('keeps a useful current location in the narrow header for short trails', () => {
    const { container } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Samples' }],
      children: null,
    })
    const mobile = container.querySelector('[data-slot="mobile-breadcrumb"]')
    expect(mobile?.textContent).toBe('Samples')
    expect(mobile?.querySelector('[aria-current="page"]')?.textContent).toBe(
      'Samples',
    )
  })

  it('names the canonical parent destination in the narrow header', () => {
    const { container } = renderShell({
      context: baseContext,
      breadcrumbs: [
        { label: 'Home', to: '/' },
        { label: 'Projects', to: '/projects' },
        { label: 'Stability run' },
      ],
      children: null,
    })
    const mobile = container.querySelector(
      '[data-slot="mobile-breadcrumb"]',
    ) as HTMLElement
    expect(within(mobile).getByRole('link', { name: 'Projects' })).toBeTruthy()
    expect(mobile.textContent).not.toContain('Back')
    expect(mobile.textContent).toContain('Stability run')
  })

  it('marks the active nav item with aria-current=page', () => {
    currentPathname = '/projects'
    const items: AppShellNavItem[] = [
      { to: '/', label: 'Home', icon: 'home' },
      { to: '/projects', label: 'Projects', icon: 'folder' },
    ]
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Projects' }],
      navSections: [{ label: 'Workspace', items }],
      children: null,
    })
    const projectsLink = screen.getByRole('link', { name: /Projects/ })
    expect(projectsLink.getAttribute('aria-current')).toBe('page')
  })

  it('renders disabled nav items as non-interactive placeholders', () => {
    const items: AppShellNavItem[] = [
      { to: '/tasks', label: 'Tasks', icon: 'check', disabled: true },
    ]
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      navSections: [{ items }],
      children: null,
    })
    const placeholder = screen.getByText('Tasks')
    expect(placeholder.tagName).not.toBe('A')
    expect(placeholder.closest('[aria-disabled]')).toBeTruthy()
  })

  it('does not render an inspector slot when none is provided', () => {
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    expect(
      screen.queryByRole('complementary', { name: 'Inspector' }),
    ).toBeNull()
  })

  it('renders an inspector slot when content is provided', () => {
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      inspector: <div>Inspector body</div>,
      children: null,
    })
    expect(
      screen.getByRole('complementary', { name: 'Inspector' }),
    ).toBeTruthy()
    expect(screen.getByText('Inspector body')).toBeTruthy()
  })

  it('opens the generic narrow-screen inspector Sheet without a second close control', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      inspectorLabel: 'Record details',
      inspector: <div>Inspector body</div>,
      children: null,
    })
    await user.click(
      screen.getByRole('button', { name: 'Open Record details' }),
    )
    expect(screen.getByRole('dialog', { name: 'Record details' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('C opens the real controlled New menu and Escape restores its trigger', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    await user.keyboard('c')
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Experiment' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'New' }),
    )
    await user.click(screen.getByRole('button', { name: 'New' }))
    // Base UI opens the menu asynchronously (see UI_PORT: the Radix menus
    // moved to base-ui and their tests wait for the menu to mount).
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy())
  })

  it('opens the command palette with ⌘K and lists enabled nav items only', async () => {
    const items: AppShellNavItem[] = [
      { to: '/projects', label: 'Projects', icon: 'folder' },
      { to: '/tasks', label: 'Tasks', icon: 'check', disabled: true },
    ]
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      navSections: [{ items }],
      children: null,
    })
    await user.keyboard(paletteKeys)
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('Projects')
    expect(dialog.textContent).not.toContain('Tasks')
  })

  it('lists resolved favourites in the command palette (FIND-02)', async () => {
    fetchFavouriteItemsMock.mockImplementation(() =>
      Promise.resolve([
        {
          kind: 'project',
          id: 'p-1',
          label: 'Stability study',
          identifier: 'LV-1',
          destination: '/projects/p-1',
          createdAt: '2026-08-31T10:00:00Z',
        },
      ]),
    )
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    await user.keyboard(paletteKeys)
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    await waitFor(() => {
      expect(dialog.textContent).toContain('Stability study')
    })
    expect(dialog.textContent).toContain('Favourites')
    // Unfavouriting/removal keeps the group out of the palette entirely.
  })

  it('omits the favourites group when the user has none', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    await user.keyboard(paletteKeys)
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    await waitFor(() => {
      expect(fetchFavouriteItemsMock).toHaveBeenCalled()
    })
    expect(dialog.textContent).not.toContain('Favourites')
  })

  it('persists the collapsed state via the collapse toggle', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    await user.click(toggle)
    expect(localStorage.getItem('sheetbase-sidebar-collapsed')).toBe('1')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
    const home = screen.getByRole('link', { name: 'Home' })
    expect(home.textContent).toBe('')

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const mobileNavigation = screen.getByRole('dialog', {
      name: 'Navigation',
    })
    expect(
      within(mobileNavigation).getByRole('link', { name: 'Home' }).textContent,
    ).toBe('Home')
  })

  it('keeps stable ids for the skip-link target and primary nav', () => {
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    expect(screen.getByRole('main').id).toBe(APP_SHELL_MAIN_ID)
    expect(screen.getByRole('navigation', { name: 'Primary' }).id).toBe(
      APP_SHELL_NAV_ID,
    )
  })

  it('exposes workspace and account controls', () => {
    renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    expect(
      screen.getByRole('button', { name: 'Account: Gareth Price' }),
    ).toBeTruthy()
    expect(screen.getByText('OXB Labs')).toBeTruthy()
  })

  it.each([
    ['h', '/'],
    ['i', '/inbox'],
    ['e', '/experiments'],
    ['p', '/projects'],
    ['d', '/datasets'],
    ['s', '/sheets'],
    ['t', '/templates'],
    ['a', '/samples'],
    ['r', '/materials'],
  ])('navigates on the g-then-%s sequence (NAV-03)', async (letter, to) => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    await user.keyboard('g')
    await user.keyboard(letter)
    expect(navigateMock).toHaveBeenCalledWith({ to })
  })

  it('ignores unknown g-sequence second keys and lone letters', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    await user.keyboard('g')
    await user.keyboard('x')
    expect(navigateMock).not.toHaveBeenCalled()
    // The pending `g` is consumed — a later letter alone does nothing.
    await user.keyboard('p')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('does not fire g-sequences while typing in editable targets', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: <input aria-label="note-input" />,
    })
    await user.click(screen.getByRole('textbox', { name: 'note-input' }))
    await user.keyboard('g')
    await user.keyboard('p')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('lists projects in the palette and navigating closes it (NAV-03)', async () => {
    const listSpy = vi.spyOn(notebookDataClient, 'list').mockResolvedValue([
      {
        id: 'p-1',
        workspace_id: 'w-1',
        key: 'LV-1',
        title: 'Stability study',
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
        archived_at: null,
      },
    ])
    try {
      const { user } = renderShell({
        context: baseContext,
        breadcrumbs: [{ label: 'Home' }],
        children: null,
      })
      await user.keyboard(paletteKeys)
      const dialog = screen.getByRole('dialog', { name: 'Command palette' })
      await waitFor(() => {
        expect(dialog.textContent).toContain('Projects')
      })
      expect(dialog.textContent).toContain('Stability study')
      await user.click(screen.getByRole('option', { name: /Stability study/ }))
      expect(navigateMock).toHaveBeenCalledWith({ to: '/projects/p-1' })
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Command palette' }),
        ).toBeNull()
      })
    } finally {
      listSpy.mockRestore()
    }
  })

  it('omits the projects group when loading fails (NAV-03)', async () => {
    const listSpy = vi
      .spyOn(notebookDataClient, 'list')
      .mockRejectedValue(new Error('offline'))
    try {
      const { user } = renderShell({
        context: baseContext,
        breadcrumbs: [{ label: 'Home' }],
        children: null,
      })
      await user.keyboard(paletteKeys)
      const dialog = screen.getByRole('dialog', { name: 'Command palette' })
      // Both palette queries fire; the projects one rejects and must
      // degrade to "group absent" once it settles.
      await waitFor(() => {
        expect(listSpy).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(fetchFavouriteItemsMock).toHaveBeenCalled()
      })
      expect(dialog.textContent).not.toContain('Stability study')
      // No error UI leaks into the palette surface.
      expect(dialog.textContent).not.toMatch(/offline|error/i)
    } finally {
      listSpy.mockRestore()
    }
  })

  it('documents the g-sequences in the palette footer (NAV-03)', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    await user.keyboard(paletteKeys)
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    for (const hint of [
      'g h Home',
      'g p Projects',
      'g d Datasets',
      'g s Sheets',
      'g t Templates',
      'g a Samples',
      'g r Materials',
    ]) {
      expect(dialog.textContent).toContain(hint)
    }
  })

  it('returns focus to the trigger after the palette closes (NAV-03)', async () => {
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      children: null,
    })
    const trigger = screen.getByRole('button', {
      name: 'Search experiments, samples, datasets',
    })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Command palette' }),
      ).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('renders the same enabled destinations in the drawer and sidebar (NAV-03)', async () => {
    const items: AppShellNavItem[] = [
      { to: '/', label: 'Home', icon: 'home' },
      { to: '/projects', label: 'Projects', icon: 'folder' },
      { to: '/tasks', label: 'Tasks', icon: 'check', disabled: true },
    ]
    const { container, user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      navSections: [{ label: 'Workspace', items }],
      children: null,
    })
    const desktopHrefs = [
      ...container
        .querySelector('[data-slot="sidebar"] nav[aria-label="Primary"]')!
        .querySelectorAll('a'),
    ].map((a) => a.getAttribute('href'))
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    const drawerPrimary = within(drawer).getByRole('navigation', {
      name: 'Primary',
    })
    const drawerHrefs = within(drawerPrimary)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
    // Same enabled destinations, no separate drawer semantics: disabled
    // placeholders stay out of both link sets.
    expect(drawerHrefs.sort()).toEqual([...desktopHrefs].sort())
    expect(drawerHrefs).toContain('/')
    expect(drawerHrefs).toContain('/projects')
    // Disabled placeholders are text, not links, on both surfaces.
    expect(
      within(drawerPrimary).queryByRole('link', { name: 'Tasks' }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ShellProvider + useShell regression tests
//
// These use the REAL provider/hook (not the mocked versions in route tests)
// to catch the infinite-update-loop regression that occurred when useShell
// called setConfig in a layout effect with no dependency array while
// ShellProvider held config in useState.
// ---------------------------------------------------------------------------

/** A child route component that calls useShell like a real route would. */
function FakeRoute({
  label,
  inspectorContent,
}: {
  label: string
  inspectorContent?: string
}) {
  useShell({
    context: baseContext,
    breadcrumbs: [{ label }],
    inspector: inspectorContent ? <div>{inspectorContent}</div> : undefined,
  })
  return <p data-testid="route-content">{label}</p>
}

describe('ShellProvider + useShell', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders without maximum-update-depth errors', async () => {
    // If the provider/hook loops, React throws "Maximum update depth
    // exceeded" and this render will fail.
    const result = render(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <FakeRoute label="Home" />
        </ShellProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(result.getByTestId('route-content').textContent).toBe('Home')
    })
    // Shell should have rendered (sidebar visible)
    expect(screen.getByText('OXB Labs')).toBeTruthy()
  })

  it('passes config through to AppShell (sidebar, breadcrumbs, inspector)', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <FakeRoute label="Projects" inspectorContent="Details" />
        </ShellProvider>
      </QueryClientProvider>,
    )
    // Wait for the layout effect to fire and AppShell to render
    await waitFor(() => {
      expect(screen.getByText('OXB Labs')).toBeTruthy()
    })
    // Breadcrumb
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
    expect(screen.getAllByText('Projects').length).toBeGreaterThanOrEqual(1)
    // Inspector
    expect(screen.getByText('Details')).toBeTruthy()
    // Route content
    expect(screen.getByTestId('route-content').textContent).toBe('Projects')
  })

  it('clears per-route shell slots on unmount', async () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <FakeRoute label="Page A" inspectorContent="Inspector A" />
        </ShellProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText('Inspector A')).toBeTruthy()
    })

    // Simulate navigating to a route that doesn't set an inspector.
    // The old FakeRoute unmounts → useShell cleanup clears inspector.
    // The new FakeRoute mounts → useShell sets new breadcrumbs, no inspector.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <FakeRoute label="Page B" />
        </ShellProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('route-content').textContent).toBe('Page B')
    })
    // Inspector from the previous route should be gone
    expect(screen.queryByText('Inspector A')).toBeNull()
  })

  it('renders and updates the route action, then removes it when the route unmounts', async () => {
    const onAction = vi.fn()
    function ActionRoute({ pending = false }: { pending?: boolean }) {
      useShell({
        context: baseContext,
        primaryAction: (
          <button type="button" disabled={pending} onClick={onAction}>
            {pending ? 'Creating…' : 'New project'}
          </button>
        ),
      })
      return <p>Projects route</p>
    }
    const user = userEvent.setup()
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <ActionRoute />
        </ShellProvider>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    expect(onAction).toHaveBeenCalledOnce()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <ActionRoute pending />
        </ShellProvider>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull()
    expect(
      (await screen.findByRole('button', { name: 'Creating…' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true)

    // A different route omits primaryAction entirely; cleanup must remove it.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider>
          <FakeRoute label="Next route" />
        </ShellProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('route-content').textContent).toBe('Next route')
    expect(screen.queryByRole('button', { name: 'Creating…' })).toBeNull()
  })
})

describe('Shell layout transitions', () => {
  it('preserves the mounted route when its fullBleed layout changes', async () => {
    const user = userEvent.setup()
    const client = new QueryClient()
    const layout = (fullBleed: boolean) => (
      <QueryClientProvider client={client}>
        <AppShell context={baseContext} breadcrumbs={[]} fullBleed={fullBleed}>
          <input aria-label="Route draft" defaultValue="" />
        </AppShell>
      </QueryClientProvider>
    )
    const { rerender } = render(layout(false))
    await user.type(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Route draft' }),
      'Keep this draft',
    )
    rerender(layout(true))
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Route draft' })
        .value,
    ).toBe('Keep this draft')
  })
})
