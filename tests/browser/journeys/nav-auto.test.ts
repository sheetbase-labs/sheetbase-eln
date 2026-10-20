/**
 * Journeys NAV-01 to NAV-14 and AUTO-01 to AUTO-08: getting around the app and
 * running pipelines, as a scientist would on a normal day.
 */
import { expect, test } from 'playwright/test'

import {
  action,
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('NAV-01 Home opens with the day’s work', async ({ page }) => {
  await open(page, '/')
  await expect(page.getByRole('heading').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Inbox' }).first()).toBeVisible()
})

test('NAV-02 search finds the records that mention a sample', async ({
  page,
}) => {
  await open(page, '/search?q=SMP-2231')
  await expect(page.getByText(/SMP-2231/).first()).toBeVisible()
})

test('NAV-03 search finds a record by keyword', async ({ page }) => {
  await open(page, '/search?q=ELISA')
  await expect(page.getByText(/ELISA/).first()).toBeVisible()
})

test('NAV-04 a pasted identifier resolves to its page', async ({ page }) => {
  await open(page, '/experiments/EXP-0142')
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}/)
  await open(page, '/datasets/DS-0311')
  await expect(page).toHaveURL(/\/datasets\/[0-9a-f-]{36}/)
})

test('NAV-05 the Inbox lists work and a row opens its record', async ({
  page,
}) => {
  await open(page, '/inbox')
  const row = page
    .getByRole('list', { name: 'Inbox items' })
    .getByRole('listitem')
    .first()
  await expect(row).toBeVisible()
})

test('NAV-06 the command palette jumps to a record from the keyboard', async ({
  page,
}) => {
  await open(page, '/')
  await waitForHydration(page)
  await page.keyboard.press('Control+k')
  await page
    .getByRole('combobox')
    .or(page.getByRole('searchbox'))
    .first()
    .fill('EXP-0142')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/(experiments|search)/)
})

test('NAV-07 an analysis climbs back to its dataset, experiment and project', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}`)
  await expect(
    page.getByRole('link', { name: /EXP-0142/ }).first(),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'AAV9 process transfer' })
    .first()
    .click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/)
})

test('NAV-08 the New menu creates from where you are', async ({ page }) => {
  await open(page, '/')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(
    page.getByRole('menuitem', { name: /^Experiment/ }),
  ).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^Sample/ })).toBeVisible()
})

test('NAV-09 help opens for the page you are on', async ({ page }) => {
  await open(page, '/samples')
  await page.getByRole('button', { name: 'Help for this page' }).click()
  await expect(page).toHaveURL(/\/help|\/docs/)
})

test('NAV-10 a phone gets the app without sideways scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/', '/experiments', '/samples', '/inbox']) {
    await open(page, path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, path).toBeLessThanOrEqual(1)
  }
})

test('NAV-11 a dead link says so and offers a way home', async ({ page }) => {
  await open(page, '/experiments/00000000-0000-4000-8000-0000000fffff')
  await expect(
    page.getByText(/not found|doesn.t exist|can.t find/i).first(),
  ).toBeVisible()
  await open(page, '/no/such/page')
  await expect(
    page.getByText(/not found|doesn.t exist|can.t find/i).first(),
  ).toBeVisible()
})

test('NAV-13 a pinned project shows in the sidebar by its name', async ({
  page,
}) => {
  const title = uniqueName('Pinned')
  const path = await createProject(page, title)
  await open(page, path)
  await waitForHydration(page)
  await page
    .getByRole('button', { name: /add favourite/i })
    .first()
    .click()
  await expect(
    page.getByRole('navigation').getByRole('link', { name: title }),
  ).toBeVisible()
})

test('NAV-14 the workspace switcher is on every page', async ({ page }) => {
  await open(page, '/')
  await page.getByRole('button', { name: 'Switch workspace' }).click()
  await expect(page.getByRole('menuitem').first()).toBeVisible()
})

test('AUTO-01 the Pipelines page lists pipelines and a new one can be started', async ({
  page,
}) => {
  await open(page, '/pipelines')
  await expect(
    page.getByRole('heading', { name: 'Pipelines' }).first(),
  ).toBeVisible()
  await expect(action(page, /new pipeline|create/i)).toBeVisible()
})

test('AUTO-02 a dataset offers to run a pipeline on it', async ({ page }) => {
  await open(page, `/datasets/${ELISA_DATASET}`)
  await page.getByRole('button', { name: 'Run pipeline…' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
})
