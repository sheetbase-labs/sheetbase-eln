/** ADMIN-001 workspace administration route tests. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/app-shell'
import { Route } from './admin'

const AdminRoute = Route.options.component as React.ComponentType
let pathname = '/admin/users'
const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({
      context: {
        workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
        user: { name: 'Test User', email: 'test@example.com' },
      },
    }),
    options: config,
  }),
  redirect: (options: unknown) => options,
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname } }),
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
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (...args: never[]) => unknown) => fn,
    }
    return chain
  },
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

vi.mock('#/components/app-shell', async () => {
  const React = await import('react')
  const ctx = React.createContext({ setConfig: (_c: any) => {} })
  const AppShell = ({
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
  )
  const ShellProvider = ({ children }: { children: React.ReactNode }) => {
    const [config, setConfig] = React.useState<{
      context: unknown | null
      [k: string]: unknown
    }>({ context: null })
    const value = React.useMemo(
      () => ({
        setConfig: (c: Partial<typeof config>) =>
          setConfig((prev) => ({ ...prev, ...c })),
      }),
      [],
    )
    if (!config.context)
      return React.createElement(ctx.Provider, { value }, children as any)
    return React.createElement(
      ctx.Provider,
      { value },
      React.createElement(AppShell, config as any, children) as any,
    )
  }
  const useShell = (config: Record<string, unknown>) => {
    const { setConfig } = React.useContext(ctx)
    React.useLayoutEffect(() => {
      setConfig(config)
    }, [])
  }
  return { AppShell, ShellProvider, useShell }
})

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  pathname = '/admin/users'
  navigate.mockReset()
})

describe('AdminRoute', () => {
  it('renders the dedicated Administration workspace', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Administration' })).toBeTruthy()
    expect(screen.getByLabelText('Administration sections')).toBeTruthy()
  })

  it('renders the Users subpage by default', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(
      screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByRole('heading', { name: 'Users' })).toBeTruthy()
  })

  it('renders the audit export action on the Activity subpage', () => {
    pathname = '/admin/activity'
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(screen.getByTestId('primary-action').textContent).toContain(
      'Export audit log',
    )
  })

  it('renders addressable links for every administration subpage', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    for (const label of [
      'Users',
      'Project access',
      'Sessions',
      'API credentials',
      'Activity',
      'Workspace settings',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy()
    }
    expect(screen.queryByRole('link', { name: 'Model fields' })).toBeNull()
  })

  it('does not mention scientific models in the header copy', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(screen.getByText(/Govern workspace access/)).toBeTruthy()
    expect(screen.queryByText(/scientific models/i)).toBeNull()
  })
})
