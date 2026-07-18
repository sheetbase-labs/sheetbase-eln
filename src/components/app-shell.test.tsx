import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Folder, Home, ListTodo } from 'lucide-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { APP_SHELL_MAIN_ID, APP_SHELL_NAV_ID, AppShell } from './app-shell'
import type { AppShellNavItem } from './app-shell'

// Stub auth-client so signOut never hits the network.
vi.mock('#/lib/auth-client', () => ({
  authClient: { signOut: vi.fn(() => Promise.resolve()) },
}))

// Theme provider stubs to a fixed value so the shell renders deterministically.
vi.mock('#/components/theme-provider', () => ({
  useTheme: () => ({
    theme: 'light' as const,
    setTheme: vi.fn(),
    density: 'comfortable' as const,
    setDensity: vi.fn(),
  }),
}))

// Stub the router hooks/Link the shell uses so no route tree is required.
let currentPathname = '/projects'
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
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
})

function renderShell(props: Parameters<typeof AppShell>[0]) {
  const user = userEvent.setup()
  const utils = render(<AppShell {...props} />)
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
    expect(screen.getByText('Projects').getAttribute('aria-current')).toBe(
      'page',
    )
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Home' })).toBeTruthy()
  })

  it('marks the active nav item with aria-current=page', () => {
    currentPathname = '/projects'
    const items: AppShellNavItem[] = [
      { to: '/', label: 'Home', icon: Home },
      { to: '/projects', label: 'Projects', icon: Folder },
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
      { to: '/tasks', label: 'Tasks', icon: ListTodo, disabled: true },
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

  it('opens the command palette with ⌘K and lists enabled nav items only', async () => {
    const items: AppShellNavItem[] = [
      { to: '/projects', label: 'Projects', icon: Folder },
      { to: '/tasks', label: 'Tasks', icon: ListTodo, disabled: true },
    ]
    const { user } = renderShell({
      context: baseContext,
      breadcrumbs: [{ label: 'Home' }],
      navSections: [{ items }],
      children: null,
    })
    await user.keyboard('{Meta>}k{/Meta}')
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('Projects')
    expect(dialog.textContent).not.toContain('Tasks')
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
})
