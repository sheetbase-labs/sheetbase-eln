import { expect, test } from 'playwright/test'

test('review inbox searches, opens its inspector and reaches the review workspace', async ({
  page,
}) => {
  const revisionId = '68000000-0000-4000-8000-000000000098'
  await page.route('**/api/db/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = []
    if (path.endsWith('/review_submissions'))
      body = [
        {
          id: 'submission-1',
          record_id: 'record-1',
          revision_id: revisionId,
          state: 'submitted',
          workflow_definition_key: 'default-scientific-review',
          workflow_definition_version: 1,
          assigned_reviewer_user_ids: [],
          submitted_by_user_id: '',
          submitted_at: '2026-09-06T10:00:00Z',
        },
      ]
    else if (path.endsWith('/records'))
      body = [
        {
          id: 'record-1',
          project_id: 'project-1',
          kind: 'experiment',
          identifier: 'EXP-001',
          title: 'Stability assay',
          status: 'submitted',
          properties: {},
          tags: [],
          created_at: '2026-09-06T10:00:00Z',
          updated_at: '2026-09-06T10:00:00Z',
        },
      ]
    else if (path.endsWith('/projects'))
      body = [
        {
          id: 'project-1',
          key: 'STAB',
          title: 'Stability study',
          created_at: '2026-09-06T10:00:00Z',
        },
      ]
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('/reviews')
  const search = page.getByRole('searchbox', { name: 'Search review inbox' })
  await expect(
    page.getByRole('row').filter({ hasText: 'EXP-001' }),
  ).toBeVisible()
  await search.fill('missing')
  await expect(page.getByText('No matching reviews')).toBeVisible()
  await search.fill('Stability')
  await page.getByRole('row').filter({ hasText: 'EXP-001' }).click()
  await expect(
    page.getByRole('link', { name: 'Open review', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: '/tmp/reviews-inbox-desktop.png' })
  await page.getByRole('link', { name: 'Open review', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/reviews/${revisionId}`))
  await expect(
    page.getByRole('heading', { name: 'Review inbox', exact: true }),
  ).toHaveCount(0)
  await page.goto('/reviews')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('searchbox', { name: 'Search review inbox' }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390)
  await expect(
    page.getByRole('row').filter({ hasText: 'EXP-001' }),
  ).toBeVisible()
  await page.screenshot({ path: '/tmp/reviews-inbox-mobile.png' })
})
