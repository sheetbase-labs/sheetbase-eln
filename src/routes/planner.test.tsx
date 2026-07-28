/**
 * OPS-005 planner route tests: chrome, view tabs, filters, empty inspector,
 * and timeline selection.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlannerRoute } from './planner'

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
      <aside aria-label="Task">{inspector}</aside>
    </div>
  ),
}))

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

describe('PlannerRoute', () => {
  it('renders the Study Planner title and Add task action', () => {
    render(<PlannerRoute />)

    expect(screen.getByRole('button', { name: 'Add task' })).toBeTruthy()
    expect(screen.getByText('Study Planner')).toBeTruthy()
  })

  it('renders the Timeline, Calendar, List, Workload and Resource view tabs', () => {
    render(<PlannerRoute />)

    expect(screen.getByRole('button', { name: 'Timeline' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'List' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Workload' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resource view' })).toBeTruthy()
  })

  it('renders the Today navigation button', () => {
    render(<PlannerRoute />)

    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
  })

  it('renders the filter controls', () => {
    render(<PlannerRoute />)

    expect(screen.getByLabelText('Status')).toBeTruthy()
    expect(screen.getByLabelText('Priority')).toBeTruthy()
    expect(screen.getByLabelText('Assignee')).toBeTruthy()
    expect(screen.getByLabelText('Instrument')).toBeTruthy()
    expect(screen.getByLabelText('Workstream')).toBeTruthy()
  })

  it('shows the empty inspector hint when no task is selected', () => {
    render(<PlannerRoute />)

    expect(screen.getByText('No task selected')).toBeTruthy()
  })

  it('switches to the list view when List tab is clicked', async () => {
    const user = userEvent.setup()
    render(<PlannerRoute />)

    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(
      screen.getByText('No tasks yet. Use Add task to create one.'),
    ).toBeTruthy()
  })

  it('switches to the workload view when Workload tab is clicked', async () => {
    const user = userEvent.setup()
    render(<PlannerRoute />)

    await user.click(screen.getByRole('button', { name: 'Workload' }))
    expect(
      screen.getByText('No assigned tasks in the visible range.'),
    ).toBeTruthy()
  })

  it('switches to the resource view when Resource view tab is clicked', async () => {
    const user = userEvent.setup()
    render(<PlannerRoute />)

    await user.click(screen.getByRole('button', { name: 'Resource view' }))
    expect(
      screen.getByText(
        'No calendar resources configured. Create resources in Lab Calendar first.',
      ),
    ).toBeTruthy()
  })
})
