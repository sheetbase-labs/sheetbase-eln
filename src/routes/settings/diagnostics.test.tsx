import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ConnectorDiagnosticsResult,
  DiagnosticsResult,
  RunHealthResult,
} from '#/lib/admin-platform'
import type { DataClient } from '#/lib/data-client'
import { listPipelineRunLogs } from '#/lib/pipelines/data'

import { Route } from './diagnostics'

const mocks = vi.hoisted(() => ({
  diagnostics: vi.fn(),
  runHealth: vi.fn(),
  connectors: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'admin', name: 'Admin', email: 'admin@sheetbase.test' },
        workspace: { id: 'ws', name: 'Workspace', role: 'owner' },
      },
    }),
    useSearch: () => ({}),
  }),
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: string
    children?: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/help', () => ({ useHelp: () => undefined }))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('#/lib/admin-platform', () => ({
  fetchDiagnosticsFn: mocks.diagnostics,
  fetchRunHealthFn: mocks.runHealth,
  fetchConnectorDiagnosticsFn: mocks.connectors,
}))

const runId = '11111111-1111-4111-8111-111111111111'

const diagnostics: DiagnosticsResult = {
  checkedAt: '2026-10-11T10:10:00Z',
  lastPipelineRunAt: '2026-10-11T09:30:00Z',
  lastConnectorRunAt: '2026-10-10T18:00:00Z',
  lastWebhookDeliveryAt: '2026-10-11T08:00:00Z',
  health: {
    status: 'ready',
    database: { ok: true, latencyMs: 3 },
    postgrest: { ok: true, latencyMs: 7 },
  },
  deployment: {
    environment: 'development',
    artifactVersion: 'local',
    artifactDigest: 'sha256:abcdef012345',
    expectedMigration: 'untracked',
    secretSource: 'local-env',
  },
  migration: { status: 'not_checked', expected: 'untracked', applied: null },
  scheduler: {
    enabled: true,
    lastSweepAt: '2026-10-11T10:05:00Z',
    sweepIntervalSeconds: 60,
    enabledScheduleCount: 2,
    recoveredStaleCount: 0,
  },
  datasetRetention: {
    enabled: true,
    lastPrunedAt: null,
    intervalSeconds: 3600,
    prunedSnapshots24h: 0,
  },
  pipelineExecutor: {
    activeRuns: 0,
    recentFailures: 0,
    executionTimeoutSeconds: 900,
    rowCap: 5000,
    inputCap: 5000,
  },
  config: {
    fileBackend: 'local',
    authMode: 'dev_auth_free',
    externalApiEnabled: true,
    connectorSecretEncryptionConfigured: true,
    metricsEnabled: false,
    collaborationEnabled: false,
  },
}

const runHealth: RunHealthResult = {
  running: [],
  failed: [
    {
      id: runId,
      kind: 'pipeline',
      status: 'failed',
      startedAt: '2026-10-11T09:00:00Z',
      finishedAt: '2026-10-11T09:02:00Z',
      error_code: 'input_schema_mismatch',
      error_message: 'Column "temperature" is missing.',
      connectorId: null,
      definitionVersionId: 'ver-1',
      subscriptionId: null,
      label: null,
    },
  ],
  recentlySucceeded: [],
  webhook: { deadLetter24h: 0, retryDebt: 0, autoDisabled: 0 },
  counts: { running: 0, failed: 1, recentlySucceeded: 0 },
}

const connectors: ConnectorDiagnosticsResult = {
  activeConnectors: 1,
  pausedConnectors: 0,
  recentFailures: 0,
  missingSecrets: 0,
  repeatedFailures: 0,
  connectors: [],
}

function renderDiagnostics() {
  const Component = Route.options.component
  if (!Component) throw new Error('Diagnostics component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R5-CONFIG-01 diagnostics evidence', () => {
  it('shows a per-check last-run timestamp from the real record', async () => {
    mocks.diagnostics.mockResolvedValue(diagnostics)
    mocks.runHealth.mockResolvedValue(runHealth)
    mocks.connectors.mockResolvedValue(connectors)

    renderDiagnostics()

    const database = (await screen.findByText('Database')).closest('li')
    const scheduler = screen.getByText('Scheduler').closest('li')
    if (!database || !scheduler) throw new Error('check rows required')
    // Live probe → "Checked"; record-backed check → "Last ran".
    expect(within(database).getByText(/Checked/)).toBeTruthy()
    expect(within(scheduler).getByText(/Last ran/)).toBeTruthy()
    // Migration is not checked here, so it must not claim a timestamp.
    const migration = screen.getByText('Schema migration').closest('li')
    if (!migration) throw new Error('migration row required')
    expect(within(migration).getByText('No record yet')).toBeTruthy()
  })

  it('populates the failure row with a copyable request ID', async () => {
    mocks.diagnostics.mockResolvedValue(diagnostics)
    mocks.runHealth.mockResolvedValue(runHealth)
    mocks.connectors.mockResolvedValue(connectors)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderDiagnostics()

    expect((await screen.findAllByText(runId)).length).toBeGreaterThan(0)
    const copy = screen.getAllByLabelText(`Copy request ID ${runId}`)[0]
    await userEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith(runId)
    expect(mocks.toast).toHaveBeenCalledWith(`Copied ${runId}`)
  })

  it('shows the empty state when nothing has failed', async () => {
    mocks.diagnostics.mockResolvedValue(diagnostics)
    mocks.runHealth.mockResolvedValue({ ...runHealth, failed: [] })
    mocks.connectors.mockResolvedValue(connectors)

    renderDiagnostics()

    expect(await screen.findByText('No recent failures')).toBeTruthy()
  })

  it('keeps unmeasured checks saying so instead of healthy', async () => {
    mocks.diagnostics.mockResolvedValue(diagnostics)
    mocks.runHealth.mockRejectedValue(new Error('not available'))
    mocks.connectors.mockRejectedValue(new Error('not available'))

    renderDiagnostics()

    const connectorRow = (
      await screen.findByText('Connector deliveries')
    ).closest('li')
    const webhookRow = screen.getByText('Webhook deliveries').closest('li')
    if (!connectorRow || !webhookRow) throw new Error('check rows required')
    expect(within(connectorRow).getByText('Not monitored')).toBeTruthy()
    expect(within(webhookRow).getByText('Not monitored')).toBeTruthy()
    expect(
      within(connectorRow).getByText(/No check exists for this yet/),
    ).toBeTruthy()
  })

  it('resolves a shown request ID to the same request in the run logs', async () => {
    mocks.diagnostics.mockResolvedValue(diagnostics)
    mocks.runHealth.mockResolvedValue(runHealth)
    mocks.connectors.mockResolvedValue(connectors)

    renderDiagnostics()

    // The id rendered in diagnostics…
    const shown = (await screen.findAllByText(runId))[0]?.textContent ?? ''
    expect(shown).toBe(runId)

    // …is the same identity the run logs are keyed by.
    const calls: Array<{ resource: string; query?: string }> = []
    const client = {
      list: async (resource: string, query?: string) => {
        calls.push({ resource, query })
        return []
      },
    } as unknown as DataClient
    await listPipelineRunLogs(client, shown)
    expect(calls[0]?.resource).toBe('pipeline_run_logs')
    expect(calls[0]?.query).toContain(`run_id=eq.${encodeURIComponent(runId)}`)
  })
})
