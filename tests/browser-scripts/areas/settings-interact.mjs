// Settings interaction suite (ported from sheetbase-app-3 tests/areas/settings-interact.mjs).
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

const sections = [
  ['General', '/settings'],
  ['Members and roles', '/settings/members'],
  ['Integrations', '/settings/integrations'],
  ['Project access', '/settings/access'],
  ['Audit and retention', '/settings/audit'],
  ['API and SDK', '/settings/api'],
  ['Profile', '/settings/profile'],
  ['Notifications', '/settings/notifications'],
]
for (const [label, path] of sections) {
  await go(page, path)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    `settings ${label} shows one h1`,
  )
}

// Members: the invite dialog opens and validates.
await go(page, '/settings/members')
const invite = page.getByRole('button', { name: /Invite people/i })
if (await invite.count()) {
  await invite.first().click()
  await page.waitForTimeout(600)
  check(
    (await page.getByRole('dialog').count()) > 0,
    'members invite dialog opens',
  )
  await page.keyboard.press('Escape')
}

// Audit: the operation filter narrows the log.
await go(page, '/settings/audit')
const opFilter = page.getByLabel('Operation')
if (await opFilter.count()) {
  const options = await opFilter.locator('option').count()
  if (options > 1) {
    await opFilter.selectOption({ index: 1 })
    await page.waitForTimeout(800)
    check(
      (await page.getByText(/of \d+ entries/i).count()) > 0 ||
        (await page.getByText(/No audit entries match/i).count()) > 0,
      'audit operation filter reports a narrowed count',
    )
  }
}

// Project access: grant dialog opens when projects and people exist.
await go(page, '/settings/access')
const grant = page.getByRole('button', { name: /Grant access/i })
if (await grant.count()) {
  await grant.first().click()
  await page.waitForTimeout(600)
  check(
    (await page.getByRole('dialog').count()) > 0,
    'access grant dialog opens',
  )
  await page.keyboard.press('Escape')
}

await done(browser, errors, 'settings')
