import { expect, test } from 'playwright/test'

import { DESIGN_SCREEN_SIZES } from './design-states'
import { visitDesignState } from './state-driver'

// COMP-05: unlike the incomplete full-screen comparisons, this installed
// package fixture has no expected-failure annotation. A release that changes
// the States filter builder must fail the parity project.
for (const theme of ['light', 'dark'] as const) {
  test(`installed package matches States filter builder — ${theme}`, async ({
    page,
  }) => {
    await visitDesignState(page, {
      screen: 'States',
      route: '/sheetbase-components',
      user: 'gareth',
      theme,
      size: DESIGN_SCREEN_SIZES.States,
    })
    const builder = page.locator('.sb-filter-builder')
    await expect(builder).toBeVisible()
    const reference = `States-filter-builder-${theme}.png`

    // Establish clean-package parity before the negative control. Otherwise
    // an unrelated setup or rendering failure could masquerade as drift proof.
    await expect(builder).toHaveScreenshot(reference)

    // Simulate a release changing the package's padding. Reuse the identical
    // screenshot assertion and design crop, at the project's 0.001 tolerance.
    await page.addStyleTag({
      content: '.sb-filter-builder { padding: 24px !important; }',
    })
    await expect(
      expect(builder).toHaveScreenshot(reference, { timeout: 1000 }),
    ).rejects.toThrow(/pixels .*are different/)
  })
}
