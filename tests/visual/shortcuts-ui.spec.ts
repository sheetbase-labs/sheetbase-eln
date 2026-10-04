import { createRequire } from 'node:module'
import type { AxeResults } from 'axe-core'
import { expect, test } from 'playwright/test'

import { visitDesignState } from './state-driver'

for (const theme of ['light', 'dark'] as const) {
  test(`registered shortcuts article and modal — ${theme}`, async ({
    page,
  }) => {
    await visitDesignState(page, {
      screen: 'Shortcuts',
      route: '/help/shortcuts',
      user: 'gareth',
      theme,
      size: { width: 1440, height: 900 },
    })
    const main = page.locator('#main')
    await expect(main.getByRole('heading', { name: 'Anywhere' })).toBeVisible()
    await expect(
      main.getByText('Collapse or expand navigation', { exact: true }),
    ).toBeVisible()
    await expect(main.getByText('Go to Samples', { exact: true })).toBeVisible()
    for (const absent of ['Select', 'Save the row', 'Approve and sign…']) {
      await expect(main.getByText(absent, { exact: true })).toHaveCount(0)
    }
    const palette = main
      .getByText('Open the command palette', { exact: true })
      .locator('..')
    await expect(palette.locator('kbd')).toHaveText(['⌘', 'K'])
    await expect(
      main.getByText('Go to Home', { exact: true }).locator('..').locator('dd'),
    ).toHaveText('G then H')
    await main.getByRole('link', { name: 'Windows', exact: true }).click()
    await expect(page).toHaveURL(/os=windows/)
    await expect(palette.locator('kbd')).toHaveText(['Ctrl', 'K'])

    const trigger = main.getByRole('button', {
      name: 'Show keyboard shortcuts',
      exact: true,
    })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText('Go to Samples', { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Lists' })).toHaveCount(0)
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve('axe-core'),
    })
    const result = await page.evaluate<AxeResults>(
      'axe.run(\'[role="dialog"]\')',
    )
    expect(result.violations).toEqual([])
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()

    // Scope changes must come from real navigation, not fake registrations.
    await page
      .locator('nav[aria-label="Main"]:visible')
      .getByRole('link', { name: /^Inbox\b/ })
      .click()
    await expect(page).toHaveURL(/\/inbox/)
    await page.keyboard.press('?')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Lists' })).toBeVisible()
    await expect(
      dialog.getByText('Move between rows', { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByText('Select', { exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog).toHaveCSS('width', '390px')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390)
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click()
    await expect(dialog).not.toBeVisible()

    await page.goto('/help')
    const summary = main.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Keyboard shortcuts',
        exact: true,
      }),
    })
    await expect(
      summary.getByText('Collapse or expand navigation', { exact: true }),
    ).toBeVisible()
    await expect(
      summary.getByText('Open the command palette', { exact: true }),
    ).toBeVisible()
    await expect(
      summary.getByText('Approve and sign…', { exact: true }),
    ).toHaveCount(0)
  })
}
