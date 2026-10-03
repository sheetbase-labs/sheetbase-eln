/**
 * COMP-06 — restored browser coverage for keyboard selection and navigation,
 * now driven through the `@sheetbase-labs/sheetbase-table` engine.
 *
 * The deleted Handsontable spec mounted a bespoke fixture and read the engine
 * through `window.sheetbaseTestGrid`. This version drives a real bound route —
 * the design seed's "Clarification working sheet" (rendered by
 * `CanonicalSheetWorkspace` through the shared `SheetbaseGrid` wrapper) — and
 * asserts only observable grid state: ARIA selection on rendered cells, the
 * in-cell editor, and where document focus lands.
 *
 * Engine mapping (sheetbase-table 0.5.0) the assertions encode:
 * - Arrow keys move the active cell; Shift+Arrow extends the active range;
 *   Ctrl+Arrow moves to an edge.
 * - Home/End move within a row; Ctrl+Home/Ctrl+End jump to a corner.
 * - PageUp/PageDown move a viewport; Shift+PageDown extends.
 * - Enter does *not* open the editor (it moves the selection down); edits are
 *   started with F2, a printable key, or a double-click. Enter commits an open
 *   edit and moves down. Escape discards it.
 * - The grid is a single tab stop: Tab moves right inside it and, at the last
 *   column, releases focus to the page.
 * Ctrl/Cmd-click multi-range is not implemented by the engine; see the task
 * report for that deferred behaviour.
 */
import { expect, test } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'
import { config } from 'dotenv'
import { Client } from 'pg'

config({ path: ['.env.local', '.env'] })

const SHEET_NAME = 'Clarification working sheet'

let sheet: { id: string; projectId: string }

test.beforeAll(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{
      id: string
      project_id: string
    }>(
      `select id, project_id from api.sheet_instances
        where name = $1 order by created_at limit 1`,
      [SHEET_NAME],
    )
    const row = rows[0]
    if (!row) {
      throw new Error(
        `Design seed is missing the "${SHEET_NAME}" sheet instance. Run pnpm db:fresh --design.`,
      )
    }
    sheet = { id: row.id, projectId: row.project_id }
  } finally {
    await client.end()
  }
})

/** The design working sheet renders read-only unless the project is in search. */
async function openBoundSheet(page: Page): Promise<Locator> {
  await page.goto(`/sheets/${sheet.id}?projectId=${sheet.projectId}`)
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  return grid
}

/** A rendered cell by display coordinates (1-based, as the engine exposes). */
function cell(page: Page, row: number, col: number): Locator {
  return page.locator(
    `[role="gridcell"][aria-rowindex="${row}"][aria-colindex="${col}"]`,
  )
}

/** Every cell carrying the range's `aria-selected` state. */
function selectedCells(page: Page): Locator {
  return page.locator('[role="gridcell"][aria-selected="true"]')
}

/** Park the selection on a display coordinate using keyboard navigation only. */
async function navigateTo(
  page: Page,
  row: number,
  col: number,
): Promise<void> {
  await page.keyboard.press('Control+Home')
  for (let index = 1; index < col; index += 1)
    await page.keyboard.press('ArrowRight')
  for (let index = 1; index < row; index += 1)
    await page.keyboard.press('ArrowDown')
}

/**
 * The first blank, writable data cell (never the trailing spare row), found
 * from the rendered grid so the assertions survive the seed's row layout.
 */
async function firstBlankEditableCell(
  page: Page,
): Promise<{ row: number; col: number }> {
  const found = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')
    const rowCount = Number(grid?.getAttribute('aria-rowcount') ?? 0)
    for (const element of document.querySelectorAll('[role="gridcell"]')) {
      const row = Number(element.getAttribute('aria-rowindex'))
      const col = Number(element.getAttribute('aria-colindex'))
      if (row >= rowCount) continue
      if ((element.textContent ?? '').trim() !== '') continue
      if (String(element.className).includes('read-only')) continue
      return { row, col }
    }
    return null
  })
  if (!found) throw new Error('No blank writable cell found in the sheet.')
  return found
}

