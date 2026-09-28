// Shell interaction suite (ported from sheetbase-app-3 tests/interactions.mjs):
// the New menu, the account appearance switch (and its persistence) and the
// search shortcut, against the ELN's real shell and routes.
import { check, discover, done, go, launch } from './helpers.mjs'

const { browser, page, errors } = await launch()
const ids = await discover()

await go(page, '/')
await page.getByRole('button', { name: 'New', exact: true }).click()
await page.waitForTimeout(300)
check(
  (await page.getByRole('menuitem', { name: /Sample/ }).count()) > 0 &&
    (await page.getByRole('menuitem', { name: /Project/ }).count()) > 0,
  'New menu opens with Sample and Project',
)
await page.keyboard.press('Escape')

const account = page.getByRole('button', { name: /^Account:/ })
await account.click()
await page.waitForTimeout(300)
const wasDark = await page.evaluate(() =>
  document.documentElement.classList.contains('dark'),
)
const target = wasDark ? 'Light' : 'Dark'
await page.getByRole('radio', { name: target, exact: true }).click()
await page.waitForTimeout(300)
const nowDark = await page.evaluate(() =>
  document.documentElement.classList.contains('dark'),
)
check(
  nowDark === (target === 'Dark'),
  `account appearance switches to ${target}`,
)
await page.keyboard.press('Escape')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
check(
  (await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  )) === nowDark,
  'appearance survives reload',
)
// Restore the original preference so the run leaves no side effects.
await account.click()
await page.waitForTimeout(200)
await page
  .getByRole('radio', { name: wasDark ? 'Dark' : 'Light', exact: true })
  .click()
await page.keyboard.press('Escape')

await go(page, '/')
await page.keyboard.press('Control+k')
await page.waitForTimeout(400)
check(
  await page.getByRole('dialog', { name: 'Search' }).isVisible(),
  'Ctrl+K opens the search palette',
)
if (ids.sampleIdentifier) {
  await page.keyboard.type(ids.sampleIdentifier)
  await page.waitForTimeout(900)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  check(
    /\/(records|samples|datasets|templates|sheets)\//.test(page.url()),
    'Search palette: Enter opens the first result',
  )
} else {
  check(false, 'Search palette: no sample identifier discovered')
}

await done(browser, errors, 'interactions')
