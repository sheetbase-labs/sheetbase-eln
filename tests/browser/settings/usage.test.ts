import { readFile } from 'node:fs/promises'
import { expect, test } from 'playwright/test'
import type { StorageOverviewResult, UsageResult } from '#/lib/admin-platform'
import { openSettings, serverFixtures } from './transport'

const GiB = 1024 * 1024 * 1024

function usage(overrides: Partial<UsageResult> = {}): UsageResult {
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

const file = 'lib/admin-platform.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/db/workspace_memberships?*', (route) =>
    route.fulfill({ json: [] }),
  )
})

test('shows measured meters and warning states against configured limits', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    { file, name: 'fetchUsageFn', result: usage() },
    { file, name: 'fetchStorageOverviewFn', result: storage },
  ])

  await openSettings(page, 'usage')
  await expect(
    page.getByLabel('Seats', { exact: true }).getByRole('progressbar'),
  ).toHaveAttribute('aria-valuenow', '90')
  await expect(
    page.getByLabel('Storage', { exact: true }).getByRole('progressbar'),
  ).toHaveAttribute('aria-valuenow', '86')
  await expect(
    page.getByLabel('Seats', { exact: true }).getByText('⚠ 90%'),
  ).toBeVisible()
  await expect(
    page.getByLabel('Storage', { exact: true }).getByText('⚠ 86%'),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: /Runs per month/ }),
  ).toHaveAttribute('aria-label', /Oct 2026: 33 runs/)
  transport.assertExpected()
})

test('shows only meters the deployment measures', async ({ page }) => {
  const transport = await serverFixtures(page, [
    { file, name: 'fetchUsageFn', result: usage() },
    { file, name: 'fetchStorageOverviewFn', result: storage },
  ])

  await openSettings(page, 'usage')
  await expect(page.getByLabel('Seats', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Storage', { exact: true })).toBeVisible()
  await expect(page.getByLabel('API calls')).toHaveCount(0)
  await expect(page.getByLabel('Run minutes')).toHaveCount(0)
  await expect(page.getByText(/not measured yet/i)).toHaveCount(0)
  await expect(page.getByText(/not built in this deployment/)).toHaveCount(0)
  transport.assertExpected()
})

test('shows honest empty states when nothing is recorded', async ({ page }) => {
  const transport = await serverFixtures(page, [
    { file, name: 'fetchUsageFn', result: usage({ members: 0, trend: [] }) },
    {
      file,
      name: 'fetchStorageOverviewFn',
      result: new Error('not available'),
    },
  ])

  await openSettings(page, 'usage')
  await expect(page.getByText('No members to break down yet')).toBeVisible()
  await expect(page.getByText('Nothing is stored yet')).toBeVisible()
  await expect(page.getByRole('img', { name: /Runs per month/ })).toHaveCount(0)
  transport.assertExpected()
})

test('shows no bars or thresholds without configured limits', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    {
      file,
      name: 'fetchUsageFn',
      result: usage({
        limits: {
          fileBytes: { byteLimit: null, atLimitBehaviour: null },
          seats: { seatLimit: null, atLimitBehaviour: null },
          enabledSchedules: { validatedScaleThreshold: 100 },
        },
      }),
    },
    {
      file,
      name: 'fetchStorageOverviewFn',
      result: {
        ...storage,
        quota: { byteLimit: null, atLimitBehaviour: null },
      },
    },
  ])

  await openSettings(page, 'usage')
  await expect(page.getByText(/No seat limit is configured/)).toBeVisible()
  await expect(page.getByText(/No storage quota is configured/)).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  transport.assertExpected()
})

test('downloads a real CSV and keeps its blob available past the click', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    { file, name: 'fetchUsageFn', result: usage() },
    { file, name: 'fetchStorageOverviewFn', result: storage },
  ])

  await openSettings(page, 'usage')
  const button = page.getByRole('button', { name: 'Export CSV', exact: true })
  await expect(button).toBeVisible()
  await page.clock.install()
  const pending = page.waitForEvent('download')
  await button.click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('sheetbase-usage.csv')
  expect(download.url()).toMatch(/^blob:/)
  const path = await download.path()

  if (!path) throw new Error('CSV download required')
  const csv = await readFile(path, 'utf8')
  expect(csv).toContain('"Seats","18"')
  expect(csv).toContain('"Runs 2026-10","33"')
  expect(
    await page.evaluate(
      async (url) => (await fetch(url)).headers.get('content-type'),
      download.url(),
    ),
  ).toBe('text/csv')
  await expect(
    page.getByText('sheetbase-usage.csv exported', { exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('[data-description]').filter({ hasText: /./ }),
  ).toBeVisible()
  await page.clock.fastForward(60_000)
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url)

        return true
      } catch {
        return false
      }
    }, download.url()),
  ).toBe(false)
  transport.assertExpected()
})
