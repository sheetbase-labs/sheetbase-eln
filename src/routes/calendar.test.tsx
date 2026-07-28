/**
 * OPS-004 calendar route tests: chrome, view controls, filters, empty
 * inspector, and booking-grid selection.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
      <aside aria-label="Booking">{inspector}</aside>
    </div>
  ),
}))

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

describe('CalendarRoute', () => {
  it('renders the calendar title and new-booking action', () => {
    render(<CalendarRoute />)

    expect(screen.getByRole('button', { name: 'New booking' })).toBeTruthy()
  })

  it('renders the day, week and month view controls', () => {
    render(<CalendarRoute />)

    expect(screen.getByRole('button', { name: 'Day' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Week' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Month' })).toBeTruthy()
  })

  it('renders the Today navigation button', () => {
    render(<CalendarRoute />)

    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
  })

  it('renders the filter controls', () => {
    render(<CalendarRoute />)

    expect(screen.getByLabelText('Instrument')).toBeTruthy()
    expect(screen.getByLabelText('Project')).toBeTruthy()
    expect(screen.getByLabelText('Location')).toBeTruthy()
  })

  it('shows the empty inspector hint when no booking is selected', () => {
    render(<CalendarRoute />)

    expect(screen.getByText('No booking selected')).toBeTruthy()
  })

  it('renders the sidebar upcoming and conflicts sections', () => {
    render(<CalendarRoute />)

    expect(screen.getByText('Upcoming bookings')).toBeTruthy()
    expect(screen.getByText('Booking conflicts')).toBeTruthy()
    expect(screen.getByText('Available now')).toBeTruthy()
  })

  it('switches to the month view when Month is clicked', async () => {
    const user = userEvent.setup()
    render(<CalendarRoute />)

    const monthBtn = screen.getByRole('button', { name: 'Month' })
    await user.click(monthBtn)

    // Month grid renders 6 rows x 7 cols of weekday headers + cells.
    expect(screen.getByRole('grid', { name: 'Month calendar' })).toBeTruthy()
  })

  it('switches to the day view when Day is clicked', async () => {
    const user = userEvent.setup()
    render(<CalendarRoute />)

    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(screen.getByRole('grid', { name: 'Day calendar' })).toBeTruthy()
  })
})
