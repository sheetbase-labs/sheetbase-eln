import { expect, test } from 'playwright/test'
import { open, signIn, uniqueName, withAdminDb } from './journeys/helpers'

test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
test.setTimeout(90_000)

test('actual pages stay independent through splitting, navigation, arrangement and reload', async ({
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
  const workspace = page.getByRole('region', { name: 'Workspace', exact: true })
  await expect(workspace).toBeVisible()
  await expect(
    workspace.getByRole('heading', { name: dataset.name, exact: true }),
  ).toBeVisible()
  await workspace
    .getByRole('button', { name: 'Split right', exact: true })
    .click()
  const panes = workspace.locator('[data-workspace-pane]')
  await expect(panes).toHaveCount(2)
  await expect
    .poll(async () => {
      const first = await panes.nth(0).boundingBox()
      const second = await panes.nth(1).boundingBox()
      return Boolean(
        first &&
        second &&
        second.x >= first.x + first.width &&
        Math.abs(second.y - first.y) < 2 &&
        second.x + second.width <= 1600,
      )
    })
    .toBe(true)
  await expect(
    panes.nth(0).getByRole('heading', { name: dataset.name, exact: true }),
  ).toBeVisible()
  await expect(
    panes.nth(1).getByRole('heading', { name: dataset.name, exact: true }),
  ).toBeVisible()
  const separator = workspace.getByLabel('Resize panes')
  const initialWidth = (await panes.nth(0).boundingBox())!.width
  const gutter = await separator.boundingBox()
  expect(gutter?.height).toBeGreaterThan(800)
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await panes.nth(0).boundingBox())!.width)
    .toBeGreaterThan(initialWidth)
  const dragTarget = await separator.boundingBox()
  if (!dragTarget) throw new Error('Missing resize gutter')
  const dragX = dragTarget.x + dragTarget.width / 2
  await page.mouse.move(dragX, dragTarget.y + 200)
  await page.mouse.down()
  await page.mouse.move(dragX - 100, dragTarget.y + 200, { steps: 12 })
  await page.mouse.up()
  await expect
    .poll(async () => (await panes.nth(0).boundingBox())!.width)
    .toBeLessThan(initialWidth)
  await page.getByRole('link', { name: 'Samples', exact: true }).click()
  await expect(
    panes.nth(1).getByRole('heading', { name: 'Samples', exact: true }),
  ).toBeVisible()
  await expect(
    panes.nth(0).getByRole('heading', { name: dataset.name, exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/samples$/)
  await expect(page.locator('html')).toHaveCount(1)
  await expect(page.locator('#main')).toHaveCount(1)

  await workspace.getByRole('button', { name: 'Maximise', exact: true }).click()
  await expect(panes.nth(0)).not.toBeVisible()
  await expect(panes.nth(1)).toBeVisible()
  await workspace
    .getByRole('button', { name: 'Restore layout', exact: true })
    .click()
  await expect(panes.nth(0)).toBeVisible()
  await page.reload()
  await expect(panes).toHaveCount(2)
  await expect(
    panes.nth(0).getByRole('heading', { name: dataset.name, exact: true }),
  ).toBeVisible()
  await expect(
    panes.nth(1).getByRole('heading', { name: 'Samples', exact: true }),
  ).toBeVisible()

  await page.setViewportSize({ width: 600, height: 900 })
  await expect(workspace.getByRole('tablist', { name: 'Panes' })).toBeVisible()
  await expect(panes.nth(0)).not.toBeVisible()
  await expect(panes.nth(1)).toBeVisible()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect(panes.nth(0)).toBeVisible()
  await expect(panes.nth(1)).toBeVisible()
  await panes.nth(1).getByRole('button', { name: 'Arrange Samples' }).click()
  await page.getByRole('menuitem', { name: /Join .* tabs/ }).click()
  await expect(workspace.getByRole('tablist', { name: 'Panes' })).toBeVisible()
  await expect(panes.nth(0)).not.toBeVisible()
  await expect(panes.nth(1)).toBeVisible()
  // Keyboard docking uses the shared component without unmounting either page.
  await workspace.getByRole('tab', { name: 'Samples', exact: true }).focus()
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await expect(panes.nth(0)).toBeVisible()
  await expect
    .poll(async () => {
      const first = await panes.nth(0).boundingBox()
      const second = await panes.nth(1).boundingBox()
      return Boolean(
        first &&
        second &&
        second.y >= first.y + first.height &&
        second.y + second.height <= 1000 &&
        Math.abs(second.x - first.x) < 2,
      )
    })
    .toBe(true)
  await panes
    .nth(1)
    .getByRole('button', { name: /Close .* pane/ })
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
  const workspace = page.getByRole('region', { name: 'Workspace', exact: true })
  await expect(
    workspace.getByRole('heading', { name: 'Analysis Studio', exact: true }),
  ).toBeVisible()
  await expect(
    workspace.getByLabel('Y axis field', { exact: true }),
  ).toBeVisible()
  await workspace
    .getByRole('button', { name: 'Split right', exact: true })
    .click()
  const panes = workspace.locator('[data-workspace-pane]')
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
  await page.getByRole('link', { name: 'Samples', exact: true }).click()
  await expect(
    panes.nth(1).getByRole('heading', { name: 'Analysis Studio', exact: true }),
  ).toBeVisible()
  await expect(field).not.toHaveValue(original)
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
  await expect(
    panes.nth(0).getByLabel('Y axis field', { exact: true }),
  ).toHaveValue(original)
})
