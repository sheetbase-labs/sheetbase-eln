import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

/** The design's workspace owner; the inbox items below are mocked. */
const DESIGN_USER = '00000000-0000-4000-8000-000000000310'

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER)
})

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
  // The header's two actions must stay on screen, not just off its right edge:
  // on a single row they measured 408px wide at 390 (Mark all seen sat at
  // left=296 right=408), so the header row wraps below `md`.
  await expect(
    page.getByRole('button', { name: 'Notification settings' }),
  ).toBeInViewport()
  await expect(
    page.getByRole('button', { name: 'Mark all seen' }),
  ).toBeInViewport()
  await page.screenshot({ path: '/tmp/inbox-mobile.png' })

  // 320 is the narrowest phone the shell supports (see TopBar's WCAG 1.4.10
  // note); the header has to reflow into view there too, not clip.
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(320)
  await expect(page.getByText('Stability assay')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Notification settings' }),
  ).toBeInViewport()
  await expect(
    page.getByRole('button', { name: 'Mark all seen' }),
  ).toBeInViewport()
  await page.screenshot({ path: '/tmp/inbox-phone-320.png' })
})
