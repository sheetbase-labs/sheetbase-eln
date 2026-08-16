import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const ART = '.amp/in/artifacts'
mkdirSync(ART, { recursive: true })
const BASE = process.env.BASE_URL || 'https://app.sheetbase.co.uk'
const TOKEN = process.env.SESSION_TOKEN || 'wu1yGQvp5Ftw27nZCPKXDhN9g5NpzZVF'
const SECRET =
  process.env.AUTH_SECRET ||
  'dev-only-insecure-auth-secret-replace-me-0123456789'
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

  // empty
  await dialog.screenshot({ path: `${ART}/schema-dialog-empty.png` })

  // add 5 fields
  const addField = page.getByRole('button', { name: 'Add field' })
  for (let i = 0; i < 5; i++) {
    await addField.first().click()
    await page.waitForTimeout(90)
  }
  const labels = [
    'replicate',
    'titer_iu_ml',
    'pass_fail',
    'sample_id',
    'operator',
  ]
  const li = page.locator('input[aria-label^="Field"][aria-label$="name"]')
  for (let i = 0; i < labels.length; i++) {
    await li.nth(i).fill(labels[i])
    await page.waitForTimeout(60)
  }
  // mark a couple required
  const reqs = page.locator('[role="checkbox"][aria-label$="required"]')
  await reqs.nth(0).click()
  await page.waitForTimeout(50)
  await reqs.nth(2).click()
  await page.waitForTimeout(50)
  await page.waitForTimeout(200)
  await dialog.screenshot({ path: `${ART}/schema-dialog-5fields.png` })

  // type menu open on row 2
  await page.locator('button[aria-label^="Field type:"]').nth(1).click()
  await page.waitForTimeout(450)
  await dialog.screenshot({ path: `${ART}/schema-dialog-type-menu.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // 20 fields
  const last = page
    .locator('input[aria-label^="Field"][aria-label$="name"]')
    .last()
  for (let i = 0; i < 15; i++) {
    await last.press('Enter')
    await page.waitForTimeout(45)
  }
  await page.waitForTimeout(250)
  await dialog.screenshot({ path: `${ART}/schema-dialog-20fields.png` })

  await browser.close()
  console.log('done')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
