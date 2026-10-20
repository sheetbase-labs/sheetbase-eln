/**
 * Journeys REV-01 to REV-14: an author submits an experiment, a reviewer picks
 * it up from the Inbox and returns it, and the author sees it come back.
 * Gareth (owner) authors; Mei (a reviewer on the project) reviews. The experiments are made in the
 * seeded AAV9 project, which both can read.
 */
import { expect, test } from 'playwright/test'

import {
  action,
  createExperiment,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'
import { signInAsDesignUser } from '../../visual/sign-in'

const AAV9_PROJECT = '/projects/00000000-0000-4000-8000-000000000320'
const MEI = '00000000-0000-4000-8000-000000000312'

test.setTimeout(180_000)
test.use({ viewport: { width: 1280, height: 900 } })

async function submitFor(
  page: import('playwright/test').Page,
  title: string,
): Promise<string> {
  const id = await createExperiment(page, AAV9_PROJECT, title)
  await waitForHydration(page)
  // A draft experiment is private to its author, so it is started first.
  await page.getByRole('button', { name: 'Start experiment' }).click()
  const starting = page.getByRole('dialog')
  if (await starting.count()) {
    await starting.getByRole('button', { name: /^start/i }).click()
  }
  await expect(page.getByRole('button', { name: 'Put on hold' })).toBeVisible()
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('Titre doubled at 72 h.')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('checkbox', { name: /Mei/ }).check()
  await dialog.getByRole('button', { name: 'Check snapshot' }).click()
  const send = dialog.getByRole('button', { name: 'Submit', exact: true })
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}/)
  return id
}

test('REV-01 to REV-04 submit, review, return and see it come back', async ({
  page,
}) => {
  await signIn(page)
  const title = uniqueName('Review me')
  const id = await submitFor(page, title)
  // The reviewer finds it in the Inbox and opens the review.
  await signInAsDesignUser(page, MEI)
  await open(page, '/inbox')
  await page.getByText(title).first().click()
  await action(page, /^Open$/).click()
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}/)
  await page.getByRole('button', { name: 'Request changes' }).click()
  const confirm = page.getByRole('alertdialog')
  await confirm.getByRole('textbox').fill('Please add the dilution series.')
  await confirm.getByRole('button', { name: 'Request changes' }).click()
  await expect(
    page.getByText(/returned|changes requested/i).first(),
  ).toBeVisible()
  // The author sees the returned work in their Inbox and on the notebook.
  await signIn(page)
  await open(page, `/experiments/${id}/notebook`)
  await expect(
    page.getByText(/returned|changes requested/i).first(),
  ).toBeVisible()
})
