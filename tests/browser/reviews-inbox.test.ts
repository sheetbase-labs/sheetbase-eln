import { expect, test } from 'playwright/test'

test('inbox lists work items, filters by type and fits the phone width', async ({
  page,
}) => {
  await page.route('**/api/db/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = []
    if (path.endsWith('/my_work_items'))
      body = [
        {
          kind: 'review_requested',
          record_id: 'record-1',
          identifier: 'EXP-001',
          title: 'Stability assay',
          project_id: 'project-1',
          reason: 'Review requested',
          // An item without a due date belongs to the collapsed "Later" group
          // (see groupWorkItems), so a needs-action row carries one.
          due_at: new Date().toISOString(),
          state: 'needs_action',
          created_at: '2026-09-06T10:00:00Z',
        },
      ]
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('/inbox')
  await expect(page.getByRole('tab', { name: /Needs action/ })).toBeVisible()
  await expect(page.getByText('Stability assay')).toBeVisible()
  await page.getByRole('button', { name: /^Reviews/ }).click()
  await expect(page.getByText('Stability assay')).toBeVisible()
  await page.screenshot({ path: '/tmp/inbox-desktop.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390)
  await expect(page.getByText('Stability assay')).toBeVisible()
  await page.screenshot({ path: '/tmp/inbox-mobile.png' })
})
