import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

/**
 * Click targets: everything that looks like a record opens that record.
 *
 * Two guards run against the seeded design workspace:
 *  - no link that sits in a row naming a record (`DS-0311`, `EXP-0131`) may
 *    lead to a bare list page (`/datasets`, `/materials`, `/templates?…`);
 *  - clicking the blank part of a row, not only its text, opens the record.
 */
const userId = '00000000-0000-4000-8000-000000000310'

test.use({
  baseURL: process.env.HOME_TEST_BASE_URL ?? 'http://127.0.0.1:3100',
  viewport: { width: 1440, height: 900 },
})

const LIST_PAGES =
  /^\/(datasets|samples|materials|experiments|projects|instruments|protocols|reports|analysis|sheets|models|plates|shipments|requests|inbox|pipelines|templates|registry|incidents|records)\/?$/

const RECORD_ID = /\b[A-Z]{2,5}-\d{2,}\b/

/** Pages whose rows name records, and where the person lands first. */
const PAGES = [
  '/',
  '/inbox',
  '/projects',
  '/experiments',
  '/samples',
  '/materials',
  '/datasets',
  '/instruments',
  '/protocols',
  '/reports',
  '/analysis',
  '/models',
  '/templates',
  '/pipelines',
  '/search?q=ELISA',
]

async function open(page: Page, path: string) {
  await page.goto(path)

  await page.getByRole('navigation').first().waitFor()
  const skip = page.getByRole('button', { name: 'Skip for now' })

  if (await skip.isVisible({ timeout: 1500 }).catch(() => false))
    await skip.click()
  // Lists load after the shell does.
  await page
    .locator('main a[href], .mx-pane a[href]')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined)
}

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, userId)
})

for (const path of PAGES) {
  test(`${path}: no record row links to a list page`, async ({ page }) => {
    await open(page, path)

    const offenders = await page.evaluate(
      ({ list, id }) => {
        const listPages = new RegExp(list)
        const recordId = new RegExp(id)

        return [
          ...document.querySelectorAll<HTMLAnchorElement>(
            'main a[href], .mx-pane a[href]',
          ),
        ].flatMap((a) => {
          const rect = a.getBoundingClientRect()

          if (rect.width === 0) return []
          const row = a.closest('li, tr, [role=row], [role=listitem]')

          if (!(row instanceof HTMLElement) || !recordId.test(row.innerText))
            return []
          const url = new URL(a.href, location.href)

          // A pager or a "view all" link names no record of its own.
          return listPages.test(url.pathname)
            ? [
                `${url.pathname}${url.search} in “${row.innerText.slice(0, 60).replace(/\s+/g, ' ')}”`,
              ]
            : []
        })
      },
      { list: LIST_PAGES.source, id: RECORD_ID.source },
    )

    expect(offenders).toEqual([])
  })
}

test('Home: a Needs attention row opens the flagged value, wherever it is clicked', async ({
  page,
}) => {
  await open(page, '/')

  const row = page
    .getByRole('link')
    .filter({ hasText: /DS-\d+ · \d+ value/ })
    .first()

  await expect(row).toBeVisible({ timeout: 15_000 })
  const href = await row.getAttribute('href')

  expect(href).toMatch(/^\/datasets\/[^/?]+\/rows\?row=.+&field=.+&live=true$/)

  // The whole row is the link: its box covers the detail line too.
  const box = await row.boundingBox()

  expect(box?.width ?? 0).toBeGreaterThan(150)
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) - 12,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await expect(page).toHaveURL(/\/datasets\/[^/]+\/rows\?row=/)
})

test('Home: the review and recent tables open the record from any cell', async ({
  page,
}) => {
  await open(page, '/')

  // An ID column and a name column in both tables, as every other record
  // table has.
  await expect(
    page.getByRole('columnheader', { name: 'ID', exact: true }),
  ).toHaveCount(2, { timeout: 15_000 })
  await expect(
    page.getByRole('columnheader', { name: 'Name', exact: true }),
  ).toHaveCount(2)

  const first = page
    .getByRole('row')
    .filter({ hasText: /Viewed|Edited/ })
    .first()

  const box = await first.boundingBox()

  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) - 12,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await expect(page).not.toHaveURL(/\/$/)
})

test('Inbox: a row opens the thing it is about, wherever it is clicked', async ({
  page,
}) => {
  await open(page, '/inbox')

  const rows = page.locator('[role=option], [role=row], li').filter({
    has: page.locator('input[type=checkbox],[role=checkbox]'),
  })

  await expect(rows.first()).toBeVisible({ timeout: 15_000 })
  const box = await rows.first().boundingBox()

  // The blank middle of the row, not its title.
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) * 0.6,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await expect(page).not.toHaveURL(/\/inbox(\?.*)?$/, { timeout: 10_000 })
  expect(LIST_PAGES.test(new URL(page.url()).pathname)).toBe(false)
})
