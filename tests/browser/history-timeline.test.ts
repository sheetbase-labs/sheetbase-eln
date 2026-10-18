/**
 * B5 browser acceptance for the consolidated history surface.
 *
 * The dataset History tab is the screen this stands in for. It is not a frame
 * in the design-parity set — the DatasetExplorer parity state is the Data tab —
 * so, per ADR-0055 decision 4, this browser test is the panel's proof on a real
 * screen: the change-event stream renders through the shared surface
 * (`src/components/audit/history-timeline.tsx`, built on `@reui/timeline`) with
 * the relative and absolute time, the before→after chips, the deep link, the
 * `Raw event` disclosure and the continuation control, and axe reports no
 * violations with colour contrast on.
 *
 * The record-history panel and the typed audit trail share that surface; their
 * behaviour is pinned by `src/components/audit/*.test.tsx`, and the A/B
 * evidence is the `history-rows` pair on `/component-compare`.
 *
 * Set HISTORY_SHOTS=<dir> to keep the screenshots beside the comparison record.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import axe from 'axe-core'
import { expect, test } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'

import { DESIGN_USER_IDS } from '../visual/design-states'
import { signInAsDesignUser } from '../visual/sign-in'

const ROUTE = '/datasets/DS-0298?view=history'
/** The design seed gives DS-0298 88 change events; the tab asks for 50. */
const FIRST_PAGE = 50

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'en-GB',
})

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
})

/** The surface root, whatever state it is in. */
function surface(page: Page): Locator {
  return page.locator('[data-slot="history-timeline"]')
}

/** The rows of the timeline list. */
function rows(page: Page): Locator {
  return page.locator('[data-slot="timeline-item"]')
}

async function openHistory(page: Page): Promise<Locator> {
  await page.goto(ROUTE)
  const panel = surface(page)
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 })
  return panel
}

async function shot(
  target: Locator,
  testInfo: { outputPath: (name: string) => string },
  name: string,
) {
  const configured = process.env.HISTORY_SHOTS
  const file = configured
    ? join(configured, `${name}.png`)
    : testInfo.outputPath(`${name}.png`)
  await mkdir(dirname(file), { recursive: true })
  await target.screenshot({ path: file, animations: 'disabled' })
  return file
}

/** axe with colour contrast ON, in the real engine, over one element. */
async function axeViolations(page: Page, selector: string) {
  await page.addScriptTag({ content: axe.source })
  return page.evaluate(async (target: string) => {
    const element = document.querySelector(target)
    if (!element) throw new Error(`no ${target}`)
    // The injected axe global is not part of the DOM lib types; the cast is the
    // injection boundary, and it is checked before use.
    const runner = (
      globalThis as {
        axe?: {
          run: (context: Element) => Promise<{
            violations: Array<{
              id: string
              impact: string | null
              nodes: Array<{ html: string }>
            }>
          }>
        }
      }
    ).axe
    if (!runner) throw new Error('axe was not injected')
    const results = await runner.run(element)
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.html).slice(0, 3),
    }))
  }, selector)
}

test('renders the change stream with relative and absolute time', async ({
  page,
}, testInfo) => {
  const panel = await openHistory(page)

  // One page of events, and the continuation control that says there is more.
  await expect(rows(page)).toHaveCount(FIRST_PAGE)
  await expect(panel.getByRole('button', { name: 'Load more' })).toBeVisible()

  // Every row carries the instant it happened and both of its labels: the
  // shared relative formatter in the <time>, the absolute date-time beside it.
  const first = rows(page).first()
  const time = first.locator('time[datetime]')
  await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/)
  await expect(time).toHaveText(/^(just now|\d+[mhdw] ago|\d{1,2} \w{3})$/)
  await expect(first).toContainText(/\d{1,2} \w{3} \d{4}, \d{2}:\d{2}/)

  await shot(panel, testInfo, 'dataset-history-light')
})

