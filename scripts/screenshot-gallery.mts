/**
 * Stable screenshots of the highest-value /foundations catalogue compositions
 * (UI-008). Opt-in dev tool; not part of `pnpm validate`.
 *
 * Prerequisites:
 *   - `pnpm dev` running on http://localhost:3000
 *   - `pnpm add -D playwright` and `npx playwright install chromium`
 *
 * Usage:
 *   pnpm screenshot:gallery
 *
 * Writes PNGs to .amp/in/artifacts/gallery/. The catalogue is dev-only, so
 * screenshots are captured against the local dev server.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = process.env.GALLERY_URL ?? 'http://localhost:3000'
const OUT = resolve('.amp/in/artifacts/gallery')

const shots: { name: string; selector: string }[] = [
  { name: 'colour', selector: '#colour' },
  { name: 'typography', selector: '#typography' },
  { name: 'primitives', selector: '#primitives' },
  { name: 'record', selector: '#record' },
  { name: 'scientific', selector: '#scientific' },
  { name: 'notebook', selector: '#notebook' },
  { name: 'audit', selector: '#audit' },
  { name: 'shell', selector: '#shell' },
  { name: 'states', selector: '#states' },
  { name: 'contrast', selector: '#contrast' },
]

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  for (const theme of ['light', 'dark'] as const) {
    await page.goto(`${BASE}/foundations`)
    await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(800)
    // Set theme + density via localStorage and reload so the no-flash script
    // applies them before first paint.
    await page.evaluate(
      ({ t }) => {
        localStorage.setItem('sheetbase-theme', t)
        localStorage.setItem('sheetbase-density', 'comfortable')
      },
      { t: theme },
    )
    await page.reload()
    await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(800)

    for (const { name, selector } of shots) {
      const el = await page.$(selector)
      if (!el) {
        console.warn(`[screenshot] ${theme}/${name}: selector ${selector} not found`)
        continue
      }
      const file = resolve(OUT, `${theme}-${name}.png`)
      await el.screenshot({ path: file })
      console.log(`[screenshot] wrote ${file}`)
    }

    // Compact density variants for the highest-value compositions.
    await page.evaluate(() => {
      localStorage.setItem('sheetbase-density', 'compact')
    })
    await page.reload()
    await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(800)
    for (const { name, selector } of [
      { name: 'states', selector: '#states' },
      { name: 'record', selector: '#record' },
    ]) {
      const el = await page.$(selector)
      if (!el) continue
      const file = resolve(OUT, `${theme}-compact-${name}.png`)
      await el.screenshot({ path: file })
      console.log(`[screenshot] wrote ${file}`)
    }
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

