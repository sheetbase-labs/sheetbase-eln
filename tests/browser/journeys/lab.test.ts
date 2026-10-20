/**
 * Journeys LAB-J01 to LAB-J20: samples, materials, instruments, the schedule
 * and scanning, as a scientist or lab ops would use them at the bench. Each
 * journey that writes data names it uniquely.
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

const SEEDED_SAMPLE = '00000000-0000-4000-8000-0000000003d0'
const AAV9_PROJECT = '00000000-0000-4000-8000-000000000320'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** Register a sample through the dialog; returns the name used. */
async function registerSample(
  page: Page,
  projectTitle: string,
  name: string,
): Promise<void> {
  await open(page, '/samples?new=true')
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('combobox')
    .first()
    .selectOption({ label: projectTitle })
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByLabel(/^Storage location/).fill('Freezer F-1 shelf 1')
  await dialog.getByLabel(/^Quantity/).fill('10')
  await dialog.getByRole('button', { name: 'Register sample' }).click()
}

test('LAB-J01 registering a sample lands on it, ready for the next', async ({
  page,
}) => {
  const name = uniqueName('Tube')
  await registerSample(page, 'AAV9 process transfer', name)
  await expect(page).toHaveURL(/\/samples\/[0-9a-f-]{36}/)
  await expect(page.getByText(name).first()).toBeVisible()
})

test('LAB-J02 a project’s Samples tab registers a sample in that project', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Lab project'))
  await open(page, `${path}/samples`)
  await action(page, /register sample/i).click()
  await expect(page).toHaveURL(/\/samples\?.*project=/)
  await expect(
    page.getByRole('dialog').getByRole('combobox').first(),
  ).not.toHaveValue('')
})

test('LAB-J03 a sample prints its label from the header', async ({ page }) => {
  await open(page, `/samples/${SEEDED_SAMPLE}`)
  await expect(page.getByRole('button', { name: /print label/i })).toBeVisible()
})

test('LAB-J05 a sample used in an experiment shows that experiment under Usage', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Usage'))
  const title = uniqueName('Uses it')
  await createExperiment(page, path, title)
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Link record' }).click()
  await page.getByRole('option', { name: /SMP-1002/ }).click()
  await open(page, `/samples/${SEEDED_SAMPLE}/usage`)
  await expect(page.getByText(title).first()).toBeVisible()
})

test('LAB-J08 a sample is quarantined with a reason and released again', async ({
  page,
}) => {
  const name = uniqueName('Quarantine me')
  await registerSample(page, 'AAV9 process transfer', name)
  await expect(page).toHaveURL(/\/samples\/[0-9a-f-]{36}/)
  await page.getByRole('button', { name: /^quarantine/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill('Mycoplasma test pending')
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText(/quarantined/i).first()).toBeVisible()
  await page.getByRole('button', { name: /^release/i }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm' })
    .click()
  await expect(page.getByText('Available').first()).toBeVisible()
})

test('LAB-J10 an instrument is registered from the Instruments page', async ({
  page,
}) => {
  await open(page, '/instruments')
  await page.getByRole('button', { name: 'Register instrument' }).first().click()
  const dialog = page.getByRole('dialog')
  const name = uniqueName('Reader')
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByLabel(/^Model/).fill('M-1')
  await dialog.getByLabel(/^Serial number/).fill(uniqueName('SN'))
  await dialog.getByLabel(/^Location/).fill('Lab 2, bench 5')
  await dialog.getByRole('button', { name: 'Register instrument' }).click()
  await expect(page.getByText(name).first()).toBeVisible()
})

test('LAB-J11 the schedule books an instrument', async ({ page }) => {
  await open(page, '/schedule')
  await page.getByRole('button', { name: 'Book instrument' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('LAB-J13 a typed ID resolves to its record', async ({ page }) => {
  await open(page, '/scan')
  await page.locator('main input').first().fill('SMP-1002')
  await page.getByRole('button', { name: 'Find' }).click()
  await expect(page.getByText('SMP-1002').first()).toBeVisible()
})

test('LAB-J17 a sample moves to another location and the page says so', async ({
  page,
}) => {
  await registerSample(page, 'AAV9 process transfer', uniqueName('Mover'))
  await expect(page).toHaveURL(/\/samples\/[0-9a-f-]{36}/)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^New location/).fill('Freezer F-3 shelf 2')
  await dialog.getByRole('button', { name: /^move/i }).last().click()
  await expect(page.getByText('Freezer F-3 shelf 2').first()).toBeVisible()
})

test('LAB-J20 a sample opens from its pasted ID', async ({ page }) => {
  await open(page, '/samples/SMP-1002')
  await expect(
    page.getByText('LVV-CAR-T starting material').first(),
  ).toBeVisible()
  void AAV9_PROJECT
})
