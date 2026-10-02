// Shell interaction suite (ported from sheetbase-app-3 tests/interactions.mjs):
// the New menu, the account appearance switch (and its persistence) and the
// search shortcut, against the ELN's real shell and routes.
import { base, check, discover, done, go, launch } from './helpers.mjs'

const { browser, page, errors } = await launch()
const ids = await discover()
// The registry maps `mod` to ⌘ on macOS and Ctrl elsewhere (as the design says).
const paletteKey = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'

await go(page, '/')
await page.getByRole('button', { name: 'New', exact: true }).click()
await page.waitForTimeout(300)
const menuItems = await page.getByRole('menuitem').allTextContents()
check(
  ['Experiment', 'Sample', 'Project', 'Working sheet', 'Import data'].every(
    (label) => menuItems.some((text) => text.includes(label)),
  ),
  'New menu lists Experiment, Sample, Project, Working sheet and Import data',
)
await page.getByRole('menuitem', { name: /Sample/ }).click()
await page.waitForURL(/\/samples/, { timeout: 5000 }).catch(() => undefined)
await page.waitForTimeout(600)
check(
  (await page.getByRole('dialog').count()) > 0,
  'New menu Sample opens the register dialog',
)
await page.keyboard.press('Escape')

await go(page, '/')
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
await page.keyboard.press(paletteKey)
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

// SHELL-03: the single registry drives ?, the G sequence and suppression.
await go(page, '/')
await page.keyboard.press('?')
await page.waitForTimeout(500)
const shortcutsDialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
check(
  await shortcutsDialog.isVisible(),
  '? opens the keyboard-shortcuts dialog',
)
check(
  ((await shortcutsDialog.textContent()) ?? '').includes(
    'Open the command palette',
  ),
  'shortcuts dialog is generated from the registry',
)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check(
  !(await shortcutsDialog.isVisible().catch(() => false)),
  'Esc closes the shortcuts dialog',
)

// A shortcut is suppressed while typing in a field.
await go(page, '/')
await page.keyboard.press(paletteKey)
await page.waitForTimeout(500)
check(
  await page.getByRole('dialog', { name: 'Search' }).isVisible(),
  'palette reopens for the suppression check',
)
await page.keyboard.type('?')
await page.waitForTimeout(300)
check(
  !(await shortcutsDialog.isVisible().catch(() => false)),
  '? is suppressed while typing in the palette input',
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// G then H navigates Home.
await go(page, '/inbox')
await page.keyboard.press('g')
await page.waitForTimeout(150)
await page.keyboard.press('h')
await page.waitForTimeout(900)
check(new URL(page.url()).pathname === '/', 'G then H navigates Home')

// SHELL-02: a second open tab follows the change (cross-tab storage event).
const tabB = await page.context().newPage()
await tabB.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
await tabB.waitForTimeout(1200)
const tabBBefore = await tabB.evaluate(() =>
  document.documentElement.classList.contains('dark'),
)
await account.click()
await page.waitForTimeout(250)
await page.getByRole('radio', { name: target, exact: true }).click()
await page.waitForTimeout(700)
const tabBAfter = await tabB.evaluate(() =>
  document.documentElement.classList.contains('dark'),
)
check(
  tabBAfter === (target === 'Dark') && tabBAfter !== tabBBefore,
  'appearance change follows another open tab',
)
await tabB.close()

// SHELL-02: a separate browser context (another device) shows the same setting.
const otherDevice = await browser.newContext({
  viewport: { width: 1440, height: 900 },
})
const otherPage = await otherDevice.newPage()
await otherPage.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
await otherPage.waitForTimeout(1600)
check(
  (await otherPage.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  )) ===
    (target === 'Dark'),
  'appearance persists on another browser context',
)
await otherDevice.close()

// Restore the user's original preference.
await go(page, '/')
const restore = page.getByRole('button', { name: /^Account:/ })
await restore.click()
await page.waitForTimeout(400)
await page
  .getByRole('radio', { name: wasDark ? 'Dark' : 'Light', exact: true })
  .click({ timeout: 5000 })
  .catch(() => undefined)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// SHELL-01: the ported top bar carries the workspace switcher.
await go(page, '/')
const workspaceSwitch = page.getByRole('button', { name: 'Switch workspace' })
check(
  (await workspaceSwitch.count()) > 0,
  'top bar shows the workspace switcher',
)
await workspaceSwitch.first().click()
await page.waitForTimeout(400)
const workspaceItems = await page.getByRole('menuitem').allTextContents()
check(
  workspaceItems.some((text) => text.includes('Create workspace')),
  'workspace switcher lists the memberships',
)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await done(browser, errors, 'interactions')
