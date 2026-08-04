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

const sampleResources: any[] = [
  {
    id: 'r1',
    workspace_id: 'workspace-1',
    project_id: null,
    name: 'Test instrument',
    code: 'TI-1',
    resource_type: 'instrument',
    location: 'Lab A',
    capacity: 1,
    timezone: 'UTC',
    status: 'active',
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by_user_id: null,
    updated_by_user_id: null,
  },
]

function sampleBookings(): any[] {
  const now = new Date()
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 0),
  )
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 11, 0),
  )
  return [
    {
      id: 'b1',
      workspace_id: 'workspace-1',
      resource_id: 'r1',
      project_id: null,
      title: 'Test booking',
      status: 'confirmed',
      all_day: false,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      timezone: 'UTC',
      location: null,
      color: 'blue',
      notes: null,
      linked_experiment_record_id: null,
      linked_experiment_identifier: null,
      linked_experiment_title: null,
      metadata_version: 1,
      cancelled_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ]
}

// Configurable query state so individual tests can exercise loading, error,
// and empty states without re-mocking the module.
let queryState: {
  bookings?: { data?: unknown[]; isLoading?: boolean; error?: unknown }
  resources?: { data?: unknown[]; isLoading?: boolean; error?: unknown }
} = {}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey.includes('bookings')) {
      const override = queryState.bookings
      return {
        data: override?.data ?? sampleBookings(),
        isLoading: override?.isLoading ?? false,
        error: override?.error ?? null,
        refetch: vi.fn(),
      }
    }
    if (queryKey.includes('resources')) {
      const override = queryState.resources
      return {
        data: override?.data ?? sampleResources,
        isLoading: override?.isLoading ?? false,
        error: override?.error ?? null,
        refetch: vi.fn(),
      }
    }
    return {
      data: emptyData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }
  },
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

afterEach(() => {
  cleanup()
  queryState = {}
})

describe('CalendarRoute', () => {
  it('renders the calendar title and new-booking action', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'New booking' })).toBeTruthy()
  })

  it('renders the day, week and month view controls', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    // ToggleGroup type="single" renders items as radios.
    expect(screen.getByRole('radio', { name: 'Day' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Week' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Month' })).toBeTruthy()
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

    const monthBtn = screen.getByRole('radio', { name: 'Month' })
    await user.click(monthBtn)

    // Month grid renders 6 rows x 7 cols of weekday headers + cells.
    expect(screen.getByRole('grid', { name: 'Month calendar' })).toBeTruthy()
  })

  it('switches to the day view when Day is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    await user.click(screen.getByRole('radio', { name: 'Day' }))
    expect(screen.getByRole('grid', { name: 'Day calendar' })).toBeTruthy()
  })

  it('renders the PageHeader title and description', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('heading', { name: 'Lab Calendar' })).toBeTruthy()
    expect(
      screen.getByText(
        'Bookings for instruments, rooms, and shared resources.',
      ),
    ).toBeTruthy()
  })

  it('shows skeleton placeholders while queries are loading', () => {
    queryState = {
      bookings: { isLoading: true },
      resources: { isLoading: true },
    }
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    // Loading skeletons render instead of the sidebar sections / grid.
    expect(screen.queryByText('Upcoming bookings')).toBeFalsy()
    expect(screen.queryByRole('grid')).toBeFalsy()
  })

  it('shows a destructive alert with a retry button on query error', () => {
    queryState = {
      bookings: { error: new Error('Network failed') },
    }
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('heading', { name: 'Couldn’t load calendar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('shows the empty state when no bookings match the range', () => {
    queryState = {
      bookings: { data: [] },
      resources: { data: sampleResources },
    }
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByText('No bookings in this range')).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeFalsy()
  })
})
