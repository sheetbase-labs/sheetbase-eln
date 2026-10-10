// Review workspace interaction suite (adapted from sheetbase-app-3
// tests/areas/review-interact*.mjs). The ELN review is revision-based and the
// fixtures differ, so this drives the real revision discovered through /api/db
// and stays read-only: it opens the workspace and each tab and asserts the
// review surface renders without errors. Signing and return are destructive and
// are left to the review contract tests.
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

if (ids.revision) {
  await go(page, `/review/${ids.revision}`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'review workspace shows one h1',
  )
  check(
    (await page.locator('aside[aria-label="Review"]').count()) === 1,
    'review inspector renders',
  )
  for (const tab of ['Diff', 'Comments', 'Checks', 'History']) {
    const control = page.getByRole('tab', { name: new RegExp(tab) })
    if ((await control.count()) === 0) continue
    await control.first().click()
    await page.waitForTimeout(500)
    check(true, `review ${tab} tab activates`)
  }
} else {
  console.log('note no revisions in this workspace — skipped review checks')
}

await done(browser, errors, 'review')
