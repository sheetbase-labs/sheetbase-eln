/**
 * The notebook's insert-block menu on a phone with the keyboard open. It must
 * open inside the strip of screen between the status bar and the keyboard,
 * wherever the caret is, and follow the screen when the keyboard opens late
 * or iOS pans the page.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import {
  createExperiment,
  createProject,
  signIn,
  uniqueName,
  waitForHydration,
} from '../journeys/helpers'
import {
  KEYBOARD_PX,
  PHONE,
  emulateInstalledApp,
  emulatePhone,
  expectFullyVisible,
  setKeyboard,
} from './phone'

test.use({ ...PHONE })
test.setTimeout(120_000)

let projectPath = ''
const LINES = 30

/**
 * A fresh draft notebook with enough lines to scroll, so the seeded notebooks
 * are never edited. The caret is left on an empty line.
 */
async function openDraftNotebook(page: Page) {
  await emulatePhone(page)
  await signIn(page)
  if (!projectPath) projectPath = await createProject(page, uniqueName('Phone'))
  await createExperiment(page, projectPath, uniqueName('Phone notebook'))
  await waitForHydration(page)
  await emulateInstalledApp(page)
  // A new draft opens on one empty text block.
  const editor = page.getByRole('textbox', { name: 'Text content' }).first()
  const blocks = page.getByRole('group', { name: /^Text block/ })
  await editor.click()
  await expect(editor).toBeFocused()
  // Enter at the end of a block starts a new one, so this writes a stack of
  // one-line blocks, typed at a person's pace.
  for (let line = 1; line <= LINES; line += 1) {
    await page.keyboard.type(`Observation ${line}`, { delay: 10 })
    if (line < LINES) {
      await page.keyboard.press('Enter')
      await expect(
        blocks.nth(line).getByRole('textbox', { name: 'Text content' }),
      ).toBeFocused()
    }
  }
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
