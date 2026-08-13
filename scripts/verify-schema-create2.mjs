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

  // Capture API responses
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/db/rpc/')) {
      const status = resp.status()
      if (status >= 400) {
        const body = await resp.text().catch(() => 'no body')
        console.log(
          `API ${status}: ${resp.url().split('/').pop()}: ${body.slice(0, 300)}`,
        )
      } else {
        console.log(`API ${status}: ${resp.url().split('/').pop()}`)
      }
    }
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

  // Delete the previous test schema first
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

  // Fill schema + 2 fields with a unique name
  await page.locator('#schema-name').fill('QA test schema 2')
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
  console.log('pressing Meta+Enter')
  await page.keyboard.press('Meta+Enter')
  await page.waitForTimeout(5000)

  const dialogVisible = await page.locator('[role="dialog"]').count()
  const errorText = await page
    .locator('[role="alert"]')
    .textContent()
    .catch(() => null)
  console.log('dialog still open:', dialogVisible > 0)
  console.log('error:', errorText)
  console.log('page url:', page.url())

  await page.screenshot({ path: '.amp/in/artifacts/schema-create-result2.png' })
  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
