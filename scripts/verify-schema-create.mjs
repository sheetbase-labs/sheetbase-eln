import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'

const BASE = 'https://app.sheetbase.co.uk'
const TOKEN = 'wu1yGQvp5Ftw27nZCPKXDhN9g5NpzZVF'
const SECRET = 'dev-only-insecure-auth-secret-replace-me-0123456789'
const URL = `${BASE}/projects/00000000-0000-4000-8000-000000000202/experiments/00000000-0000-4000-8000-000000000317`
const signed = `${TOKEN}.${createHmac('sha256', SECRET).update(TOKEN).digest('base64')}`

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
    deviceScaleFactor: 2,
  })
  await context.addCookies([
    {
      name: '__Secure-better-auth.session_token',
      value: signed,
      domain: 'app.sheetbase.co.uk',
      path: '/',
      secure: true,
      sameSite: 'None',
      httpOnly: true,
    },
  ])
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('console:', m.text().slice(0, 200))
  })
  await page
    .goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch(() => {})
  await page.waitForTimeout(2800)
  if (page.url().includes('sign-in')) {
    console.log('SIGN-IN REDIRECT')
    await browser.close()
    process.exit(2)
  }

  // Open schema picker → create mode
  await page.locator('#notebook-add-block').first().click()
  await page.waitForTimeout(400)
  await page
    .locator('[role="menuitem"]')
    .filter({ hasText: 'Sheet' })
    .first()
    .click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Create schema on the fly' }).click()
  await page.waitForTimeout(600)

  // Fill schema + 2 fields
  await page.locator('#schema-name').fill('QA test schema')
  await page.waitForTimeout(150)
  const addField = page.getByRole('button', { name: 'Add field' })
  await addField.first().click()
  await page.waitForTimeout(100)
  await addField.first().click()
  await page.waitForTimeout(100)
  const li = page.locator('input[aria-label^="Field"][aria-label$="name"]')
  await li.nth(0).fill('replicate')
  await page.waitForTimeout(60)
  await li.nth(1).fill('titer')
  await page.waitForTimeout(60)

  // Submit with Cmd+Enter
  await page.keyboard.press('Meta+Enter')
  await page.waitForTimeout(3000)

  // Check if dialog closed (success) or error shown
  const dialogVisible = await page.locator('[role="dialog"]').count()
  const errorText = await page
    .locator('[role="alert"]')
    .textContent()
    .catch(() => null)
  console.log('dialog still open:', dialogVisible > 0)
  console.log('error:', errorText)
  console.log('page url:', page.url())

  await page.screenshot({ path: '.amp/in/artifacts/schema-create-result.png' })
  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
