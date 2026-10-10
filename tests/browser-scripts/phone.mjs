// Phone and tablet shell checks, ported from sheetbase-app-3's tests/phone.mjs.
//
// The ELN runs on its own data: identifiers come from the same-origin /api/db
// proxy (helpers.discover), not fixtures. Behaviours checked: the phone bottom
// bar (Today, Scan, Inbox), the Scan screen resolving a real identifier, the
// navigation drawer, the inspector and dialogs as bottom sheets, the tablet
// drawer and the laptop icon rail.
//
// MOB-02's bench flows are covered at phone width: the withdraw dialog and its
// numeric keypad, and the record-a-reading form against the seeded bench
// dataset. The reading is never submitted, so a repeatable suite does not
// consume the four planned rows it renders.
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
const scanInput = () => p.getByPlaceholder(/SMP-0001/)
if (sampleIdentifier) {
  if (ids.alias) {
    await scanInput().fill(ids.alias)
    await p.getByRole('button', { name: 'Find' }).tap()
    await p.waitForTimeout(900)
    check(
      await p.getByText(sampleIdentifier).first().isVisible(),
      'Scan: an "also known as" alias resolves the sample',
    )
  }
  await scanInput().fill(sampleIdentifier)
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

// ---- MOB-02: bench withdraw and record-a-reading at phone width ------------
if (ids.sample) {
  await go(p, `/samples/${ids.sample}/usage`)
  const openWithdraw = p.getByRole('button', { name: 'Withdraw volume…' })
  check(
    await openWithdraw.isVisible(),
    'Withdraw: the sample Usage tab offers the action on phone',
  )
  await openWithdraw.tap()
  await p.waitForTimeout(500)
  const withdrawDialog = p.getByRole('dialog')
  check(
    await withdrawDialog.isVisible(),
    'Withdraw: the dialog opens on phone',
  )
  const wbox = await withdrawDialog.boundingBox()
  check(
    wbox &&
      Math.round(wbox.width) === 390 &&
      wbox.y > 100 &&
      wbox.y + wbox.height >= 843,
    'Withdraw: the dialog is a full-width bottom sheet',
  )
  const keypad = p.getByRole('group', { name: 'Number pad' })
  check(await keypad.isVisible(), 'Withdraw: the numeric keypad is present')
  check(
    (await withdrawDialog.getByText('Available now').isVisible()) &&
      (await withdrawDialog.getByText('Remaining after').isVisible()),
    'Withdraw: the available/remaining summary is shown',
  )
  await keypad.getByRole('button', { name: '7', exact: true }).tap()
  check(
    (await withdrawDialog.locator('input').first().inputValue()) === '7',
    'Withdraw: the keypad enters a volume',
  )
  // Close without submitting: a withdrawal consumes the sample quantity.
  await p.keyboard.press('Escape')
  check(
    await withdrawDialog
      .waitFor({ state: 'hidden', timeout: 3000 })
      .then(
        () => true,
        () => false,
      ),
    'Withdraw: closes without submitting',
  )
} else {
  check(false, 'Withdraw: no sample discovered for the withdraw sheet check')
}

await go(p, '/readings/new')
check(p.url().endsWith('/readings/new'), 'Reading: /readings/new opens on phone')
// The form renders four native selects in order: sample, dataset, planned row,
// measurement. Native selects expose role=combobox.
const selects = p.getByRole('combobox')
const sampleSelect = selects.nth(0)
const datasetSelect = selects.nth(1)
const plannedSelect = selects.nth(2)
const measurementSelect = selects.nth(3)
await plannedSelect.waitFor({ state: 'visible', timeout: 5000 })
check(
  (await datasetSelect.locator('option').count()) > 0,
  'Reading: the dataset select renders a dataset with planned rows',
)
check(
  (await plannedSelect.locator('option').allTextContents()).some((text) =>
    text.includes('SMP-2231'),
  ),
  'Reading: the planned-row select renders the seeded bench rows',
)
check(
  (await measurementSelect.locator('option').count()) > 0,
  'Reading: the measurement field renders a numeric option',
)
const sampleOptionCount = await sampleSelect.locator('option').count()
const firstSample = await sampleSelect.inputValue()
const lastSample = await sampleSelect
  .locator('option')
  .nth(sampleOptionCount - 1)
  .getAttribute('value')
if (lastSample) await sampleSelect.selectOption(lastSample)
check(
  sampleOptionCount > 1 &&
    (await sampleSelect.inputValue()) === lastSample &&
    lastSample !== firstSample,
  'Reading: the sample selector changes the selected sample',
)
const valueInput = p.locator('input.num').first()
await valueInput.fill('12.5')
await p.waitForTimeout(200)
check(
  (await p.locator('body').innerText()).includes('Reported concentration'),
  'Reading: entering a value shows the reported concentration',
)
check(
  await p.getByRole('button', { name: /Save reading/ }).isEnabled(),
  'Reading: the form is operable (Save enables)',
)
// Deliberately no submit: filling a planned row consumes it, and the seeded
// bench dataset only has four (SMP-2231..SMP-2234), so a repeating suite would
// exhaust them. This stays a read-only operability check.

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
