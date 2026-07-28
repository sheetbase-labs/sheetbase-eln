/**
 * OPS-007 report builder route tests: chrome, empty preview, empty inspector,
 * outline empty state, and the New report action.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/app-shell'
import { Route } from './report-builder'

const ReportBuilderRoute = Route.options.component as React.ComponentType

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
      <aside aria-label="Report">{inspector}</aside>
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

describe('ReportBuilderRoute', () => {
  it('renders the Report Builder title', () => {
    render(<ShellProvider><ReportBuilderRoute /></ShellProvider>)
    expect(screen.getByText('Report Builder')).toBeTruthy()
  })

  it('renders the New report button', () => {
    render(<ShellProvider><ReportBuilderRoute /></ShellProvider>)
    expect(screen.getByRole('button', { name: /New report/i })).toBeTruthy()
  })

  it('shows the empty preview state when no report is selected', () => {
    render(<ShellProvider><ReportBuilderRoute /></ShellProvider>)
    expect(
      screen.getByText('Create or select a report to preview it here.'),
    ).toBeTruthy()
  })

  it('shows the empty inspector hint when no report is selected', () => {
    render(<ShellProvider><ReportBuilderRoute /></ShellProvider>)
    expect(screen.getByText('No report selected.')).toBeTruthy()
  })

  it('shows the empty outline hint when no report exists', () => {
    render(<ShellProvider><ReportBuilderRoute /></ShellProvider>)
    expect(
      screen.getByText('Create a report to start building its outline.'),
    ).toBeTruthy()
  })
})
