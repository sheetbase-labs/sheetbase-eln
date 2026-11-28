/**
 * The notebook's insert-block menu on a phone with the keyboard open. It must
 * open inside the strip of screen between the status bar and the keyboard,
 * wherever the caret is, and follow the screen when the keyboard opens late
 * or iOS pans the page.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import {
  DESIGN_USER,
  createExperiment,
  createProject,
  reload,
  signIn,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from '../journeys/helpers'
import {
  KEYBOARD_PX,
  PHONE,
  emulateInstalledApp,
  emulatePhone,
  expectFullyVisible,
  setKeyboard,
} from './phone'

/** The seeded design workspace the journeys run in. */
const DESIGN_WORKSPACE = '00000000-0000-4000-8000-000000000300'

test.use({ ...PHONE })
test.setTimeout(120_000)

// Each test makes its own project and notebook, so they spread across
// workers (and CI shards) instead of queueing behind each other in one.
test.describe.configure({ mode: 'parallel' })

let projectPath = ''
const LINES = 30

/**
 * Write the notebook's lines with the same insert the editor calls for a new
 * block, straight against the database. Typing thirty lines with Enter took
 * thirty round trips, each re-rendering the notebook a little slower than the
 * last, and on a busy CI machine the later ones outlasted the wait for the new
 * line. The test is about where the menu opens, not how fast blocks are made,
 * so the page is filled the quick way and only the line the menu opens in is
 * typed by hand.
 */
async function writeLines(recordId: string, count: number) {
  await withAdminDb(async (db) => {
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: DESIGN_USER,
        workspace_id: DESIGN_WORKSPACE,
        role: 'authenticated',
      }),
    ])
    const first = await db.query(
      'select id from api.blocks where record_id = $1',
      [recordId],
    )
    let previous: string = first.rows[0].id
    for (let line = 2; line <= count; line += 1) {
      const inserted = await db.query(
        `select (api.insert_block(
           p_record_id => $1,
           p_type => 'rich_text',
           p_payload => $2::jsonb,
           p_after_block_id => $3
         ))->'block'->>'id' as id`,
        [
          recordId,
          JSON.stringify({
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: `Observation ${line}` }],
                },
              ],
            },
          }),
          previous,
        ],
      )
      previous = inserted.rows[0].id
    }
    await db.query('commit')
  })
}

/**
 * A fresh draft notebook with enough lines to scroll, so the seeded notebooks
 * are never edited. The caret is left on an empty line.
 */
async function openDraftNotebook(page: Page) {
  await emulatePhone(page)
  await signIn(page)
  if (!projectPath) projectPath = await createProject(page, uniqueName('Phone'))
  const recordId = await createExperiment(
    page,
    projectPath,
    uniqueName('Phone notebook'),
  )
  await waitForHydration(page)
  await emulateInstalledApp(page)
  // A new draft opens on one empty text block: write the first line in it.
  const blocks = page.getByRole('group', { name: /^Text block/ })
  const editor = page.getByRole('textbox', { name: 'Text content' }).first()
  await editor.click()
  await expect(editor).toBeFocused()
  await page.keyboard.type('Observation 1', { delay: 10 })
  // The editor saves on its own a moment after typing: wait for it to land
  // before the page is reloaded.
  await expect
    .poll(() =>
      withAdminDb(async (db) =>
        JSON.stringify(
          (
            await db.query(
              'select payload from api.blocks where record_id = $1',
              [recordId],
            )
          ).rows,
        ),
      ),
    )
    .toContain('Observation 1')
  await writeLines(recordId, LINES)
  await reload(page)
  await emulateInstalledApp(page)
  await expect(blocks).toHaveCount(LINES)
  // Leave the caret in a new empty block in the middle, with blocks both
  // above and below it, so it can be scrolled anywhere on screen.
  await blocks
    .nth(LINES / 2 - 1)
    .getByText(`Observation ${LINES / 2}`, { exact: true })
    .click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(blocks).toHaveCount(LINES + 1)
  await expect(
    blocks.nth(LINES / 2).getByRole('textbox', { name: 'Text content' }),
  ).toBeFocused()
  return editor
}

/** Scroll the caret's (empty) line to `where` on screen and type a slash. */
async function typeSlashAt(page: Page, where: 'top' | 'middle' | 'bottom') {
  await page.evaluate((spot) => {
    const sel = window.getSelection()
    const node = sel?.focusNode
    const el = (node instanceof Element ? node : node?.parentElement) as
      HTMLElement | undefined
    if (!el) return
    const vv = window.visualViewport
    const visibleTop = (vv?.offsetTop ?? 0) + 70
    const visibleBottom =
      (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight) - 70
    const target =
      spot === 'top'
        ? visibleTop + 40
        : spot === 'bottom'
          ? visibleBottom - 30
          : (visibleTop + visibleBottom) / 2
    const r = el.getBoundingClientRect()
    let scroller: HTMLElement | null = el.parentElement
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(scroller).overflowY)
      )
    )
      scroller = scroller.parentElement
    const by = r.top - target
    if (scroller) scroller.scrollTop += by
    else window.scrollBy(0, by)
  }, where)
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: 'Insert block' })
  await expect(menu).toBeVisible()
  return menu
}

for (const where of ['top', 'middle', 'bottom'] as const) {
  test(`slash menu fits above the keyboard with the caret at the ${where}`, async ({
    page,
  }) => {
    await openDraftNotebook(page)
    await setKeyboard(page, KEYBOARD_PX)
    const menu = await typeSlashAt(page, where)
    await expectFullyVisible(page, menu, `slash menu (caret at ${where})`)
    // The caret line stays in view: the menu does not cover what is typed.
    const caret = await page.evaluate(() => {
      const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
      return r ? { top: r.top, bottom: r.bottom } : null
    })
    const box = await menu.boundingBox()
    expect(caret).not.toBeNull()
    expect(box).not.toBeNull()
    if (caret && box) {
      const overlaps = box.y < caret.bottom && box.y + box.height > caret.top
      expect(overlaps, 'slash menu covers the line being typed').toBe(false)
    }
  })
}

test('slash menu moves when the keyboard opens after it', async ({ page }) => {
  await openDraftNotebook(page)
  // Opened below a caret in the middle of the screen; the keyboard then
  // covers where it was.
  const menu = await typeSlashAt(page, 'middle')
  await setKeyboard(page, KEYBOARD_PX)
  await expectFullyVisible(page, menu, 'slash menu after the keyboard opened')
})

test('slash menu stays on screen when the keyboard covers the caret', async ({
  page,
}) => {
  await openDraftNotebook(page)
  const menu = await typeSlashAt(page, 'bottom')
  await setKeyboard(page, KEYBOARD_PX)
  await expectFullyVisible(page, menu, 'slash menu with the caret covered')
})

test('slash menu follows iOS panning the page above the keyboard', async ({
  page,
}) => {
  await openDraftNotebook(page)
  await setKeyboard(page, KEYBOARD_PX)
  const menu = await typeSlashAt(page, 'middle')
  await setKeyboard(page, KEYBOARD_PX, 120)
  await expectFullyVisible(page, menu, 'slash menu with the page panned')
})
