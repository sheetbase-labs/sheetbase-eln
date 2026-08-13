import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const ART = '.amp/in/artifacts'
mkdirSync(ART, { recursive: true })
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
  await page
    .goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch(() => {})
  await page.waitForTimeout(2800)
  if (page.url().includes('sign-in')) {
    console.log('SIGN-IN REDIRECT')
    await browser.close()
    process.exit(2)
  }

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

  const dialog = page.locator('[role="dialog"]').first()
  await page.locator('#schema-name').fill('Lentivirus stability panel')
  await page.waitForTimeout(150)

  // add 3 fields
  const addField = page.getByRole('button', { name: 'Add field' })
  for (let i = 0; i < 3; i++) {
    await addField.first().click()
    await page.waitForTimeout(90)
  }
  const labels = ['replicate', 'titer_iu_ml', 'pass_fail']
  const li = page.locator('input[aria-label^="Field"][aria-label$="name"]')
  for (let i = 0; i < labels.length; i++) {
    await li.nth(i).fill(labels[i])
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(200)

  // screenshot showing the ⌘↵ hint
  await dialog.screenshot({ path: `${ART}/schema-cmd-enter-hint.png` })
  console.log('saved schema-cmd-enter-hint.png')

  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
