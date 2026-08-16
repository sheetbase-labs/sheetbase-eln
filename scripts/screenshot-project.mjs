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
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await webcrypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )
  const sigB64 = Buffer.from(new Uint8Array(sig)).toString('base64')
  return encodeURIComponent(value + '.' + sigB64)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const cookieValue = await signCookieValue(SESSION_TOKEN, AUTH_SECRET)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })

  // Set cookies before creating page
  await context.addCookies([
    {
      name: '__Secure-better-auth.session_token',
      value: cookieValue,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
  ])

  const page = await context.newPage()
  await page.goto(`${BASE}/projects/00000000-0000-4000-8000-000000000200`, {
    waitUntil: 'load',
    timeout: 20000,
  })
  await page.waitForTimeout(5000)

  console.log('URL:', page.url())

  if (page.url().includes('sign-in')) {
    console.error('Redirected to sign-in')
    await browser.close()
    process.exit(1)
  }

  // Use screenshot with no timeout option and catch errors
  try {
    const buf = await page.screenshot({ type: 'png', timeout: 60000 })
    writeSync(resolve(OUT, 'project-owner-inspector-after.png'), buf)
    console.log('Saved project-owner-inspector-after.png')
  } catch (e) {
    console.error('Screenshot 1 failed:', e.message)
  }

  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(2000)

  try {
    const buf2 = await page.screenshot({ type: 'png', timeout: 60000 })
    writeSync(resolve(OUT, 'project-owner-inspector-wide.png'), buf2)
    console.log('Saved project-owner-inspector-wide.png')
  } catch (e) {
    console.error('Screenshot 2 failed:', e.message)
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
