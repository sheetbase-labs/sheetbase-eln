/**
 * Phone sweep: open the main pages on an iPhone, as the installed app, and fail
 * on anything a person would see broken there:
 *
 * - the page scrolls sideways, or text and controls run off the right edge;
 * - a control sits under the status bar or the home indicator;
 * - a menu, popover or sheet opened from the page lands partly off screen or
 *   under a fixed bar, with the keyboard closed and (for the ones opened from
 *   a field) with it open.
 */
import { expect, test } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'

import { signIn, waitForHydration, withAdminDb } from '../journeys/helpers'
import {
  KEYBOARD_PX,
  PHONE,
  SAFE_AREA,
  emulateInstalledApp,
  emulatePhone,
  findOverflow,
  setKeyboard,
  visibleArea,
} from './phone'

test.use({ ...PHONE })
test.setTimeout(180_000)

const LIST_PAGES = [
  '/',
  '/inbox',
  '/schedule',
  '/search',
  '/projects',
  '/experiments',
  '/requests',
  '/reports',
  '/samples',
  '/materials',
  '/registry',
  '/instruments',
  '/shipments',
  '/incidents',
  '/datasets',
  '/analysis',
  '/pipelines',
  '/protocols',
  '/templates',
  '/models',
  '/settings',
  '/experiments/new',
]

/** One seeded record of each kind people open most. */
async function detailPages(): Promise<string[]> {
  return withAdminDb(async (db) => {
    const one = async (sql: string) =>
      (await db.query<{ id: string }>(sql)).rows[0]?.id
    const experiment = await one(
      `SELECT id FROM api.records WHERE kind = 'experiment'
        AND deleted_at IS NULL AND identifier LIKE 'EXP-%'
        ORDER BY identifier LIMIT 1`,
    )
    const project = await one(
      `SELECT id FROM api.projects ORDER BY created_at LIMIT 1`,
    )
    const sample = await one(
      `SELECT id FROM api.records WHERE kind = 'sample' AND deleted_at IS NULL
        ORDER BY identifier LIMIT 1`,
    )
    const dataset = await one(
      `SELECT id FROM api.datasets ORDER BY created_at LIMIT 1`,
    )
    return [
      experiment && `/experiments/${experiment}/notebook`,
      experiment && `/experiments/${experiment}/summary`,
      project && `/projects/${project}`,
      sample && `/samples/${sample}`,
      dataset && `/datasets/${dataset}`,
    ].filter((p): p is string => Boolean(p))
  })
}

async function openPage(page: Page, path: string) {
  await page.goto(path)
  await waitForHydration(page)
  await emulateInstalledApp(page)
  // Let lists and counts arrive; a page that loads later would shift.
  await page
    .locator('[aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => undefined)
  await page.waitForTimeout(800)
}

/** Controls that sit under the status bar or the home indicator. */
async function underSystemBars(page: Page): Promise<string[]> {
  return page.evaluate((safe) => {
    const out: string[] = []
    const height = window.innerHeight
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [role="tab"]',
      ),
    )) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      // Only what stays put on screen: content that scrolls can be scrolled
      // out from under the bars, a pinned control cannot.
      let pinned: boolean | null = null
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.position === 'fixed') {
          pinned = true
          break
        }
        if (
          /auto|scroll/.test(cs.overflowY) &&
          n.scrollHeight > n.clientHeight + 1
        ) {
          pinned = false
          break
        }
      }
      if (pinned === null) {
        const doc = document.scrollingElement ?? document.documentElement
        pinned = doc.scrollHeight <= window.innerHeight + 1
      }
      if (!pinned) continue
      const name =
        el.getAttribute('aria-label') ??
        (el.textContent ?? '').trim().slice(0, 30)
      if (r.top < safe.top - 0.5 && r.bottom > 0)
        out.push(`"${name}" under the status bar (top ${Math.round(r.top)})`)
      if (r.bottom > height - safe.bottom + 0.5 && r.top < height)
        out.push(
          `"${name}" under the home indicator (bottom ${Math.round(r.bottom)})`,
        )
    }
    return out
  }, SAFE_AREA)
}

/**
 * The page's tab strip: the current tab is marked, and the strip sits on the
 * header's bottom edge with no gap under it.
 */
async function pageTabProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const tabs = document.querySelector<HTMLElement>('[data-page-tabs]')
    const header = document.querySelector<HTMLElement>('[data-page-header]')
    if (!tabs || tabs.getBoundingClientRect().height === 0) return []
    const out: string[] = []
    const current = tabs.querySelector<HTMLElement>('[aria-current="page"]')
    if (!current) out.push('no tab is marked as the current one')
    else {
      const colour = getComputedStyle(current).borderBottomColor
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(colour))
        out.push(
          `the current tab "${current.textContent?.trim()}" shows no underline`,
        )
    }
    if (header) {
      const gap =
        header.getBoundingClientRect().bottom -
        tabs.getBoundingClientRect().bottom
      if (Math.abs(gap) > 1)
        out.push(`${Math.round(gap)}px gap under the tab strip`)
    }
    return out
  })
}

