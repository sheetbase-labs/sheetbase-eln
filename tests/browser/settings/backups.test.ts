import { expect, test } from 'playwright/test'
import type { BackupsOverview } from '#/lib/workspace-backups'
import { openSettings, serverData, serverFixtures } from './transport'
import type { ServerFixture } from './transport'

const succeeded: BackupsOverview['backups'][number] = {
  id: 'b1',
  trigger: 'scheduled',
  status: 'succeeded',
  startedAt: '2026-10-29T03:00:00Z',
  finishedAt: '2026-10-29T03:01:00Z',
  destination: 'database',
  byteSize: 2_500_000,
  sha256: 'a'.repeat(64),
  tableCount: 30,
  rowCount: 1204,
  fileCount: 12,
  missingFileCount: 0,
  error: null,
}

function overview(overrides: Partial<BackupsOverview> = {}): BackupsOverview {
  return {
    settings: { enabled: true, frequency: 'daily', keepCount: 7 },
    backups: [succeeded],
    destination: { name: 's3', separate: true },
    ...overrides,
  }
}

const file = 'lib/workspace-backups.ts'

function read(result = overview()): ServerFixture {
  return { file, name: 'fetchBackupsFn', result }
}

test('offers the export and lists recent backups with a download', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [read()])
  await openSettings(page, 'backups')
  await expect(page.getByText('Download export')).toHaveAttribute(
    'href',
    '/api/export/workspace',
  )
  const table = page.getByRole('table')
  await expect(table.getByText('Scheduled', { exact: true })).toBeVisible()
  await expect(table.getByText('Done', { exact: true })).toBeVisible()
  await expect(table.getByText('1,204 rows, 12 files')).toBeVisible()
  await expect(page.getByLabel(/^Download backup from/)).toHaveAttribute(
    'href',
    '/api/export/workspace-backup/b1',
  )
  transport.assertExpected()
})

test('warns only when backups sit in the same database', async ({ page }) => {
  const fixture = read(
    overview({ destination: { name: 'database', separate: false } }),
  )

  const transport = await serverFixtures(page, [fixture])
  await openSettings(page, 'backups')
  await expect(page.getByText(/they would be lost together/)).toBeVisible()
  fixture.result = overview()
  await page.reload()
  await expect(
    page.getByText('Scheduled backups', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/they would be lost together/)).toHaveCount(0)
  transport.assertExpected()
})

test('saves a changed schedule', async ({ page }) => {
  const transport = await serverFixtures(page, [
    read(),
    { file, name: 'saveBackupSettingsFn', result: null },
  ])

  await openSettings(page, 'backups')
  await page.getByLabel('How often').selectOption('weekly')
  await page.getByLabel(/Copies to keep/).fill('14')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    page.getByText('Backup schedule saved', { exact: true }),
  ).toBeVisible()

  const saved = transport.calls.find(
    (call) => call.name === 'saveBackupSettingsFn',
  )

  expect(serverData(saved?.body ?? null)).toEqual({
    workspaceId: 'ws',
    enabled: true,
    frequency: 'weekly',
    keepCount: 14,
  })
  transport.assertExpected()
})

test('will not save copies outside 1 to 90', async ({ page }) => {
  const transport = await serverFixtures(page, [read()])
  await openSettings(page, 'backups')
  await page.getByLabel(/Copies to keep/).fill('200')
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled()
  expect(
    transport.calls.some((call) => call.name === 'saveBackupSettingsFn'),
  ).toBe(false)
  transport.assertExpected()
})

test('requests a backup and reports an already running backup', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    read(),
    {
      file,
      name: 'runBackupNowFn',
      result: { ok: false, reason: 'already_running' },
    },
  ])

  await openSettings(page, 'backups')
  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(
    page.getByText('A backup is already running', { exact: true }),
  ).toBeVisible()
  const run = transport.calls.find((call) => call.name === 'runBackupNowFn')
  expect(serverData(run?.body ?? null)).toEqual({ workspaceId: 'ws' })
  transport.assertExpected()
})

test('shows a failed run and missing files', async ({ page }) => {
  const transport = await serverFixtures(page, [
    read(
      overview({
        backups: [
          {
            ...succeeded,
            id: 'b2',
            status: 'failed',
            error: 'bucket unreachable',
            byteSize: null,
          },
          { ...succeeded, id: 'b3', missingFileCount: 2 },
        ],
      }),
    ),
  ])

  await openSettings(page, 'backups')
  await expect(page.getByText('Failed', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Done, 2 files missing', { exact: true }),
  ).toBeVisible()
  transport.assertExpected()
})

test('shows an empty state before the first backup', async ({ page }) => {
  const transport = await serverFixtures(page, [
    read(overview({ backups: [] })),
  ])

  await openSettings(page, 'backups')
  await expect(page.getByText('No backups yet', { exact: true })).toBeVisible()
  transport.assertExpected()
})

test('refuses a role without access without reading backups', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    {
      file: 'lib/workspace-admins.ts',
      name: 'getWorkspaceAdmins',
      method: 'GET',
      result: [],
    },
  ])

  await openSettings(page, 'backups', '&role=viewer')
  await expect(
    page.getByText('Only admins can open backups and export', { exact: true }),
  ).toBeVisible()
  expect(transport.calls.some((call) => call.name === 'fetchBackupsFn')).toBe(
    false,
  )
  transport.assertExpected()
})

test('keeps view-only access read-only', async ({ page }) => {
  const transport = await serverFixtures(page, [read()])
  await openSettings(page, 'backups', '&role=admin&backups=view')
  await expect(
    page.getByText('Scheduled backups', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back up now' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  )
  await expect(page.getByLabel('How often')).toBeDisabled()
  await expect(page.getByLabel(/^Download backup from/)).toHaveCount(0)
  transport.assertExpected()
})
