import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

test.use({
  baseURL: process.env.HOME_TEST_BASE_URL ?? 'http://127.0.0.1:3100',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, '00000000-0000-4000-8000-000000000310')
  await page.clock.install({ time: new Date('2026-09-25T09:30:00+01:00') })
})

for (const theme of ['light', 'dark'] as const) {
  test(`Home ${theme} totals come from exact readable authorities`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => {
      localStorage.setItem('sheetbase-theme', value)
      localStorage.setItem('sheetbase.theme', value)
    }, theme)
    await page.goto('/')
    const summary = page.getByRole('navigation', { name: 'Summary' })
    await expect(summary).toBeVisible({ timeout: 20000 })
    const totals = await page.evaluate(async () => {
      const resources = [
        'my_work_items?kind=eq.review_requested&state=in.(needs_action,overdue)',
        'rpc/dataset_list_summary?issue_count=gt.0&archived_at=is.null',
        'records?kind=eq.experiment&status=eq.in_progress&deleted_at=is.null',
        'instrument_runs?started_at=gte.2026-09-24T23:00:00.000Z&started_at=lt.2026-09-25T23:00:00.000Z',
        'my_work_items?state=in.(needs_action,overdue)',
      ]
      return Promise.all(
        resources.map(async (resource) => {
          const response = await fetch(`/api/db/${resource}`, {
            headers: { prefer: 'count=exact', range: '0-0' },
          })
          if (!response.ok)
            throw new Error(`Count request failed: ${response.status}`)
          await response.text()
          const range = response.headers.get('content-range')
          if (!range || !/\/\d+$/.test(range))
            throw new Error('Missing exact total')
          return Number(range.split('/')[1])
        }),
      )
    })
    const labels = [
      'to review',
      'datasets? with errors',
      'experiments in progress',
      'instrument runs today',
      'items',
    ]
    for (let index = 0; index < totals.length; index++) {
      await expect(summary).toContainText(
        new RegExp(`${totals[index]} ${labels[index]}`),
      )
    }
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) })
    console.info(`Home exact totals (${theme}): ${totals.join(', ')}`)
  })
}

test('Home surfaces unavailable exact totals instead of zero or preview lengths', async ({
  page,
}, testInfo) => {
  await page.route('**/api/db/my_work_items?**', async (route) => {
    if (route.request().headers().prefer !== 'count=exact')
      return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[{}]',
    })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(
    'Home could not be loaded',
    { timeout: 20000 },
  )
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Summary' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('home-count-error.png') })
})
