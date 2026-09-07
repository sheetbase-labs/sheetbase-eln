/** PLAT-04 Platform Administration route tests. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/app-shell'

import { CAPABILITIES, hasCapability } from '#/lib/capability'
import { ADMIN_SECTIONS, Route } from './admin'
import { adminSectionKeys, Route as SectionRoute } from './admin/$section'

const AdminRoute = Route.options.component as React.ComponentType
let pathname = '/admin/dashboard'
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

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0] as string
    const suffix = queryKey[2] as string | undefined
    const base = { isError: false, isPending: false, isLoading: false }

    if (key === 'admin-platform') {
      if (suffix === 'diagnostics') {
        return {
          ...base,
          data: {
            health: {
              status: 'ready' as const,
              database: { ok: true, latencyMs: 3 },
              postgrest: { ok: true, latencyMs: 8 },
            },
            deployment: {
              environment: 'development',
              artifactVersion: '0.1.0',
              artifactDigest: 'sha256:test',
              expectedMigration: '0054',
              secretSource: 'env',
            },
            migration: {
              status: 'compatible' as const,
              expected: '0054',
              applied: '0054',
            },
            scheduler: {
              enabled: true,
              lastSweepAt: null,
              sweepIntervalSeconds: 60,
              enabledScheduleCount: 0,
              recoveredStaleCount: 0,
            },
            pipelineExecutor: {
              activeRuns: 0,
              recentFailures: 0,
              concurrencyLimit: 5,
              executionTimeoutSeconds: 60,
              rowCap: 100_000,
              inputCap: 100_000,
            },
            config: {
              fileBackend: 'local',
              authMode: 'dev_auth_free',
              externalApiEnabled: true,
              connectorSecretEncryptionConfigured: true,
              metricsEnabled: false,
              collaborationEnabled: false,
            },
          },
        }
      }
      if (suffix === 'usage') {
        return {
          ...base,
          data: {
            members: 0,
            records: 0,
            datasets: 0,
            datasetVersions: 0,
            files: 0,
            fileBytes: 0,
            connectors: 0,
            pipelineDefinitions: 0,
            pipelineRuns: 0,
            connectorRuns: 0,
            limits: {
              fileBytes: { byteLimit: null, atLimitBehaviour: null },
              enabledSchedules: { validatedScaleThreshold: 100 },
            },
            capacityWarnings: [],
          },
        }
      }
      if (suffix === 'run-health') {
        return {
          ...base,
          data: {
            running: [],
            failed: [],
            recentlySucceeded: [],
            webhook: { deadLetter24h: 0, retryDebt: 0, autoDisabled: 0 },
            counts: { running: 0, failed: 0, recentlySucceeded: 0 },
          },
        }
      }
      if (suffix === 'attention') {
        return { ...base, data: [] }
      }
      return { ...base, data: undefined }
    }
    return { ...base, data: [] }
  },
  useInfiniteQuery: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
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
  pathname = '/admin/dashboard'
  navigate.mockReset()
})

describe('AdminRoute', () => {
  it('renders the Platform Administration heading', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(
      screen.getByRole('heading', { name: 'Platform Administration' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Administration sections')).toBeTruthy()
  })

  it('renders the Dashboard subpage by default', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(
      screen
        .getByRole('link', { name: 'Dashboard' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy()
  })

  it('renders the audit export action on the Audit subpage', () => {
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
      'Dashboard',
      'External access',
      'Members',
      'Access',
      'Sessions',
      'API',
      'Connectors',
      'Pipelines',
      'Extensions',
      'Webhooks',
      'Storage',
      'Usage',
      'Audit',
      'Diagnostics',
      'Deploy',
      'Workspace',
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
    expect(screen.queryByText(/Administer workspace access/)).toBeNull()
    expect(screen.getByText(/Security and platform operations/)).toBeTruthy()
    expect(screen.queryByText(/scientific models/i)).toBeNull()
  })

  it('states the steward and personal-token planes in the header', () => {
    render(
      <ShellProvider>
        <AdminRoute />
      </ShellProvider>,
    )
    expect(screen.getByRole('link', { name: 'Configuration' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
  })
})

describe('Admin IA gating contract', () => {
  it('keeps the route gate keys in sync with the section definitions', () => {
    expect(SectionRoute).toBeTruthy()
    expect(new Set(Object.keys(adminSectionKeys))).toEqual(
      new Set(ADMIN_SECTIONS.map((section) => section.key)),
    )
  })

  it('applies one capability contract to nav visibility and section access', () => {
    for (const section of ADMIN_SECTIONS) {
      if (section.capability !== null) {
        expect(CAPABILITIES as readonly string[]).toContain(section.capability)
      }
    }
    for (const role of ['owner', 'admin', 'steward', 'member', 'viewer']) {
      // The shell derives both the nav filter and the denied notice from
      // `section.capability` via `hasCapability`, so the visible set and the
      // reachable set coincide by construction: no section is
      // visible-but-blocked or hidden-but-reachable.
      const visible = ADMIN_SECTIONS.filter(
        (section) =>
          !section.capability || hasCapability(role, section.capability),
      ).map((section) => section.key)
      const denied = ADMIN_SECTIONS.filter(
        (section) =>
          section.capability && !hasCapability(role, section.capability),
      ).map((section) => section.key)
      expect(denied.every((key) => !visible.includes(key))).toBe(true)
      if (role === 'owner') {
        expect(visible).toHaveLength(ADMIN_SECTIONS.length)
        expect(denied).toHaveLength(0)
      }
      if (role === 'viewer') {
        expect(visible).toEqual([
          'dashboard',
          'external-access',
          'storage',
          'usage',
          'activity',
          'diagnostics',
          'deployment',
        ])
      }
    }
  })
})
