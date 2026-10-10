import { expect, test } from 'playwright/test'

import { DESIGN_STATES } from './design-states'
import { visitDesignState } from './state-driver'

for (const state of DESIGN_STATES.filter(
  (entry) => entry.screen === 'HelpRecords',
)) {
  test(`one-pixel padding drift is rejected — ${state.theme}`, async ({
    page,
  }) => {
    await visitDesignState(page, state)
    const reference = `${state.screen}-${state.theme}.png`
    // A clean comparison must pass first. A broken page or missing reference
    // is not evidence that the screenshot assertion detects padding drift.
    await expect(page).toHaveScreenshot(reference)
    const article = page.locator('#main article')
    await expect(article).toHaveCount(1)
    const padding = await article.evaluate(
      (element) => getComputedStyle(element).paddingTop,
    )
    try {
      await article.evaluate((element) => {
        element.style.paddingTop = `${parseFloat(getComputedStyle(element).paddingTop) + 1}px`
      })
      await expect(article).toHaveCSS(
        'padding-top',
        `${parseFloat(padding) + 1}px`,
      )
      // Same full-screen reference and global 0.001 tolerance as parity.
      await expect(
        expect(page).toHaveScreenshot(reference, { timeout: 1000 }),
      ).rejects.toThrow(/pixels .*are different/)
    } finally {
      await article.evaluate((element) => {
        element.style.removeProperty('padding-top')
      })
    }
    await expect(article).toHaveCSS('padding-top', padding)
    await expect(page).toHaveScreenshot(reference)
  })
}
