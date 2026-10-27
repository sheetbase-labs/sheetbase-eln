import { expect, test } from 'playwright/test'
import {
  open,
  signIn,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './journeys/helpers'

test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
test.setTimeout(90_000)

const region = (page: import('playwright/test').Page) =>
  page.getByRole('region', { name: 'Workspace', exact: true })

async function menu(
  page: import('playwright/test').Page,
  pane: import('playwright/test').Locator,
  item: RegExp,
) {
  await pane.getByRole('button', { name: /^More actions for/ }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('splits compose a grid of real pages and survive a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1800 })
  await signIn(page)
  await open(page, '/samples')
  const workspace = region(page)
  const panes = workspace.locator('[data-workspace-pane]')
  await expect(panes).toHaveCount(1)

  await menu(page, panes.nth(0), /^Split right/)
  await menu(page, panes.nth(0), /^Split below/)
  await menu(page, panes.nth(2), /^Split below/)
  await expect(panes).toHaveCount(4)
  await expect(
    workspace.getByRole('heading', { name: 'Samples', exact: true }),
  ).toHaveCount(4)
  const visible = () =>
    panes.evaluateAll((elements) =>
      elements.every((element) => {
        const box = element.getBoundingClientRect()
        return (
          box.width >= 280 &&
          box.height >= 280 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight
        )
      }),
    )
  await expect.poll(visible).toBe(true)
  // The workspace mounts after hydration, so wait for it before counting.
  await page.reload()
  await waitForHydration(page)
  await expect(panes).toHaveCount(4)
  await expect.poll(visible).toBe(true)
})

test('layout presets rearrange panes without losing any of them', async ({
  page,
}) => {
  await signIn(page)
  await open(page, '/samples')
  const workspace = region(page)
  const panes = workspace.locator('[data-workspace-pane]')
  await menu(page, panes.nth(0), /^Split right/)
  await menu(page, panes.nth(0), /^Split right/)
  await expect(panes).toHaveCount(3)
  await workspace
    .getByRole('group', { name: 'Layout presets' })
    .getByRole('button', { name: /rows/i })
    .first()
    .click()
  await expect(panes).toHaveCount(3)
  await expect
    .poll(async () => {
      const boxes = await panes.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().x),
      )
      return new Set(boxes.map(Math.round)).size
    })
    .toBe(1)
})

test('actual pages stay independent through splitting, navigation, resizing and reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dataset = await withAdminDb(async (db) => {
    const result = await db.query<{ id: string; name: string }>(
      `select id, name from api.datasets where workspace_id = '00000000-0000-4000-8000-000000000300' and lifecycle = 'active' order by name limit 1`,
    )
    const row = result.rows[0]
    if (!row) throw new Error('Seeded dataset required')
    return row
  })
  await signIn(page)
  await open(page, `/datasets/${dataset.id}`)
  const workspace = region(page)
  await expect(workspace).toBeVisible()
  const panes = workspace.locator('[data-workspace-pane]')
  await menu(page, panes.nth(0), /^Split right/)
  await expect(panes).toHaveCount(2)
  await expect
    .poll(async () => {
      const first = await panes.nth(0).boundingBox()
      const second = await panes.nth(1).boundingBox()
      return Boolean(
        first &&
        second &&
        second.x >= first.x + first.width - 2 &&
        Math.abs(second.y - first.y) < 2 &&
        second.x + second.width <= 1600,
      )
    })
    .toBe(true)
  for (const index of [0, 1]) {
    await expect(
      panes
        .nth(index)
        .getByRole('heading', { name: dataset.name, exact: true }),
    ).toBeVisible()
  }

  const separator = workspace.getByLabel('Resize panes')
  const initialWidth = (await panes.nth(0).boundingBox())!.width
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await panes.nth(0).boundingBox())!.width)
    .toBeGreaterThan(initialWidth)

  // Sidebar navigation drives the focused pane only.
  await page.getByRole('link', { name: 'Samples', exact: true }).click()
  await expect(
    workspace
      .locator('[data-workspace-pane][data-workspace-focused]')
      .getByRole('heading', { name: 'Samples', exact: true }),
  ).toBeVisible()
  await expect(
    workspace.getByRole('heading', { name: dataset.name, exact: true }),
  ).toHaveCount(1)

  await menu(page, panes.nth(0), /^Maximise|^Restore layout/)
  await menu(page, panes.nth(0), /^Restore layout/)
  await page.reload()
  await waitForHydration(page)
  await expect(panes).toHaveCount(2)

  // Narrow viewports show one pane with number chips to switch.
  await page.setViewportSize({ width: 600, height: 900 })
  await expect(
    workspace.getByRole('group', { name: 'Panes', exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect(panes.nth(0)).toBeVisible()
  await expect(panes.nth(1)).toBeVisible()

  await panes
    .nth(1)
    .getByRole('button', { name: /^Close .* pane$/ })
    .click()
  await expect(panes).toHaveCount(1)
  expect(errors).toEqual([])
})

test('unsaved chart edits refuse close and navigation, then a saved pane can close', async ({
  page,
}) => {
  const datasetId = await withAdminDb(async (db) => {
    const result = await db.query<{ id: string }>(
      `select id from api.datasets where workspace_id = '00000000-0000-4000-8000-000000000300' and name = 'ELISA capsid titre and turbidity' and lifecycle = 'active' limit 1`,
    )
    if (!result.rows[0]) throw new Error('Seeded ELISA dataset required')
    return result.rows[0].id
  })
  await signIn(page)
  await open(page, `/analysis/new?dataset=${datasetId}`)
  const workspace = region(page)
  await expect(
    workspace.getByRole('heading', { name: 'Analysis Studio', exact: true }),
  ).toBeVisible()
  const panes = workspace.locator('[data-workspace-pane]')
  await menu(page, panes.nth(0), /^Split right/)
  await expect(panes).toHaveCount(2)
  const field = panes.nth(1).getByLabel('Y axis field', { exact: true })
  const original = await field.inputValue()
  await field.selectOption({ label: 'Turbidity' })
  expect(await field.inputValue()).not.toBe(original)
  await expect(
    panes.nth(0).getByLabel('Y axis field', { exact: true }),
  ).toHaveValue(original)
  await panes
    .nth(1)
    .getByRole('button', { name: 'Close Analysis Studio pane' })
    .click()
  await expect(panes).toHaveCount(2)
  await expect(
    page
      .getByText('Save pending edits before closing or leaving this page.')
      .first(),
  ).toBeVisible()
  await panes
    .nth(1)
    .getByRole('button', { name: 'Chart settings', exact: true })
    .click()
  const settings = page.getByRole('dialog', {
    name: 'Chart settings',
    exact: true,
  })
  await settings.getByRole('tab', { name: /^Views/ }).click()
  await settings.getByLabel('Analysis view name').fill(uniqueName('Pane draft'))
  await settings
    .getByRole('button', { name: 'Save analysis view', exact: true })
    .click()
  await expect(
    page.getByText('Analysis view saved', { exact: true }),
  ).toBeVisible()
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await panes
    .nth(1)
    .getByRole('button', { name: 'Close Analysis Studio pane' })
    .click()
  await expect(panes).toHaveCount(1)
})
