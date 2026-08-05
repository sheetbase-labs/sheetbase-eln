/**
 * OPS-004 calendar route tests: chrome, view switcher, filters, empty
 * inspector, loading state, and error state.
 */
import { cleanup, render, screen } from '@testing-library/react'
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

/**
 * Mutable query state so individual tests can simulate loading and error
 * conditions without re-mocking the module.
 */
const queryState = {
  data: emptyData as unknown,
  isLoading: false,
  error: null as unknown,
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => queryState,
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
  queryState.data = emptyData
  queryState.isLoading = false
  queryState.error = null
})

describe('CalendarRoute', () => {
  it('renders the calendar title and new-booking action', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByText('Lab Calendar')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New booking' })).toBeTruthy()
  })

  it('renders the Today navigation button', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
  })

  it('renders the view switcher dropdown trigger', () => {
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByRole('button', { name: 'Select view' })).toBeTruthy()
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

  it('dims the calendar content when queries are loading', () => {
    queryState.isLoading = true
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    const loadingContent = document.querySelector('[data-loading="true"]')
    expect(loadingContent).toBeTruthy()
  })

  it('shows an error alert with retry when a query fails', () => {
    queryState.error = new Error('Network error')
    render(<ShellProvider><CalendarRoute /></ShellProvider>)

    expect(screen.getByText("Couldn't load calendar")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
