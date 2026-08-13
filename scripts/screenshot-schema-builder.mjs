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
const PROJECT = '00000000-0000-4000-8000-000000000202'
const EXPERIMENT = '00000000-0000-4000-8000-000000000317'
const URL = `${BASE}/projects/${PROJECT}/experiments/${EXPERIMENT}`

// better-auth signed cookie: value = `${token}.${base64(HMAC_SHA256(secret, token))}`
const signed = `${TOKEN}.${createHmac('sha256', SECRET).update(TOKEN).digest('base64')}`

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
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
    {
      name: 'better-auth.session_token',
      value: signed,
      domain: 'app.sheetbase.co.uk',
      path: '/',
      secure: false,
      sameSite: 'Lax',
      httpOnly: true,
    },
  ])
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error')
      console.log('console.error:', m.text().slice(0, 160))
  })

  console.log('navigating to', URL)
  await page
    .goto(URL, { waitUntil: 'networkidle', timeout: 45000 })
    .catch((e) => console.log('goto warn:', e.message))
  await page.waitForTimeout(2800)

  if (page.url().includes('sign-in')) {
    console.log('REDIRECTED TO SIGN-IN — cookie not accepted')
    await page.screenshot({ path: `${ART}/schema-sign-in-redirect.png` })
    await browser.close()
    process.exit(2)
  }
  console.log('loaded, url:', page.url())

  // Click "Add block" then choose "Sheet" to open the schema picker.
  const addBtn = page.locator('#notebook-add-block')
  console.log('add-block count:', await addBtn.count())
  if (await addBtn.count()) {
    await addBtn
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {})
    await addBtn.first().click()
    await page.waitForTimeout(500)
    await page
      .locator('[role="menuitem"]')
      .filter({ hasText: 'Sheet' })
      .first()
      .click()
    await page.waitForTimeout(900)
  }

  // Click "Create schema on the fly".
  const createOpt = page.getByRole('button', {
    name: 'Create schema on the fly',
  })
  console.log('create-opt count:', await createOpt.count())
  if (await createOpt.count()) {
    await createOpt.click()
    await page.waitForTimeout(700)
  }

  // 1) Empty state
  await page.screenshot({ path: `${ART}/schema-empty.png` })
  console.log('saved schema-empty.png')

  // Fill schema name
  await page.locator('#schema-name').fill('Lentivirus stability panel')
  await page.waitForTimeout(200)

  // Add 5 fields
  const addField = page.getByRole('button', { name: 'Add field' })
  for (let i = 0; i < 5; i++) {
    await addField.first().click()
    await page.waitForTimeout(120)
  }
  const labels = [
    'replicate',
    'titer_iu_ml',
    'pass_fail',
    'sample_id',
    'operator',
  ]
  const labelInputs = page.locator(
    'input[aria-label^="Field"][aria-label$="name"]',
  )
  for (let i = 0; i < labels.length; i++) {
    await labelInputs.nth(i).fill(labels[i])
    await page.waitForTimeout(80)
  }
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${ART}/schema-5fields.png` })
  console.log('saved schema-5fields.png')

  // Open the type menu on the 3rd field
  const typePills = page.locator('button[aria-label^="Field type:"]')
  await typePills.nth(2).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${ART}/schema-type-menu.png` })
  console.log('saved schema-type-menu.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Simulate 20-field state via Enter on last label
  const lastLabel = page
    .locator('input[aria-label^="Field"][aria-label$="name"]')
    .last()
  for (let i = 0; i < 15; i++) {
    await lastLabel.press('Enter')
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${ART}/schema-20fields.png` })
  console.log('saved schema-20fields.png')

  await browser.close()
  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
