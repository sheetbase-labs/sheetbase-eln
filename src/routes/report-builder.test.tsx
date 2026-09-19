/**
 * OPS-007 report builder route tests: chrome, empty preview, empty inspector,
 * outline empty state, and the New report action.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellProvider } from '#/components/app-shell'
import type { ReportDefinition, ReportSection } from '#/lib/report-builder'
import { Route } from './report-builder'

const ReportBuilderRoute = Route.options.component as React.ComponentType

vi.mock('@tanstack/react-router', () => ({
  useMatches: () => [],
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
let reportData: ReportDefinition[] = []
let sectionsByReport: Record<string, ReportSection[]> = {}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    if (queryKey[1] === 'reports') return { data: reportData, isLoading: false }
    if (queryKey[1] === 'sections')
      return {
        data: sectionsByReport[queryKey[2]] ?? emptyData,
        isLoading: false,
      }
    return { data: emptyData, isLoading: false }
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
      <aside aria-label="Report">{inspector}</aside>
    </div>
  )
  const MockShellProvider = ({ children }: { children: React.ReactNode }) => {
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
  return { AppShell, ShellProvider: MockShellProvider, useShell }
})

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  reportData = []
  sectionsByReport = {}
})

const reports: ReportDefinition[] = [
  {
    id: 'report-1',
    workspaceId: 'workspace-1',
    projectId: null,
    recordId: null,
    templateRecordId: null,
    reviewSubmissionId: null,
    title: 'First report',
    subtitle: 'First report subtitle',
    documentIdentifier: 'RPT-2026-0001',
    status: 'draft',
    version: 1,
    lastSavedAt: '2026-08-06T12:00:00Z',
    createdAt: '2026-08-06T12:00:00Z',
    updatedAt: '2026-08-06T12:00:00Z',
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
  },
  {
    id: 'report-2',
    workspaceId: 'workspace-1',
    projectId: null,
    recordId: null,
    templateRecordId: null,
    reviewSubmissionId: null,
    title: 'Second report',
    subtitle: 'Second report subtitle',
    documentIdentifier: 'RPT-2026-0002',
    status: 'in_review',
    version: 2,
    lastSavedAt: '2026-08-06T12:00:00Z',
    createdAt: '2026-08-06T12:00:00Z',
    updatedAt: '2026-08-06T12:00:00Z',
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
  },
]

function section(reportId: string, title: string): ReportSection {
  return {
    id: `${reportId}-section`,
    workspaceId: 'workspace-1',
    reportId,
    position: 0,
    title,
    description: `${title} content`,
    sectionType: 'text',
    sourceType: 'free_text',
    sourceRevisionId: null,
    sourceRef: {},
    frozenPayload: {},
    validationStatus: 'pending',
    validationDetail: {},
    createdAt: '2026-08-06T12:00:00Z',
    updatedAt: '2026-08-06T12:00:00Z',
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
  }
}

describe('ReportBuilderRoute', () => {
  it('renders the Report Builder title', () => {
    render(
      <ShellProvider>
        <ReportBuilderRoute />
      </ShellProvider>,
    )
    expect(screen.getByText('Report Builder')).toBeTruthy()
  })

  it('renders the New report button', () => {
    render(
      <ShellProvider>
        <ReportBuilderRoute />
      </ShellProvider>,
    )
    expect(
      screen.getAllByRole('button', { name: /New report/i }).length,
    ).toBeGreaterThan(0)
  })

  it('shows the empty state when no reports exist', () => {
    render(
      <ShellProvider>
        <ReportBuilderRoute />
      </ShellProvider>,
    )
    expect(screen.getByText('No reports yet')).toBeTruthy()
  })

  it('shows the empty inspector hint when no report is selected', () => {
    render(
      <ShellProvider>
        <ReportBuilderRoute />
      </ShellProvider>,
    )
    expect(screen.getByText('No report selected.')).toBeTruthy()
  })

  it('previews the first report when none is explicitly selected', () => {
    reportData = reports
    sectionsByReport = {
      'report-1': [section('report-1', 'First report section')],
      'report-2': [section('report-2', 'Second report section')],
    }

    render(
      <ShellProvider>
        <ReportBuilderRoute />
      </ShellProvider>,
    )

    expect(screen.getAllByText('First report').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('First report section content').length,
    ).toBeGreaterThan(1)
    expect(
      screen.queryByText('Create or select a report to preview it here.'),
    ).toBeNull()
  })

  it('updates the preview when another report is selected', () => {
    reportData = reports
    sectionsByReport = {
      'report-1': [section('report-1', 'First report section')],
      'report-2': [section('report-2', 'Second report section')],
    }

    render(
      <ShellProvider>
        <ReportBuilderRoute />
      </ShellProvider>,
    )
    fireEvent.change(screen.getByLabelText('Select report'), {
      target: { value: 'report-2' },
    })

    expect(screen.getAllByText('Second report').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Second report section content').length,
    ).toBeGreaterThan(1)
    expect(screen.queryByText('First report section content')).toBeNull()
  })
})
