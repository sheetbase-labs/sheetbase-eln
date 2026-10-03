import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppShell } from './app-shell'
import { setUserPreference } from '#/lib/user-preferences'

// `mod` is ⌘ on macOS, Ctrl elsewhere; pin the platform so the ⌘\ binding is
// exercised deterministically.
beforeAll(() => {
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  })
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
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
        me: { name: 'Gareth P.', initials: 'GP', role: 'Member' },
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
    expect(screen.getByText('Open the command palette')).toBeTruthy()
  })
})
