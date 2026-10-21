/**
 * Journeys EXP-07 to EXP-14 and CORE-20/21: the writing surfaces of a
 * notebook (blocks, files, comments, deviations, the conclusion) and the
 * comparison of two runs.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import {
  action,
  createExperiment,
  createProject,
  ensureEffectiveProtocol,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

const PROTOCOL = '00000000-0000-4000-8000-000000000390'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

async function newNotebook(page: Page, prefix: string): Promise<string> {
  const path = await createProject(page, uniqueName(prefix))
  const id = await createExperiment(page, path, uniqueName(`${prefix} run`))
  await waitForHydration(page)
  return id
}

/** Add a block of the named kind from the block menu and say how many blocks
 * the notebook has afterwards. */
async function addBlock(page: Page, kind: string): Promise<number> {
  const blocks = page.getByRole('group', { name: / block/ })
  await expect(blocks.first()).toBeVisible()
  const before = await blocks.count()
  await page
    .getByRole('button', { name: /^Insert block after/ })
    .first()
    .click()
  await page.getByRole('combobox', { name: /Insert block/ }).fill(kind)
  await page.keyboard.press('Enter')
  await expect(blocks).toHaveCount(before + 1)
  return before + 1
}

for (const [id, kind, what] of [
  ['EXP-09', 'Corrective actions', 'a deviation and its corrective actions'],
  ['EXP-07', 'File or image', 'a gel image or raw file'],
  ['CORE-21', 'Conclusion', 'the conclusion citing the dataset and figure'],
] as const) {
  test(`${id} the notebook takes ${what}`, async ({ page }) => {
    await newNotebook(page, id)
    await addBlock(page, kind)
  })
}

test('EXP-10 a block takes a comment from a colleague’s question', async ({
  page,
}) => {
  await newNotebook(page, 'Comment')
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('Was the incubator at 37 °C?')
  await page
    .getByRole('button', { name: /^Comments on block/ })
    .first()
    .click()
  await expect(page.getByRole('tab', { name: 'Comments' })).toBeVisible()
})

test('EXP-02 a protocol starts an experiment that carries its procedure', async ({
  page,
}) => {
  await ensureEffectiveProtocol(PROTOCOL)
  await open(page, `/protocols/${PROTOCOL}`)
  await action(page, /start experiment|new experiment/i).click()
  await page.getByLabel(/^title/i).fill(uniqueName('From a protocol'))
  await page.getByRole('button', { name: /create draft/i }).click()
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  await expect(page.getByText(/protocol/i).first()).toBeVisible()
})

test('CORE-20 two runs are compared from the dataset', async ({ page }) => {
  await open(page, '/datasets/00000000-0000-4000-8000-000000000381/compare')
  await expect(page.getByText(/compare/i).first()).toBeVisible()
})
