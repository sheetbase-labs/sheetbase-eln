import { createRequire } from 'node:module'
import type { AxeResults } from 'axe-core'
import { expect, test } from 'playwright/test'

import { visitDesignState } from './state-driver'

for (const theme of ['light', 'dark'] as const) {
  test(`registered shortcuts article and modal — ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }),
    )
    await visitDesignState(page, {
      screen: 'Shortcuts',
      route: '/help/shortcuts',
      user: 'gareth',
      theme,
      size: { width: 1440, height: 900 },
    })
    const main = page.locator('#main')
    await expect(
      main.getByRole('heading', { name: 'Anywhere', level: 2 }),
    ).toBeVisible()
    await expect(
      main.getByText('Collapse the sidebar', { exact: true }),
    ).toBeVisible()
    await expect(main.getByText('Go to Samples', { exact: true })).toBeVisible()
    for (const shortcut of [
      'Add to selection',
      'Save the row',
      'Approve and sign…',
    ]) {
      await expect(main.getByText(shortcut, { exact: true })).toBeVisible()
    }
    const palette = main
      .getByText('Search and jump', { exact: true })
      .locator('..')
    await expect(palette.locator('kbd')).toHaveText(['⌘', 'K'])
    await expect(
      main.getByText('Go to Home', { exact: true }).locator('..').locator('dd'),
    ).toHaveText('G then H')
    await main
      .getByRole('link', { name: 'Windows / Linux', exact: true })
      .click()
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
    ).toHaveCount(0)
    for (const heading of ['Lists', 'Notebook and sheets', 'Review']) {
      await expect(
        dialog.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible()
    }
    for (const shortcut of [
      'Add to selection',
      'Save the row',
      'Approve and sign…',
    ]) {
      await expect(dialog.getByText(shortcut, { exact: true })).toBeVisible()
    }
    await expect(
      dialog.getByRole('link', { name: 'Focus order' }),
    ).toHaveAttribute('href', '/help/shortcuts#focus-order')
    await page.screenshot({
      path: `.amp/in/artifacts/shell03-shortcuts-${theme}.png`,
      animations: 'disabled',
    })
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
    await expect(
      dialog.getByText('Add to selection', { exact: true }),
    ).toBeVisible()
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
      summary.getByText('Collapse the sidebar', { exact: true }),
    ).toBeVisible()
    await expect(
      summary.getByText('Search and jump', { exact: true }),
    ).toBeVisible()
    await expect(
      summary.getByText('Approve and sign…', { exact: true }),
    ).toHaveCount(0)
  })
}
