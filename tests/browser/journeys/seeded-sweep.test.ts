/**
 * Seeded-data sweep: open every seeded experiment on every tab, as a scientist
 * would, and fail on a server error, a page error, or an error message on the
 * page. The journey specs mostly build their own rows; this one reads the rows
 * the design seed made (drafts, in review, approved, locked, on hold).
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { signIn, withAdminDb } from './helpers'

test.setTimeout(300_000)
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

// One test per tab, each sweeping every sampled experiment, so the sweep
// spreads across workers instead of running as one long test.
test.describe.configure({ mode: 'parallel' })

async function sampledExperiments() {
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
  // Up to four of each state keeps the sweep to a few minutes.
  const perStatus = new Map<string, number>()
  return experiments.filter((exp) => {
    const n = perStatus.get(exp.status) ?? 0
    perStatus.set(exp.status, n + 1)
    return n < 4
  })
}

for (const tab of TABS) {
  test(`every seeded experiment opens on its ${tab} tab without an error`, async ({
    page,
  }) => {
    await signIn(page)
    const sample = await sampledExperiments()
    const problems: string[] = []
    let current = ''
    await watch(page, problems, () => current)
    for (const exp of sample) {
      current = `${exp.identifier} (${exp.status}) /${tab}`
      await page.goto(`/experiments/${exp.id}/${tab}`)
      await page.locator('main').waitFor()
      await page.waitForTimeout(1200)
      const text = await page.locator('main').innerText()
      const hit = text.match(ERROR_TEXT)
      if (hit) problems.push(`${current} shows "${hit[0]}"`)
    }
    expect(problems).toEqual([])
  })
}