test('keyboard navigation, range extension and the grid as one tab stop', async ({
  page,
}) => {
  const grid = await openBoundSheet(page)
  const region = page.getByRole('region', { name: 'Sheet' })
  await expect(region).toHaveAttribute('aria-describedby', /\S+/)

  const colCount = Number(await grid.getAttribute('aria-colcount'))
  const rowCount = Number(await grid.getAttribute('aria-rowcount'))
  expect(colCount).toBeGreaterThan(1)
  expect(rowCount).toBeGreaterThan(1)

  // One tab stop: Tab from the control before the grid lands on the grid
  // itself, and the shell shows its focus ring.
  await page.getByRole('button', { name: 'Reset view' }).focus()
  await page.keyboard.press('Tab')
  await expect(grid).toBeFocused()
  await expect(region).not.toHaveCSS('box-shadow', 'none')

  // Single-cell movement.
  await page.keyboard.press('Control+Home')
  await expect(cell(page, 1, 1)).toHaveAttribute('aria-selected', 'true')
  await expect(selectedCells(page)).toHaveCount(1)

  await page.keyboard.press('ArrowRight')
  await expect(cell(page, 1, 2)).toHaveAttribute('aria-selected', 'true')
  await expect(selectedCells(page)).toHaveCount(1)

  await page.keyboard.press('ArrowDown')
  await expect(cell(page, 2, 2)).toHaveAttribute('aria-selected', 'true')

  // Shift extends the active range.
  await page.keyboard.press('Shift+ArrowDown')
  await expect(selectedCells(page)).toHaveCount(2)
  await expect(cell(page, 2, 2)).toHaveAttribute('aria-selected', 'true')
  await expect(cell(page, 3, 2)).toHaveAttribute('aria-selected', 'true')

  // Home and End move within the row.
  await page.keyboard.press('Home')
  await expect(cell(page, 3, 1)).toHaveAttribute('aria-selected', 'true')
  await expect(selectedCells(page)).toHaveCount(1)

  // End moves to the row's last populated cell (trailing blanks stay behind).
  const endColumn = await page.evaluate((row) => {
    let last = 1
    for (const element of document.querySelectorAll(
      `[role="gridcell"][aria-rowindex="${row}"]`,
    )) {
      if ((element.textContent ?? '').trim() === '') continue
      last = Math.max(last, Number(element.getAttribute('aria-colindex')))
    }
    return last
  }, 3)
  expect(endColumn).toBeGreaterThan(1)
  await page.keyboard.press('End')
  await expect(cell(page, 3, endColumn)).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Ctrl+Home / Ctrl+End move to the grid corners.
  await page.keyboard.press('Control+Home')
  await expect(cell(page, 1, 1)).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Control+End')
  await expect(cell(page, rowCount - 1, colCount)).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Page Up / Page Down move by a viewport; Shift extends.
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('PageDown')
  await expect(selectedCells(page)).toHaveCount(1)
  const afterPageDown = await selectedCells(page).getAttribute('aria-rowindex')
  expect(Number(afterPageDown)).toBeGreaterThan(1)

  await page.keyboard.press('PageUp')
  await expect(cell(page, 1, 1)).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Shift+PageDown')
  expect(await selectedCells(page).count()).toBeGreaterThan(1)
})

test('Tab moves right inside the grid and leaves at the horizontal edge', async ({
  page,
}) => {
  const grid = await openBoundSheet(page)

  await page.getByRole('button', { name: 'Reset view' }).focus()
  await page.keyboard.press('Tab')
  await expect(grid).toBeFocused()

  // Tab steps a column to the right and keeps focus inside the grid.
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Tab')
  await expect(cell(page, 1, 2)).toHaveAttribute('aria-selected', 'true')
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="grid"]')),
    ),
  ).toBe(true)

  // At the last column Tab is no longer consumed: focus leaves the grid.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Tab')
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="grid"]')),
    ),
  ).toBe(false)

  // Shift+Tab from the page returns to the single grid tab stop.
  await page.keyboard.press('Shift+Tab')
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="grid"]')),
    ),
  ).toBe(true)
})

test('a printable key starts an in-cell edit; Enter commits, Escape discards', async ({
  page,
}) => {
  const grid = await openBoundSheet(page)
  await grid.click({ position: { x: 40, y: 60 } })

  const target = await firstBlankEditableCell(page)
  await navigateTo(page, target.row, target.col)
  await expect(cell(page, target.row, target.col)).toHaveAttribute(
    'aria-selected',
    'true',
  )

  const editor = page.locator('input.cell-editor')

  // Typing a printable key opens the editor seeded with that character.
  await page.keyboard.press('4')
  await expect(editor).toBeVisible()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('4')
  await expect(editor).toHaveAttribute('aria-label', /^Edit [A-Z]+\d+$/)

  await page.keyboard.type('2')
  await expect(editor).toHaveValue('42')

  // Arrow keys move the caret, not the grid selection, while editing.
  await page.keyboard.press('ArrowRight')
  await expect(editor).toBeVisible()
  await expect(cell(page, target.row, target.col)).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // F2 also opens the editor on the existing value.
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(cell(page, target.row, target.col)).toHaveText('')

  await page.keyboard.press('F2')
  await expect(editor).toBeVisible()
  await expect(editor).toHaveValue('')
  await page.keyboard.type('42')
  await expect(editor).toHaveValue('42')

  // Enter commits the edit and moves the selection down a row.
  await page.keyboard.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(cell(page, target.row, target.col)).toHaveText('42')
  await expect(cell(page, target.row + 1, target.col)).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Escape discards a subsequent edit without touching the cell.
  await navigateTo(page, target.row, target.col)
  await page.keyboard.press('F2')
  await expect(editor).toHaveValue('42')
  await page.keyboard.type('777')
  await expect(editor).toHaveValue('42777')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(cell(page, target.row, target.col)).toHaveText('42')

  // Restore the seed cell so the spec is idempotent.
  await navigateTo(page, target.row, target.col)
  await page.keyboard.press('F2')
  await expect(editor).toHaveValue('42')
  for (let index = 0; index < 5; index += 1)
    await page.keyboard.press('Backspace')
  await expect(editor).toHaveValue('')
  await page.keyboard.press('Enter')
  await expect(cell(page, target.row, target.col)).toHaveText('')
})
