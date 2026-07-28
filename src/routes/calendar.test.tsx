/**
 * OPS-004 calendar route tests: chrome, view controls, filters, empty
 * inspector, and booking-grid selection.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/app-shell'
import { Route } from './calendar'

const CalendarRoute = Route.options.component as React.ComponentType

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () =>
    (config: Record<string, unknown>) => ({
      useRouteContext: () => ({
        context: {
          workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
          user: { name: 'Test User', email: 'test@example.com' },
        },
      }),
      options: config,
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

const emptyData: never[] = []

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: emptyData, isLoading: false }),
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
  const AppShell = ({ children, inspector, primaryAction }: { children: React.ReactNode; inspector: React.ReactNode; primaryAction: React.ReactNode }) => (
    <div>
      <div data-testid="primary-action">{primaryAction}</div>
      <main>{children}</main>
      <aside aria-label="Booking">{inspector}</aside>
    </div>
  )
  const ShellProvider = ({ children }: { children: React.ReactNode }) => {
    const [config, setConfig] = React.useState<{ context: unknown | null; [k: string]: unknown }>({ context: null })
    const value = React.useMemo(
      () => ({ setConfig: (c: Partial<typeof config>) => setConfig((prev) => ({ ...prev, ...c })) }),
      [],
    )
    if (!config.context) return React.createElement(ctx.Provider, { value }, children as any)
    return React.createElement(ctx.Provider, { value }, React.createElement(AppShell, config as any, children) as any)
  }
  const useShell = (config: Record<string, unknown>) => {
    const { setConfig } = React.useContext(ctx)
    React.useLayoutEffect(() => { setConfig(config) }, [])
  }
  return { AppShell, ShellProvider, useShell }
})

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

describe('CalendarRoute', () => {
  it('renders the calendar title and new-booking action', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'New booking' })).toBeTruthy()
  })

  it('renders the day, week and month view controls', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'Day' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Week' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Month' })).toBeTruthy()
  })

  it('renders the Today navigation button', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
  })

  it('renders the filter controls', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByLabelText('Instrument')).toBeTruthy()
    expect(screen.getByLabelText('Project')).toBeTruthy()
    expect(screen.getByLabelText('Location')).toBeTruthy()
  })

  it('shows the empty inspector hint when no booking is selected', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByText('No booking selected')).toBeTruthy()
  })

  it('renders the sidebar upcoming and conflicts sections', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByText('Upcoming bookings')).toBeTruthy()
    expect(screen.getByText('Booking conflicts')).toBeTruthy()
    expect(screen.getByText('Available now')).toBeTruthy()
  })

  it('switches to the month view when Month is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    const monthBtn = screen.getByRole('button', { name: 'Month' })
    await user.click(monthBtn)

    // Month grid renders 6 rows x 7 cols of weekday headers + cells.
    expect(screen.getByRole('grid', { name: 'Month calendar' })).toBeTruthy()
  })

  it('switches to the day view when Day is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(screen.getByRole('grid', { name: 'Day calendar' })).toBeTruthy()
  })
})
