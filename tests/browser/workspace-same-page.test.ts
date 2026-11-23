import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import { open, signIn, waitForHydration } from './journeys/helpers'

test.use({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 })

test.setTimeout(90_000)

const panes = (page: Page) =>
  page
    .getByRole('region', { name: 'Workspace', exact: true })
    .locator('[data-workspace-pane]')

/** The Samples link in the sidebar, which can be dragged onto a pane edge. */
const sidebarLink = (page: Page) =>
  page.locator('a[href="/samples"]:visible').first()

async function dragOntoEdge(
  page: Page,
  edge: 'left' | 'right' | 'top' | 'bottom',
) {
  const box = await panes(page).first().boundingBox()

  if (!box) throw new Error('no pane')

  const point = {
    left: { x: box.x + 12, y: box.y + box.height / 2 },
    right: { x: box.x + box.width - 12, y: box.y + box.height / 2 },
    top: { x: box.x + box.width / 2, y: box.y + 12 },
    bottom: { x: box.x + box.width / 2, y: box.y + box.height - 12 },
  }[edge]

  const link = await sidebarLink(page).boundingBox()

  if (!link) throw new Error('no link')
  await page.mouse.move(link.x + 10, link.y + link.height / 2)
  await page.mouse.down()
  await page.mouse.move(point.x - 40, point.y, { steps: 8 })
  await page.mouse.move(point.x, point.y, { steps: 8 })
  await page.mouse.up()
}

test('the page already open can be opened again beside itself', async ({
  page,
}) => {
  await signIn(page)
  await open(page, '/samples')
  await waitForHydration(page)
  await expect(panes(page)).toHaveCount(1)

  // Drag it to the right, then below the first pane, then to the left.
  await dragOntoEdge(page, 'right')
  await expect(panes(page)).toHaveCount(2)
  await dragOntoEdge(page, 'bottom')
  await expect(panes(page)).toHaveCount(3)
  await dragOntoEdge(page, 'left')
  await expect(panes(page)).toHaveCount(4)

  // Alt-click opens it again beside, and Alt+Shift below.
  await sidebarLink(page).click({ modifiers: ['Alt'] })
  await expect(panes(page)).toHaveCount(5)
  await sidebarLink(page).click({ modifiers: ['Alt', 'Shift'] })
  await expect(panes(page)).toHaveCount(6)

  // Every pane shows its own copy of the page.
  await expect(
    page.getByRole('heading', { name: 'Samples', exact: true }),
  ).toHaveCount(6)
})

test('each pane keeps its own filter', async ({ page }) => {
  await signIn(page)
  await open(page, '/samples')
  await waitForHydration(page)
  await dragOntoEdge(page, 'right')
  await expect(panes(page)).toHaveCount(2)

  const search = (index: number) =>
    panes(page).nth(index).getByRole('searchbox').first()

  await search(0).fill('zzz-no-match')
  await expect(search(0)).toHaveValue('zzz-no-match')
  await expect(search(1)).toHaveValue('')
})

test('no drop highlight shows where the drop would do nothing', async ({
  page,
}) => {
  await signIn(page)
  await open(page, '/samples')
  await waitForHydration(page)

  // The middle of a pane only cites into the primary notebook. On a list page
  // there is no notebook, so it must offer to open beside instead.
  const box = await panes(page).first().boundingBox()

  if (!box) throw new Error('no pane')
  const link = await sidebarLink(page).boundingBox()

  if (!link) throw new Error('no link')
  await page.mouse.move(link.x + 10, link.y + link.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 12,
  })
  await expect(page.locator('.mx-drop')).toHaveCount(1)
  await expect(page.locator('.mx-drop')).not.toContainText('Cite here')
  await expect(page.locator('.mx-drop')).toContainText('Open beside')
  await page.mouse.up()
  // What the highlight promised is what the drop does.
  await expect(panes(page)).toHaveCount(2)
})
