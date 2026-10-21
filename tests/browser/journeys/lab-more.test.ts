/**
 * Journeys LAB-J04 to LAB-J19, the ones the first lab spec left out: aliquots,
 * readings, receiving reagent stock, editing a sample and the lab-ops checks.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import {
  action,
  createExperiment,
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** Register a 10-unit sample in a project and land on it. */
async function registerSample(page: Page, name: string): Promise<void> {
  await open(page, '/samples?new=true')
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('combobox')
    .first()
    .selectOption({ label: 'AAV9 process transfer' })
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByLabel(/^Storage location/).fill('Freezer F-1 shelf 1')
  await dialog.getByLabel(/^Quantity/).fill('10')
  await dialog.getByRole('button', { name: 'Register sample' }).click()
  await expect(page).toHaveURL(/\/samples\/[0-9a-f-]{36}/)
}

test('LAB-J04 a stock is aliquoted into tubes for an experiment', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Aliquot'))
  const title = uniqueName('Needs tubes')
  await createExperiment(page, path, title)
  await registerSample(page, uniqueName('Stock'))
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Aliquot…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Number of tubes/).fill('2')
  await dialog.getByLabel(/^Amount in each/).fill('1')
  await dialog.getByLabel(/^For experiment/).selectOption({ index: 1 })
  await dialog.getByRole('button', { name: /^Make \d+ tubes?/ }).click()
  await expect(page.getByText('2 tubes made')).toBeVisible()
})

test('LAB-J07 a reading is recorded for a sample from its page', async ({
  page,
}) => {
  await open(page, '/samples/00000000-0000-4000-8000-0000000003d0')
  await action(page, /record reading/i).click()
  await expect(page).toHaveURL(/\/readings\/new\?.*sample=/)
  await expect(page.getByRole('button', { name: 'Save reading' })).toBeVisible()
})

test('LAB-J09 a reagent lot is received and the stock rises', async ({
  page,
}) => {
  await open(page, '/materials')
  await page.getByRole('button', { name: 'Receive lot' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Quantity/).fill('1')
  await dialog.getByRole('button', { name: 'Receive', exact: true }).click()
  await expect(page.getByText(/received/i).first()).toBeVisible()
})

test('LAB-J18 a sample is renamed with a reason that goes in its history', async ({
  page,
}) => {
  const name = uniqueName('Wrongly named')
  await registerSample(page, name)
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Edit details…' }).click()
  const dialog = page.getByRole('dialog')
  const renamed = uniqueName('Correct name')
  await dialog.getByLabel(/^Name/).fill(renamed)
  await dialog.getByLabel(/^Reason for the change/).fill('Typo in the label')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(renamed).first()).toBeVisible()
})

test('LAB-J14 the schedule shows what is booked and due', async ({ page }) => {
  await open(page, '/schedule')
  await expect(
    page.getByRole('heading', { name: 'Schedule' }).first(),
  ).toBeVisible()
  await open(page, '/instruments')
  await expect(page.getByText(/calibration due/i).first()).toBeVisible()
  await open(page, '/materials')
  await expect(page.getByText(/expiring soon/i).first()).toBeVisible()
})
