import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/shell'
import { Route } from './configure'

const ConfigureRoute = Route.options.component as React.ComponentType

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({
      context: {
        workspace: {
          id: 'workspace-1',
          name: 'Test workspace',
          role: 'steward',
        },
        user: { name: 'Steward', email: 'steward@example.com' },
      },
    }),
    useSearch: () => ({ kind: 'model' }),
    options: config,
  }),
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
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
  useInfiniteQuery: () => ({
    data: { pages: [] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('#/components/shell', async () => {
  const React = await import('react')
  const ctx = React.createContext({ setConfig: (_c: any) => {} })
  const AppShell = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
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

afterEach(cleanup)

describe('ConfigureRoute', () => {
  it('renders the dense configuration workspace', () => {
    render(
      <ShellProvider>
        <ConfigureRoute />
      </ShellProvider>,
    )
    expect(
      screen.getByRole('heading', { name: 'Models & schemas' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Configuration catalogue')).toBeTruthy()
    expect(screen.queryByText(/SCI-010/)).toBeNull()
    expect(
      screen.getByText(
        'Define record fields, dataset schemas and reusable structures.',
      ),
    ).toBeTruthy()
  })
})
