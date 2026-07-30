import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { writeFileSync as writeSync } from 'node:fs'
import { resolve } from 'node:path'
import { webcrypto } from 'node:crypto'

const BASE = 'http://127.0.0.1:3000'
const OUT = resolve('.amp/in/artifacts')
const SESSION_TOKEN = 'FTRGOJTtRvz7sLpfgJEQENWwz85C00yF'
const AUTH_SECRET = 'dev-only-insecure-auth-secret-replace-me-0123456789'

async function signCookieValue(value, secret) {
  const key = await webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  const sigB64 = Buffer.from(new Uint8Array(sig)).toString('base64')
  return encodeURIComponent(value + '.' + sigB64)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const cookieValue = await signCookieValue(SESSION_TOKEN, AUTH_SECRET)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies([{
    name: '__Secure-better-auth.session_token',
    value: cookieValue,
    domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'None',
  }])
  const page = await context.newPage()
  await page.goto(`${BASE}/projects/00000000-0000-4000-8000-000000000200/experiments/00000000-0000-4000-8000-0000000003fe`, {
    waitUntil: 'load', timeout: 20000,
  })
  await page.waitForTimeout(5000)

  // Screenshot the plate map block
  await page.evaluate(() => {
    const el = document.querySelector('[data-block-type="Plate map"]')
    if (el) el.scrollIntoView({ block: 'start' })
  })
  await page.waitForTimeout(500)
  const buf = await page.screenshot({ type: 'png' })
  writeSync(resolve(OUT, 'noteblock-platemap.png'), buf)
  console.log('Saved noteblock-platemap.png')

  // Also screenshot the metric block
  await page.evaluate(() => {
    const el = document.querySelector('[data-block-type="Metric"]')
    if (el) el.scrollIntoView({ block: 'start' })
  })
  await page.waitForTimeout(500)
  const buf2 = await page.screenshot({ type: 'png' })
  writeSync(resolve(OUT, 'noteblock-metric.png'), buf2)
  console.log('Saved noteblock-metric.png')

  // Screenshot the full page to see everything in context
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  const buf3 = await page.screenshot({ type: 'png', fullPage: true })
  writeSync(resolve(OUT, 'noteblock-fullpage.png'), buf3)
  console.log('Saved noteblock-fullpage.png')

  await browser.close()
}
main().catch(e => { console.error(e); process.exit(1) })
