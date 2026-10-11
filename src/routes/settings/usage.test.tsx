import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StorageOverviewResult, UsageResult } from '#/lib/admin-platform'

import { Route } from './usage'

const mocks = vi.hoisted(() => ({
  usage: vi.fn(),
  storage: vi.fn(),
  members: vi.fn(),
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

vi.mock('#/components/v3/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('#/lib/data-client', () => ({ createDataClient: () => ({}) }))
vi.mock('#/lib/admin-platform', () => ({
  fetchUsageFn: mocks.usage,
  fetchStorageOverviewFn: mocks.storage,
}))
vi.mock('#/lib/workspace-admin', () => ({
  adminQueryKeys: { members: (id: string) => ['members', id] },
  fetchWorkspaceMembers: mocks.members,
  WORKSPACE_ROLE_LABELS: {
    owner: 'Owner',
    admin: 'Admin',
    scientist: 'Scientist',
  },
}))

const GiB = 1024 * 1024 * 1024

function usageResult(overrides: Partial<UsageResult> = {}): UsageResult {
  return {
    members: 18,
    records: 240,
    datasets: 6,
    datasetVersions: 40,
    files: 320,
    fileBytes: Math.round(8.6 * GiB),
    connectors: 2,
    pipelineDefinitions: 4,
    pipelineRuns: 120,
    connectorRuns: 30,
    trend: [
      { month: '2026-05', pipelineRuns: 10, connectorRuns: 2 },
      { month: '2026-06', pipelineRuns: 14, connectorRuns: 3 },
      { month: '2026-07', pipelineRuns: 20, connectorRuns: 4 },
      { month: '2026-08', pipelineRuns: 25, connectorRuns: 5 },
      { month: '2026-09', pipelineRuns: 28, connectorRuns: 6 },
      { month: '2026-10', pipelineRuns: 23, connectorRuns: 10 },
    ],
    limits: {
      fileBytes: {
        byteLimit: 10 * GiB,
        atLimitBehaviour: 'uploads are rejected once the quota is reached',
      },
      seats: {
        seatLimit: 20,
        atLimitBehaviour:
          'new members cannot be invited once the seat limit is reached',
      },
      enabledSchedules: { validatedScaleThreshold: 100 },
    },
    capacityWarnings: [],
    ...overrides,
  }
}

const storage: StorageOverviewResult = {
  fileCount: 320,
  fileBytes: Math.round(8.6 * GiB),
  datasetCount: 6,
  datasetVersionCount: 40,
  quota: {
    byteLimit: 10 * GiB,
    atLimitBehaviour: 'uploads are rejected once the quota is reached',
  },
  largestFiles: [],
  recentFiles: [],
}

function renderUsage() {
  const Component = Route.options.component
  if (!Component) throw new Error('Usage component required')
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

describe('R5-CONFIG-01 usage evidence', () => {
  it('shows measured meters against configured limits with warning states', async () => {
    mocks.usage.mockResolvedValue(usageResult())
    mocks.storage.mockResolvedValue(storage)
    mocks.members.mockResolvedValue([])

    renderUsage()

    const seats = (await screen.findByLabelText('Seats')).querySelector(
      '[role="progressbar"]',
    )
    const storageMeter = screen
      .getByLabelText('Storage')
      .querySelector('[role="progressbar"]')
    expect(seats?.getAttribute('aria-valuenow')).toBe('90')
    expect(storageMeter?.getAttribute('aria-valuenow')).toBe('86')
    // ≥90 danger on seats, ≥80 warning on storage.
    expect(
      within(screen.getByLabelText('Seats')).getByText('⚠ 90%'),
    ).toBeTruthy()
    expect(
      within(screen.getByLabelText('Storage')).getByText('⚠ 86%'),
    ).toBeTruthy()
    // The trend is the measured series, with the full series in the label.
    expect(
      screen
        .getByRole('img', { name: /Runs per month/ })
        .getAttribute('aria-label'),
    ).toContain('Oct 2026: 33 runs')
  })

  it('keeps unmeasured meters saying so, with no bar or number', async () => {
    mocks.usage.mockResolvedValue(usageResult())
    mocks.storage.mockResolvedValue(storage)
    mocks.members.mockResolvedValue([])

    renderUsage()

    const api = await screen.findByLabelText('API calls')
    const minutes = screen.getByLabelText('Run minutes')
    expect(within(api).getByText('Not measured yet')).toBeTruthy()
    expect(within(minutes).getByText('Not measured yet')).toBeTruthy()
    expect(api.querySelector('[role="progressbar"]')).toBeNull()
    expect(minutes.querySelector('[role="progressbar"]')).toBeNull()
    expect(
      screen.getAllByText(
        /Per-token call metering is not built in this deployment/,
      ).length,
    ).toBeGreaterThan(0)
  })

  it('shows the honest empty states when nothing is recorded', async () => {
    mocks.usage.mockResolvedValue(usageResult({ members: 0, trend: [] }))
    mocks.storage.mockRejectedValue(new Error('not available'))
    mocks.members.mockResolvedValue([])

    renderUsage()

    expect(
      await screen.findByText('No members to break down yet.'),
    ).toBeTruthy()
    expect(screen.getByText('Storage is not measured yet.')).toBeTruthy()
    // No measured trend → no sparkline.
    expect(screen.queryByRole('img', { name: /Runs per month/ })).toBeNull()
  })

  it('shows no bars or thresholds when no limit is configured', async () => {
    mocks.usage.mockResolvedValue(
      usageResult({
        limits: {
          fileBytes: { byteLimit: null, atLimitBehaviour: null },
          seats: { seatLimit: null, atLimitBehaviour: null },
          enabledSchedules: { validatedScaleThreshold: 100 },
        },
      }),
    )
    mocks.storage.mockResolvedValue({
      ...storage,
      quota: { byteLimit: null, atLimitBehaviour: null },
    })
    mocks.members.mockResolvedValue([])

    renderUsage()

    await screen.findByLabelText('Seats')
    expect(screen.getByText(/No seat limit is configured/)).toBeTruthy()
    expect(screen.getByText(/No storage quota is configured/)).toBeTruthy()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
  })
})