const POPUP =
  '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [role="dialog"], [role="listbox"]'

/**
 * Where a just-opened popup sits relative to the visible area. A floating
 * menu or popover must sit wholly inside it. A sheet drawn edge to edge (the
 * navigation drawer, a bottom sheet) may paint its background under the
 * status bar and home indicator, but every control in it must be reachable:
 * the first below the status bar, and the last, scrolled to the end, above
 * the home indicator or the keyboard.
 */
async function popupProblems(page: Page, what: string): Promise<string[]> {
  const popup = page.locator(POPUP).filter({ visible: true }).last()
  if ((await popup.count()) === 0) return []
  await page.waitForTimeout(300) // open animation
  const area = await visibleArea(page)
  const found = await popup.evaluate((el, a) => {
    const out: string[] = []
    const r = el.getBoundingClientRect()
    const edgeToEdge = r.top <= 1 || r.bottom >= window.innerHeight - 1
    if (!edgeToEdge) {
      if (r.top < a.top - 0.5)
        out.push(`top ${Math.round(a.top - r.top)}px off screen`)
      if (r.bottom > a.bottom + 0.5)
        out.push(`bottom ${Math.round(r.bottom - a.bottom)}px off screen`)
      if (r.left < a.left - 0.5 || r.right > a.right + 0.5)
        out.push('runs off the side')
      return out
    }
    const controls = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [role="option"], [role="menuitem"]',
        ),
      ).filter((c) => {
        const b = c.getBoundingClientRect()
        return b.width > 0 && b.height > 0
      })
    const first = controls()[0]
    if (first) {
      const b = first.getBoundingClientRect()
      if (b.top < a.top - 0.5)
        out.push(
          `first control "${first.getAttribute('aria-label') ?? first.textContent?.trim().slice(0, 30)}" under the status bar`,
        )
    }
    for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
      if (node.scrollHeight > node.clientHeight + 1) node.scrollTop = 1e6
    }
    const list = controls()
    const last = list[list.length - 1]
    if (last) {
      const b = last.getBoundingClientRect()
      if (b.bottom > a.bottom + 0.5)
        out.push(
          `last control "${last.getAttribute('aria-label') ?? last.textContent?.trim().slice(0, 30)}" ${Math.round(b.bottom - a.bottom)}px under the bottom edge`,
        )
    }
    return out
  }, area)
  return found.map((p) => `${what}: ${p}`)
}

async function closePopups(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator(POPUP).filter({ visible: true }).count()) === 0)
      return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

/** Every visible trigger that opens a menu, popover or dialog. */
function popupTriggers(page: Page): Locator {
  return page
    .locator(
      'main [aria-haspopup]:not([aria-haspopup="false"]), header [aria-haspopup]:not([aria-haspopup="false"])',
    )
    .filter({ visible: true })
}

async function sweepPopups(page: Page, path: string): Promise<string[]> {
  const out: string[] = []
  const triggers = popupTriggers(page)
  const count = Math.min(await triggers.count(), 12)
  for (let i = 0; i < count; i += 1) {
    const trigger = triggers.nth(i)
    if (!(await trigger.isVisible().catch(() => false))) continue
    const name =
      (await trigger.getAttribute('aria-label')) ??
      ((await trigger.textContent()) ?? '').trim().slice(0, 30)
    const fromField = await trigger.evaluate(
      (el) =>
        el.getAttribute('role') === 'combobox' ||
        el.closest('form, [role="group"]') !== null,
    )
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined)
    await trigger.click({ timeout: 3_000 }).catch(() => undefined)
    if (page.url().replace(/^https?:\/\/[^/]+/, '') !== path) {
      // A trigger that navigates is not a popup; come back.
      await openPage(page, path)
      continue
    }
    out.push(...(await popupProblems(page, `"${name}" popup`)))
    if (fromField) {
      await setKeyboard(page, KEYBOARD_PX)
      out.push(...(await popupProblems(page, `"${name}" popup, keyboard open`)))
      await setKeyboard(page, 0)
    }
    await closePopups(page)
  }
  return out
}

test.describe('phone sweep', () => {
  test.beforeEach(async ({ page }) => {
    await emulatePhone(page)
    await signIn(page)
  })

  for (const path of LIST_PAGES) {
    test(`${path} fits a phone`, async ({ page }) => {
      await openPage(page, path)
      const problems = [
        ...(await findOverflow(page)),
        ...(await underSystemBars(page)),
        ...(await pageTabProblems(page)),
        ...(await sweepPopups(page, path)),
      ]
      expect(problems, `${path} on a phone`).toEqual([])
    })
  }

  test('record pages fit a phone', async ({ page }) => {
    const problems: string[] = []
    for (const path of await detailPages()) {
      await openPage(page, path)
      for (const p of [
        ...(await findOverflow(page)),
        ...(await underSystemBars(page)),
        ...(await pageTabProblems(page)),
        ...(await sweepPopups(page, path)),
      ])
        problems.push(`${path}: ${p}`)
    }
    expect(problems).toEqual([])
  })
})
