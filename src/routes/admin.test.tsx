/** ADMIN-001 workspace administration route tests. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminRoute } from './admin'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useRouteContext: () => ({
      context: {
        workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
        user: { name: 'Test User', email: 'test@example.com' },
      },
    }),
  }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('#/components/app-shell', () => ({
  AppShell: ({
    children,
    inspector,
    primaryAction,
  }: {
    children: React.ReactNode
    inspector: React.ReactNode
    primaryAction: React.ReactNode
  }) => (
    <div>
      <div data-testid="primary-action">{primaryAction}</div>
      <main>{children}</main>
      <aside aria-label="Member details">{inspector}</aside>
    </div>
  ),
}))

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

describe('AdminRoute', () => {
  it('renders the Workspace Settings & Permissions title', () => {
    render(<AdminRoute />)
    expect(screen.getByText('Workspace Settings & Permissions')).toBeTruthy()
  })

  it('renders the Users tab by default', () => {
    render(<AdminRoute />)
    expect(
      screen.getByRole('tab', { name: 'Users' }).getAttribute('data-state'),
    ).toBe('active')
  })

  it('renders the Export audit log primary action', () => {
    render(<AdminRoute />)
    expect(screen.getByTestId('primary-action').textContent).toContain(
      'Export audit log',
    )
  })

  it('renders all tab labels', () => {
    render(<AdminRoute />)
    for (const label of [
      'Users',
      'Project Access',
      'Sessions',
      'Activity',
      'Settings',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy()
    }
  })
})
