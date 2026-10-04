import { createRequire } from 'node:module'
import type { AxeResults } from 'axe-core'
import { expect, test } from 'playwright/test'

import { DESIGN_STATES } from './design-states'
import { visitDesignState } from './state-driver'

for (const state of DESIGN_STATES.filter(
  (entry) => entry.screen === 'HelpRecords',
)) {
  test(`HelpRecords Home section selection — ${state.theme}`, async ({
    page,
  }) => {
    await visitDesignState(page, state)
    const navigation = page.locator('nav[aria-label="Main"]:visible')
    const home = navigation.getByRole('link', { name: 'Home', exact: true })
    await expect(home).toHaveAttribute('aria-current', 'page')
    await expect(home).toHaveAttribute('href', '/')

    await page.setViewportSize({ width: 1100, height: 1000 })
    await expect(home).toHaveAttribute('aria-current', 'page')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
      navigation.getByRole('link', { name: 'Today', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('body')).toHaveCSS('min-width', '0px')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390)

    await page.setViewportSize(state.size)
    await navigation.getByRole('link', { name: /^Inbox\b/ }).click()
    await expect(page).toHaveURL(/\/inbox/)
    await expect(home).not.toHaveAttribute('aria-current', 'page')
    await expect(
      navigation.getByRole('link', { name: /^Inbox\b/ }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test(`HelpRecords accessible navigation — ${state.theme}`, async ({
    page,
  }) => {
    await visitDesignState(page, state)
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve('axe-core'),
    })
    const result = await page.evaluate<AxeResults>("axe.run('#main')")
    expect(result.violations).toEqual([])

    const signature = page.getByRole('link', {
      name: 'Set up your signature',
      exact: true,
    })
    await expect(signature).toHaveAttribute('href', '/settings/signatures')
    await signature.focus()
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('link', {
        name: 'Keyboard shortcuts',
        exact: true,
      }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/help\/shortcuts/)
    await expect(
      page.getByRole('heading', {
        name: 'Keyboard shortcuts',
        exact: true,
        level: 1,
      }),
    ).toBeVisible()
  })
}
