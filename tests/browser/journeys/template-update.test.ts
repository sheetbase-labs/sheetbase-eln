/**
 * Journey EXP-05: a lab lead publishes a new template version and moves the
 * notebooks made from the old one onto it in one pass.
 */
import { expect, test } from 'playwright/test'

import {
  createExperiment,
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './helpers'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('EXP-05 notebooks made from a template are moved to its new version together', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Template line'))
  const sourceId = await createExperiment(page, path, uniqueName('Good run'))
  await open(page, `/experiments/${sourceId}/overview`)
  await page.getByRole('button', { name: 'More experiment actions' }).click()
  await page.getByRole('menuitem', { name: 'Save as template' }).click()
  const dialog = page.getByRole('dialog')
  const name = uniqueName('Line template')
  await dialog
    .getByLabel(/name|title/i)
    .first()
    .fill(name)
  await dialog.getByRole('button', { name: /save/i }).last().click()
  await expect(page.getByText(/template/i).first()).toBeVisible()
  const lookup = () =>
    withAdminDb(
      async (db) =>
        (
          await db.query<{ id: string }>(
            `SELECT id FROM api.notebook_templates WHERE name = $1`,
            [name],
          )
        ).rows[0]?.id ?? '',
    )
  await expect.poll(lookup, { timeout: 20_000 }).not.toBe('')
  const templateId = await lookup()
  await open(page, `/templates/${templateId}/versions`)
  await waitForHydration(page)
  await page.getByRole('button', { name: /^Publish v1/ }).click()
  const publish = page.getByRole('dialog')
  await publish.getByLabel(/Reason for change/).fill('First release')
  await publish.getByRole('button', { name: 'Publish v1' }).click()
  await expect(page.getByText('Published').first()).toBeVisible()
  // Two notebooks start on v1.
  for (const title of [uniqueName('Run A'), uniqueName('Run B')]) {
    await open(page, `/templates/${templateId}`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Use template' }).click()
    const start = page.getByRole('dialog')
    await start
      .getByLabel(/Title|Name/)
      .first()
      .fill(title)
    await start.getByRole('button', { name: /^(Start|Create)/ }).click()
    await expect(page).toHaveURL(/\/experiments\//, { timeout: 20_000 })
  }
  // A new version: edit, add a section, save, publish.
  await open(page, `/templates/${templateId}`)
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Section key').fill('deviations')
  await page.getByPlaceholder('e.g. Pressure and ΔP').fill('Deviations')
  await page.getByRole('button', { name: 'Add section' }).click()
  await page.getByRole('button', { name: 'Save new version' }).click()
  await open(page, `/templates/${templateId}/versions`)
  await page.getByRole('button', { name: /^Publish v2/ }).click()
  const second = page.getByRole('dialog')
  await second.getByLabel(/Reason for change/).fill('Add deviations')
  await second.getByRole('button', { name: 'Publish v2' }).click()
  await expect(page.getByRole('button', { name: /^Publish v2/ })).toHaveCount(0)
  await open(page, `/templates/${templateId}/update`)
  await waitForHydration(page)
  await expect(
    page.getByText('Update 2 notebooks to v2 in one pass'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Update all to v2' }).click()
  await expect(page.getByText(/No notebook needs this version/)).toBeVisible({
    timeout: 20_000,
  })
})
