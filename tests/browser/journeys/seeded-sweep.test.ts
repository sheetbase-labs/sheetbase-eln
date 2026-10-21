/**
 * Seeded-data sweep: open every seeded experiment on every tab, as a scientist
 * would, and fail on a server error, a page error, or an error message on the
 * page. The journey specs mostly build their own rows; this one reads the rows
 * the design seed made (drafts, in review, approved, locked, on hold).
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { signIn, waitForHydration, withAdminDb } from './helpers'

test.setTimeout(600_000)
test.use({ viewport: { width: 1280, height: 900 } })

const TABS = [
  'notebook',
  'overview',
  'links',
  'results',
  'revisions',
  'signatures',
  'history',
]
const ERROR_TEXT =
  /something went wrong|could not load|couldn.t load|unexpected error|failed to fetch|internal server error/i

async function watch(page: Page, problems: string[], where: () => string) {
  page.on('pageerror', (e) =>
    problems.push(`${where()} pageerror ${e.message}`),
  )
  page.on('response', (r) => {
    if (r.status() >= 500)
      problems.push(`${where()} HTTP ${r.status()} ${r.url().slice(0, 120)}`)
  })
}

test('every seeded experiment opens on every tab without an error', async ({
  page,
}) => {
  await signIn(page)
  const experiments = await withAdminDb(
    async (db) =>
      (
        await db.query<{ id: string; identifier: string; status: string }>(
          `SELECT id, identifier, status FROM api.records
          WHERE kind = 'experiment' AND deleted_at IS NULL
          ORDER BY identifier`,
        )
      ).rows,
  )
  expect(experiments.length).toBeGreaterThan(10)
  const problems: string[] = []
  let current = ''
  await watch(page, problems, () => current)
  for (const exp of experiments) {
    for (const tab of TABS) {
      current = `${exp.identifier} (${exp.status}) /${tab}`
      await page.goto(`/experiments/${exp.id}/${tab}`)
      await waitForHydration(page)
      await page.waitForTimeout(700)
      const text = await page.locator('main').innerText()
      const hit = text.match(ERROR_TEXT)
      if (hit) problems.push(`${current} shows "${hit[0]}"`)
    }
  }
  expect(problems).toEqual([])
})
