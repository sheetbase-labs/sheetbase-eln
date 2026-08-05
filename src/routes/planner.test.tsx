/**
 * OPS-005 planner route tests: chrome, view tabs, filters, empty inspector,
 * and timeline selection.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/app-shell'
import { Route } from './planner'

const PlannerRoute = Route.options.component as React.ComponentType

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
  useQuery: () => ({ data: emptyData, isLoading: false, error: null, refetch: vi.fn() }),
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
      <aside aria-label="Task">{inspector}</aside>
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

describe('PlannerRoute', () => {
  it('renders the Study Planner title and Add task action', () => {
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    // "Add task" appears in the PageHeader and the empty-state actions.
    const addTaskButtons = screen.getAllByRole('button', { name: 'Add task' })
    expect(addTaskButtons.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Study Planner')).toBeTruthy()
  })

  it('renders the Timeline, Calendar, List, Workload and Resource view tabs', () => {
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    // ToggleGroup with type="single" renders items as radio buttons.
    expect(screen.getByRole('radio', { name: 'Timeline' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Calendar' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'List' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Workload' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Resource view' })).toBeTruthy()
  })

  it('renders the Today navigation button', () => {
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
  })

  it('renders the filter controls', () => {
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    expect(screen.getByLabelText('Status')).toBeTruthy()
    expect(screen.getByLabelText('Priority')).toBeTruthy()
    expect(screen.getByLabelText('Assignee')).toBeTruthy()
    expect(screen.getByLabelText('Instrument')).toBeTruthy()
    expect(screen.getByLabelText('Workstream')).toBeTruthy()
  })

  it('shows the empty inspector hint when no task is selected', () => {
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    expect(screen.getByText('No task selected')).toBeTruthy()
  })

  it('switches to the list view when List tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    const listTab = screen.getByRole('radio', { name: 'List' })
    await user.click(listTab)
    expect(listTab.getAttribute('data-state')).toBe('on')
    // With no tasks, the route-level empty state shows.
    expect(screen.getByText('No tasks yet')).toBeTruthy()
  })

  it('switches to the workload view when Workload tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    const workloadTab = screen.getByRole('radio', { name: 'Workload' })
    await user.click(workloadTab)
    expect(workloadTab.getAttribute('data-state')).toBe('on')
    expect(screen.getByText('No tasks yet')).toBeTruthy()
  })

  it('switches to the resource view when Resource view tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ShellProvider><PlannerRoute /></ShellProvider>)

    const resourceTab = screen.getByRole('radio', { name: 'Resource view' })
    await user.click(resourceTab)
    expect(resourceTab.getAttribute('data-state')).toBe('on')
    expect(screen.getByText('No tasks yet')).toBeTruthy()
  })
})
