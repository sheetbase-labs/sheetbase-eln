import { expect, test } from 'playwright/test'
import type {
  ConnectorDiagnosticsResult,
  DiagnosticsResult,
  RunHealthResult,
} from '#/lib/admin-platform'
import { openSettings, serverFixtures } from './transport'

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
  goLive: {
    signIn: { open: true, methods: [] },
    email: { configured: false },
    backup: { source: 'none', lastBackupAt: null, unreadable: false },
  },
  schema: { appliedCount: 41, latestAppliedAt: null },
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

async function openDiagnostics(
  page: Parameters<typeof openSettings>[0],
  result = diagnostics,
  health: RunHealthResult | Error = runHealth,
  connectorResult: ConnectorDiagnosticsResult | Error = connectors,
) {
  const file = 'lib/admin-platform.ts'

  const transport = await serverFixtures(page, [
    {
      file: 'lib/help.ts',
      name: 'getHelpFn',
      method: 'GET',
      result: {
        release: {
          version: 'local',
          build: 'local',
          released: '',
          validation: {
            tone: 'warn',
            label: 'Development build',
            detail: 'Not validated.',
          },
          statement: 'Test deployment',
        },
        support: {
          hours: 'Weekdays',
          urgent: 'Contact support',
          diagnostics: [],
          notIncluded: 'No record contents.',
          integrated: false,
        },
      },
    },
    { file, name: 'fetchDiagnosticsFn', result },
    { file, name: 'fetchRunHealthFn', result: health },
    { file, name: 'fetchConnectorDiagnosticsFn', result: connectorResult },
  ])

  await openSettings(page, 'diagnostics')
  await expect(page.getByText('Database', { exact: true })).toBeVisible()

  return transport
}

const checkRow = (page: Parameters<typeof openSettings>[0], name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })

test('shows per-check last-run timestamps from the real record', async ({
  page,
}) => {
  const transport = await openDiagnostics(page)
  await expect(checkRow(page, 'Database').getByText(/Checked/)).toBeVisible()
  await expect(checkRow(page, 'Scheduler').getByText(/Last ran/)).toBeVisible()
  await expect(
    checkRow(page, 'Schema migration').getByText('No record yet'),
  ).toBeVisible()
  transport.assertExpected()
})

test('copies the failure row request ID to the actual clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const transport = await openDiagnostics(page)
  await expect(
    page.getByText(runId, { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible()
  await page
    .getByLabel(`Copy request ID ${runId}`)
    .filter({ visible: true })
    .first()
    .click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(runId)
  await expect(page.getByText(`Copied ${runId}`, { exact: true })).toBeVisible()
  transport.assertExpected()
})

test('shows the empty state when nothing has failed', async ({ page }) => {
  const transport = await openDiagnostics(page, diagnostics, {
    ...runHealth,
    failed: [],
  })

  await expect(page.getByText('No recent failures')).toBeVisible()
  transport.assertExpected()
})

test('keeps unmeasured checks saying so instead of healthy', async ({
  page,
}) => {
  const transport = await openDiagnostics(
    page,
    diagnostics,
    new Error('not available'),
    new Error('not available'),
  )

  await expect(
    checkRow(page, 'Connector deliveries').getByText('Not monitored'),
  ).toBeVisible()
  await expect(
    checkRow(page, 'Webhook deliveries').getByText('Not monitored'),
  ).toBeVisible()
  await expect(
    checkRow(page, 'Connector deliveries').getByText(
      /No check exists for this yet/,
    ),
  ).toBeVisible()
  transport.assertExpected()
})

test('shows the same request identity used by the run-log HTTP boundary', async ({
  page,
}) => {
  const transport = await openDiagnostics(page)
  await expect(page.getByText(runId, { exact: true }).first()).toHaveText(runId)
  transport.assertExpected()
})

const app = {
  enabled: true,
  frequency: 'daily',
  late: false,
  lastFailedAt: null,
  lastFailure: null,
  separate: true,
} satisfies NonNullable<DiagnosticsResult['goLive']['backup']['app']>

const backupCases: Array<{
  title: string
  backup: DiagnosticsResult['goLive']['backup']
  status: string
  detail?: RegExp
}> = [
  {
    title: 'says up to date when the schedule keeps up and copies are apart',
    backup: {
      source: 'app',
      lastBackupAt: '2026-10-11T03:00:00Z',
      unreadable: false,
      app,
    },
    status: 'Up to date',
  },
  {
    title: 'warns when copies sit in the same database',
    backup: {
      source: 'app',
      lastBackupAt: '2026-10-11T03:00:00Z',
      unreadable: false,
      app: { ...app, separate: false },
    },
    status: 'Same database',
    detail: /would be lost with it/,
  },
  {
    title: 'says the schedule is behind',
    backup: {
      source: 'app',
      lastBackupAt: '2026-10-01T03:00:00Z',
      unreadable: false,
      app: { ...app, late: true },
    },
    status: 'Out of date',
  },
  {
    title: 'shows a failed run with its reason',
    backup: {
      source: 'app',
      lastBackupAt: '2026-10-01T03:00:00Z',
      unreadable: false,
      app: {
        ...app,
        lastFailedAt: '2026-10-11T03:00:00Z',
        lastFailure: 'bucket unreachable',
      },
    },
    status: 'Failed',
    detail: /bucket unreachable/,
  },
  {
    title: 'says when no scheduled backup has been made yet',
    backup: { source: 'app', lastBackupAt: null, unreadable: false, app },
    status: 'Waiting for first backup',
  },
]

for (const entry of backupCases) {
  test(entry.title, async ({ page }) => {
    const transport = await openDiagnostics(page, {
      ...diagnostics,
      goLive: { ...diagnostics.goLive, backup: entry.backup },
    })

    const row = checkRow(page, 'Backups')
    await expect(row.getByText(entry.status, { exact: true })).toBeVisible()

    if (entry.detail) await expect(row.getByText(entry.detail)).toBeVisible()

    if (entry.status === 'Up to date')
      await expect(
        row.getByRole('link', { name: 'Backups and export' }),
      ).toBeVisible()
    transport.assertExpected()
  })
}
