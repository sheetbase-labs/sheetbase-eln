import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { open, signIn } from './journeys/helpers'

/**
 * Going into a record from a long list and coming back puts the list where it
 * was left, not at the top.
 */
test.setTimeout(90_000)

/** The list's own scroller: the tallest scrolling element in the pane. */
const scrollTopOfList = (page: Page) =>
  page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll('.mx-pane *'))
      .filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 50 &&
          /auto|scroll/.test(getComputedStyle(el).overflowY),
      )
      .sort((a, b) => b.scrollHeight - a.scrollHeight)

    return scrollers[0]?.scrollTop ?? -1
  })

for (const list of ['/experiments', '/samples']) {
  test(`${list} keeps its place when you come back`, async ({ page }) => {
    await signIn(page)
    await open(page, list)
    await expect(
      page.locator(`.mx-pane a[href^="${list}/"]:visible`).nth(8),
    ).toBeVisible()

    // Scroll the way a person does: with the wheel, over the list.
    const box = await page.locator('.mx-pane').first().boundingBox()

    if (!box) throw new Error('no pane')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => scrollTopOfList(page)).toBeGreaterThan(100)
    const left = await scrollTopOfList(page)
    await page.waitForTimeout(500)

    await page.locator(`.mx-pane a[href^="${list}/"]:visible`).nth(8).click()
    await page.waitForURL((url) => url.pathname !== list)
    await page.goBack()

    await expect.poll(() => scrollTopOfList(page), { timeout: 8000 }).toBe(left)
  })
}