test('shows the captured change chips and the canonical deep link', async ({
  page,
}) => {
  const panel = await openHistory(page)

  // The chips: only rows whose event captured a change carry the content slot.
  // Every captured change in this dataset's stream is an addition, so this
  // asserts the "set to" form; the before→after form is pinned by the harness
  // pair (`history-rows`) and by `object-history-timeline.test.tsx`.
  const changes = panel.locator('[data-slot="timeline-content"]')
  await expect(changes.first()).toBeVisible()
  await expect(changes.first()).toContainText('set to')

  // The link resolves to the dataset's own route.
  const link = panel.getByRole('link', { name: 'Open dataset' }).first()
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /^\/datasets/)
})

test('folds the raw event behind a disclosure that opens by keyboard', async ({
  page,
}) => {
  const panel = await openHistory(page)

  const summaries = panel.getByText('Raw event')
  expect(await summaries.count()).toBeGreaterThan(0)
  await expect(panel.locator('details[open]')).toHaveCount(0)

  await summaries.first().focus()
  await page.keyboard.press('Enter')

  const open = panel.locator('details[open]')
  await expect(open).toHaveCount(1)
  await expect(open.locator('pre')).toContainText('"operation"')
})

test('continues the list with Load more, by keyboard', async ({ page }) => {
  const panel = await openHistory(page)

  const loadMore = panel.getByRole('button', { name: 'Load more' })
  await loadMore.focus()
  await page.keyboard.press('Enter')

  await expect.poll(async () => rows(page).count()).toBeGreaterThan(FIRST_PAGE)
  // Everything is on screen: the control goes away rather than lying.
  await expect(panel.getByRole('button', { name: 'Load more' })).toHaveCount(0)
})

test('has no axe violations, with colour contrast on', async ({ page }) => {
  await openHistory(page)
  const violations = await axeViolations(page, '[data-slot="history-timeline"]')
  expect(violations).toEqual([])
})

test('renders in the dark theme on tokens alone', async ({
  page,
}, testInfo) => {
  await page
    .context()
    .addCookies([
      { name: 'sb-theme', value: 'dark', domain: '127.0.0.1', path: '/' },
    ])
  const panel = await openHistory(page)
  await expect(page.locator('html')).toHaveClass(/dark/)

  const violations = await axeViolations(page, '[data-slot="history-timeline"]')
  expect(violations).toEqual([])

  await shot(panel, testInfo, 'dataset-history-dark')
})

/**
 * The record-history panel on the review screen. It lives behind the page's
 * History tab, so the design-parity frame — which shows the tab the design
 * board shows — never renders it: this test is its proof on a real screen, and
 * it is the panel that carries the sr-only sentence per event and the
 * "Showing N of M" summary through the same shared surface.
 */
test('the review page renders the record history through the same surface', async ({
  page,
}, testInfo) => {
  await page.goto('/review/EXP-0138')

  const tab = page.getByRole('tab', { name: 'History' })
  await expect(tab).toBeVisible({ timeout: 20_000 })

  // The page is server-rendered, so a click that lands before hydration is
  // lost; the retry is the same one the comparison harness uses.
  const tabPanel = page.getByRole('tabpanel', { name: 'History' })
  await expect(async () => {
    await tab.click()
    await expect(tabPanel).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  const panel = tabPanel.getByRole('region', { name: 'Record history' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(
    panel.getByRole('heading', { name: 'Complete history' }),
  ).toBeVisible()

  const rows = panel.locator('[data-slot="timeline-item"]')
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })
  await expect(rows).not.toHaveCount(0)

  // Every row keeps a complete sentence for screen readers, and the summary
  // line still says how much of the history is on screen.
  await expect(panel.locator('span.sr-only').first()).toHaveText(/ at .+\.$/)
  await expect(panel.getByText(/Showing \d+ of \d+ events/)).toBeVisible()

  const violations = await axeViolations(page, '[aria-label="Record history"]')
  expect(violations).toEqual([])

  await shot(panel, testInfo, 'review-record-history-light')
})
