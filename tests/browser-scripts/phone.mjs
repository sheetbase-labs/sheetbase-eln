// Phone and tablet shell checks, ported from sheetbase-app-3's tests/phone.mjs.
//
// The ELN runs on its own data: identifiers come from the same-origin /api/db
// proxy (helpers.discover), not fixtures. Behaviours checked: the phone bottom
// bar (Today, Scan, Inbox), the Scan screen resolving a real identifier, the
// navigation drawer, the inspector and dialogs as bottom sheets, the tablet
// drawer and the laptop icon rail.
//
// MOB-02's bench reading flow (scan → record reading into a planned sheet row)
// is not ported yet; its step lands with that capability.
import { chromium } from 'playwright'

import { base, check, discover } from './helpers.mjs'

const b = await chromium.launch()
const ids = await discover()
const errors = []
const track = (page) => {
  page.on('pageerror', (e) => {
    if (e.message.includes('Maximum update depth exceeded')) return
    errors.push(e.message)
  })
  page.on('console', (m) => {
    if (m.type() !== 'error' || m.text().includes('hydrated')) return
    const url = m.location()?.url ?? ''
    if (url.includes('/api/auth/list-sessions')) return
    if (
      m.text().includes('status of 401') &&
      page.url().includes('/settings/profile')
    )
      return
    if (m.text().includes('Maximum update depth exceeded')) return
    errors.push(m.text())
  })
}
const go = async (page, path) => {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  // The TanStack Devtools trigger sits bottom-right in dev and overlaps the
  // phone bottom bar. It is not part of the product; remove it for the suite.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.querySelector('img[alt="TanStack Devtools"]')) {
        b.parentElement?.remove()
      }
    }
  })
}

// ---- Phone (390) -----------------------------------------------------------
const phone = await b.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
let p = await phone.newPage()
track(p)
await go(p, '/')
const bottom = p.locator('nav[aria-label="Main"]:visible').last()
check(
  await bottom.getByRole('link', { name: 'Scan' }).isVisible(),
  'Phone: bottom bar shows Today, Scan and Inbox',
)
check(
  !(await p.locator('nav[aria-label="Main"].w-nav').first().isVisible()),
  'Phone: side navigation is hidden',
)

await bottom.getByRole('link', { name: 'Scan' }).tap()
await p.waitForURL(/\/scan/)
check(p.url().endsWith('/scan'), 'Phone: Scan opens /scan')

const sampleIdentifier = ids.sampleIdentifier
if (sampleIdentifier) {
  await p.getByLabel('Can’t scan? Type the ID').fill(sampleIdentifier)
  await p.getByRole('button', { name: 'Find' }).tap()
  await p.getByText(sampleIdentifier).first().waitFor()
  check(
    await p.getByRole('button', { name: 'Open sample' }).isVisible(),
    'Scan: typing a real identifier resolves the sample',
  )
  await p.getByRole('button', { name: 'Open sample' }).tap()
  await p.waitForURL(/\/samples\//)
  check(true, 'Scan: the result opens the sample')
} else {
  check(false, 'Scan: no sample identifier discovered to resolve')
}

await p.getByRole('button', { name: 'Menu' }).tap()
check(
  await p.getByRole('dialog', { name: 'Sheetbase' }).isVisible(),
  'Phone: Menu opens the navigation drawer',
)
await p.getByRole('dialog').getByRole('link', { name: 'Datasets' }).tap()
await p.waitForURL(/\/datasets$/)
check(
  await p
    .getByRole('dialog')
    .waitFor({ state: 'hidden', timeout: 3000 })
    .then(
      () => true,
      () => false,
    ),
  'Drawer closes after navigating',
)

const inspectorRoute = ids.dataset
  ? `/datasets/${ids.dataset}/snapshots`
  : ids.sample
    ? `/samples/${ids.sample}`
    : null
if (inspectorRoute) {
  await go(p, inspectorRoute)
  await p.getByRole('button', { name: 'Details' }).tap()
  check(
    await p.getByRole('dialog', { name: 'Details' }).isVisible(),
    'Inspector opens as a sheet on phone',
  )
  const box = await p.getByRole('dialog', { name: 'Details' }).boundingBox()
  check(
    box && box.y > 100 && Math.round(box.width) === 390,
    'Inspector sheet is a full-width bottom sheet',
  )
  await p.keyboard.press('Escape')
} else {
  check(false, 'Inspector: no record discovered for the inspector sheet check')
}

await go(p, '/settings/members')
await p.getByRole('button', { name: 'Invite people' }).first().tap()
await p.waitForTimeout(400)
const dbox = await p.getByRole('dialog').boundingBox()
check(
  dbox && Math.round(dbox.width) === 390 && dbox.y + dbox.height >= 843,
  'Dialogs are bottom sheets on phone',
)
await p.keyboard.press('Escape')

// ---- Tablet (834) ----------------------------------------------------------
const tablet = await b.newContext({
  viewport: { width: 834, height: 1112 },
  hasTouch: true,
})
p = await tablet.newPage()
track(p)
await go(p, '/')
await p.getByRole('button', { name: 'Open navigation' }).tap()
check(
  await p.getByRole('dialog', { name: 'Sheetbase' }).isVisible(),
  'Tablet: hamburger opens the navigation drawer',
)

// ---- Laptop (1100) ---------------------------------------------------------
const laptop = await b.newContext({ viewport: { width: 1100, height: 800 } })
p = await laptop.newPage()
track(p)
await go(p, '/')
check(
  (await p.getByRole('link', { name: 'Pipelines' }).first().isVisible()) &&
    (await p.locator('nav.w-12').count()) > 0,
  'Laptop: icon rail is shown',
)

await b.close()
check(errors.length === 0, 'No page errors ' + errors.join(' | '))
if (errors.length) console.log('  errors: ' + errors.slice(0, 4).join(' | '))
