import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import type Handsontable from 'handsontable/base'

interface GridWindow extends Window {
  sheetbaseTestGrid: Handsontable
}

async function selection(page: Page) {
  return page.evaluate(() =>
    (window as unknown as GridWindow).sheetbaseTestGrid.getSelected(),
  )
}

async function openGridFixture(page: Page) {
  await page.goto('/')
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({
    type: 'module',
    content: "import('/tests/browser/fixtures/grid-keyboard.tsx')",
  })
}

test('canonical Sheet keyboard navigation, selection, editing, and focus', async ({
  page,
}) => {
  await openGridFixture(page)
  const grid = page.getByRole('treegrid', {
    name: 'Purification summary Sheet',
  })
  await expect(grid).toBeVisible()
  await expect(grid).toHaveAttribute('aria-describedby', /.+/)

  await page.getByRole('button', { name: 'Before grid' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('td[aria-selected="true"]')).toHaveText('local-1')
  const focusRing = await grid
    .locator('xpath=ancestor::section')
    .evaluate((element) => getComputedStyle(element).boxShadow)
  expect(focusRing).not.toBe('none')

  await page.keyboard.press('ArrowRight')
  await expect(page.locator('td[aria-selected="true"]')).toHaveText(
    'governed-1',
  )
  await page.keyboard.press('Shift+ArrowDown')
  expect(await selection(page)).toEqual([[0, 1, 1, 1]])

  await page.keyboard.press('Home')
  expect(await selection(page)).toEqual([[0, 0, 0, 0]])
  await page.keyboard.press('End')
  expect(await selection(page)).toEqual([[0, 2, 0, 2]])
  await page.keyboard.press('Control+End')
  expect(await selection(page)).toEqual([[29, 2, 29, 2]])
  await page.keyboard.press('Control+Home')
  expect(await selection(page)).toEqual([[0, 0, 0, 0]])

  await page.keyboard.press('PageDown')
  expect((await selection(page))?.[0]?.[0]).toBeGreaterThan(0)
  await page.keyboard.press('PageUp')
  expect((await selection(page))?.[0]?.[0]).toBe(0)
  await page.keyboard.press('Shift+PageDown')
  expect((await selection(page))?.[0]?.[2]).toBeGreaterThan(0)
  await page.keyboard.press('Control+Home')

  await page.keyboard.press('Enter')
  const editor = page.locator('textarea.handsontableInput')
  await expect(editor).toBeVisible()
  await page.keyboard.press('ArrowRight')
  expect(await selection(page)).toEqual([[0, 0, 0, 0]])
  await page.keyboard.press('Escape')
  expect(
    await page.evaluate(
      () =>
        (window as unknown as GridWindow).sheetbaseTestGrid
          .getActiveEditor()
          ?.isOpened() ?? false,
    ),
  ).toBe(false)

  await page
    .getByRole('gridcell', { name: 'governed-6', exact: true })
    .click({ modifiers: ['Control'] })
  expect(await selection(page)).toEqual([
    [0, 0, 0, 0],
    [5, 1, 5, 1],
  ])
  await page.keyboard.press('Shift+ArrowDown')
  expect(await selection(page)).toEqual([
    [0, 0, 0, 0],
    [5, 1, 6, 1],
  ])

  await page.evaluate(() => {
    const hot = (window as unknown as GridWindow).sheetbaseTestGrid
    hot.selectCell(0, 2)
    hot.getFocusManager().focusOnHighlightedCell()
  })
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'After grid' })).toBeFocused()

  await page.evaluate(() => {
    const hot = (window as unknown as GridWindow).sheetbaseTestGrid
    hot.selectCell(0, 0)
    hot.getFocusManager().focusOnHighlightedCell()
  })
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Before grid' })).toBeFocused()
})

test('active-range copy and cut fail closed over derived cells', async ({
  page,
}) => {
  await openGridFixture(page)
  await expect(
    page.getByRole('treegrid', { name: 'Purification summary Sheet' }),
  ).toBeVisible()

  const copyContract = await page.evaluate(() => {
    const hot = (window as unknown as GridWindow).sheetbaseTestGrid
    hot.selectCells([
      [0, 0, 0, 1],
      [2, 1, 3, 2],
    ])
    const plugin = hot.getPlugin('copyPaste')
    plugin.setCopyableText()
    return {
      ranges: plugin.copyableRanges,
      data: plugin.getRangedData(plugin.copyableRanges),
    }
  })
  expect(copyContract).toEqual({
    ranges: [{ startRow: 2, startCol: 1, endRow: 3, endCol: 2 }],
    data: [
      ['governed-3', 'derived-3'],
      ['governed-4', 'derived-4'],
    ],
  })

  await page.evaluate(() => {
    const hot = (window as unknown as GridWindow).sheetbaseTestGrid
    hot.getFocusManager().focusOnHighlightedCell()
  })
  await page.keyboard.press('Control+x')
  const cutStatus = page.locator('[aria-live="polite"]')
  await expect(cutStatus).toBeVisible()
  await expect(cutStatus).toContainText(
    'active range contains read-only or derived cells',
  )
  expect(
    await page.evaluate(() => {
      const hot = (window as unknown as GridWindow).sheetbaseTestGrid
      return [hot.getDataAtCell(2, 1), hot.getDataAtCell(2, 2)]
    }),
  ).toEqual(['governed-3', 'derived-3'])
})
