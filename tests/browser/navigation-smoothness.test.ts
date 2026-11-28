import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { open, signIn } from './journeys/helpers'

/**
 * Clicking around should feel like one app. Two things break that feel and
 * both are checked here by clicking real links in the real app:
 *
 *  - a link that reloads the whole page instead of moving inside the app;
 *  - a page that throws, logs a console error or fails a data request.
 *
 * Every list is opened, then the first few links in its pane are followed.
 */
test.setTimeout(120_000)

// Each test signs in afresh and only reads, so they spread across workers
// (and CI shards) instead of queueing behind each other in one.
test.describe.configure({ mode: 'parallel' })

/** Seeded design data: these ids are stable across runs. */
const LISTS = [
  '/',
  '/inbox',
  '/projects',
  '/experiments',
  '/samples',
  '/materials',
  '/registry',
  '/instruments',
  '/datasets',
  '/analysis',
  '/pipelines',
  '/protocols',
  '/templates',
  '/schedule',
  '/requests',
  '/reports',
  '/plates',
  '/shipments',
  '/incidents',
  '/agent',
  '/settings/workspace/members',
  // Detail pages carry the links that sit in running text and tables.
  '/experiments/00000000-0000-4000-8000-00000090012d',
  '/pipelines/agents',
  '/datasets/00000000-0000-4000-8000-000000000381',
]

/** Requests and messages that are the test environment, not the app. */
const IGNORED = [
  /favicon/,
  /\.map(\?|$)/,
  /\/api\/auth\/passkey\//,
  /\/api\/auth\/get-session/,
  /service-worker|sw\.js/,
]

function watch(page: Page) {
  const problems: string[] = []

  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error')
      problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('response', (response) => {
    const url = response.url()

    if (response.status() >= 400 && !IGNORED.some((rx) => rx.test(url)))
      problems.push(
        `${response.status()} ${response.request().method()} ${new URL(url).pathname}`,
      )
  })

  return problems
}

const paneLinks = (page: Page) =>
  page.locator(
    '.mx-pane a[href^="/"]:not([download]):not([target="_blank"]):not([href^="/api"]):not([href^="/docs"]):not([href^="/sign-in"]):not([href^="/client-portal"])',
  )

for (const list of LISTS) {
  test(`links and data on ${list} behave`, async ({ page }) => {
    const problems = watch(page)

    await signIn(page)
    const reloaded: string[] = []

    await open(page, list)
    await page.waitForTimeout(1500)

    // The first few links, plus every plain `<a href>` (one with no click
    // handler of its own), which is the kind that reloads when nothing steps in.
    const hrefs = await paneLinks(page).evaluateAll((anchors) => {
      const shown = anchors.filter(
        (a) => a instanceof HTMLElement && a.offsetParent,
      )

      const bare = shown.filter((a) => {
        const props = Object.entries(a).find(([key]) =>
          key.startsWith('__reactProps'),
        )?.[1]

        return !props?.onClick
      })

      return [
        ...new Set(
          [...shown.slice(0, 4), ...bare.slice(0, 6)].map(
            (a) => a.getAttribute('href') ?? '',
          ),
        ),
      ]
    })

    for (const href of hrefs) {
      if (href === list) continue
      await open(page, list)
      await page.waitForTimeout(800)
      // A welcome or setup dialog on first sight would cover the page.
      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        document.documentElement.dataset.stillHere = 'yes'
      })
      const link = page.locator(`.mx-pane a[href="${href}"]:visible`).first()

      if (!(await link.isVisible())) continue
      await link.click({ timeout: 10_000 })
      await page.waitForTimeout(1200)

      const stillHere = await page
        .evaluate(() => document.documentElement.dataset.stillHere === 'yes')
        .catch(() => false)

      if (!stillHere) reloaded.push(`${list} -> ${href}`)
    }

    expect(reloaded, 'links that reloaded the whole page').toEqual([])
    expect(problems, 'errors seen while clicking around').toEqual([])
  })
}
