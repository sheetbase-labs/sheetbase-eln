/**
 * COLLAB-01 browser acceptance. Two browsers open the same notebook block and
 * type at the same time through the bundled co-editing server: each sees the
 * other's text as it is typed, both converge on the same text, and the merged
 * text is what ends up saved in PostgreSQL, which stays the only authority.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'

import { FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID } from '#/db/seed/identities'
import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

// The first visit to a page makes the dev server compile it, which on a cold
// CI runner can take most of the default 30 seconds before anything is typed.
// The compile is warmed in beforeAll (below) and the test gets the same room
// the other journey specs have, so a slow runner cannot end it half way.
test.setTimeout(90_000)

const PROJECT = '68000000-0000-4000-8000-000000000011'
const RECORD = '68000000-0000-4000-8000-000000000012'
const BLOCK = '68000000-0000-4000-8000-000000000014'

let admin: Client

function richText(text: string) {
  return {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  }
}

async function savedText(): Promise<string> {
  const saved = await admin.query<{ payload: unknown }>(
    `SELECT payload FROM api.blocks WHERE id=$1`,
    [BLOCK],
  )
  return JSON.stringify(saved.rows[0]?.payload ?? {})
}

/** The block, back to its saved starting text. */
async function seedBlock() {
  await admin.query(`DELETE FROM api.blocks WHERE record_id=$1`, [RECORD])
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'rich_text',$3,1,$4)`,
    [BLOCK, RECORD, richText('Buffer: 50 mM Tris.'), FIXTURE_USER_ID],
  )
}

async function clean() {
  await admin.query('RESET ROLE')
  await admin.query(`DELETE FROM api.blocks WHERE record_id=$1`, [RECORD])
  await admin.query(`DELETE FROM api.revisions WHERE record_id=$1`, [RECORD])
  await admin.query(`DELETE FROM api.records WHERE id=$1`, [RECORD])
  await admin.query(`DELETE FROM api.projects WHERE id=$1`, [PROJECT])
}

// The fixture user's active workspace is shared state (see NOTE-01): own it
// for the run and put it back afterwards.
let previousActiveWorkspace: string | null = null

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  const prior = await admin.query<{ active_workspace_id: string | null }>(
    `SELECT active_workspace_id FROM api.user_preferences WHERE user_id=$1`,
    [FIXTURE_USER_ID],
  )
  previousActiveWorkspace = prior.rows[0]?.active_workspace_id ?? null
  await admin.query(
    `INSERT INTO api.user_preferences(user_id, active_workspace_id) VALUES($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = excluded.active_workspace_id`,
    [FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'COLL01','Co-editing',$3)`,
    [PROJECT, FIXTURE_WORKSPACE_ID, FIXTURE_USER_ID],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES ($1,$2,$3,'experiment','EXP-2026-0201','Shared buffer prep','in_progress',$4)`,
    [RECORD, FIXTURE_WORKSPACE_ID, PROJECT, FIXTURE_USER_ID],
  )
})

// Compile the sign-in and record routes once, outside the timed test.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  await seedBlock()
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInAsDesignUser(page, FIXTURE_USER_ID)
  await page.goto(`/records/${RECORD}`)
  await page
    .locator(`#block-${BLOCK}`)
    .getByText('Buffer: 50 mM Tris.')
    .waitFor({ timeout: 90_000 })
  await context.close()
})

// Every test starts from the same saved text, so one test's edits never leak
// into the next.
test.beforeEach(seedBlock)

test.afterAll(async () => {
  await clean()
  if (previousActiveWorkspace) {
    await admin.query(
      `UPDATE api.user_preferences SET active_workspace_id=$2 WHERE user_id=$1`,
      [FIXTURE_USER_ID, previousActiveWorkspace],
    )
  } else {
    await admin.query(`DELETE FROM api.user_preferences WHERE user_id=$1`, [
      FIXTURE_USER_ID,
    ])
  }
  await admin.end()
})

/** The block's text, without the other person's caret label inside it. */
function plainText(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.collaboration-carets__caret').forEach((node) => {
      node.remove()
    })
    return (copy.textContent ?? '').replace(/\u00a0/g, ' ')
  })
}

async function openBlock(
  page: Page,
  which: { id: string; text: string } = {
    id: BLOCK,
    text: 'Buffer: 50 mM Tris.',
  },
) {
  await signInAsDesignUser(page, FIXTURE_USER_ID)
  await page.goto(`/records/${RECORD}`)
  const block = page.locator(`#block-${which.id}`)
  await block.getByText(which.text).click()
  const editor = block.getByRole('textbox', { name: 'Text content' })
  await expect(editor).toBeFocused({ timeout: 15_000 })
  return { block, editor }
}

test.describe('COLLAB-01 live co-editing', () => {
  test('two browsers type in one block, see each other live, and save the merged text', async ({
    browser,
  }) => {
    const first = await (await browser.newContext()).newPage()
    const second = await (await browser.newContext()).newPage()
    const a = await openBlock(first)
    const b = await openBlock(second)

    // Both have joined the shared text before either types: each shows the
    // other's presence on the block.
    await expect(a.block.getByRole('status')).toContainText('Editing here', {
      timeout: 15_000,
    })
    await expect(b.block.getByRole('status')).toContainText('Editing here')

    await a.editor.press('Control+End')
    await a.editor.pressSequentially(' Adjust to pH 7.4.')
    await expect(b.editor).toContainText('Adjust to pH 7.4.')

    await b.editor.press('Control+End')
    await b.editor.pressSequentially(' Filter 0.22 um.')
    await expect(a.editor).toContainText('Filter 0.22 um.')

    // They converge on the same text, with nothing lost and nothing doubled.
    const expected = 'Buffer: 50 mM Tris. Adjust to pH 7.4. Filter 0.22 um.'
    // (The other person's caret label sits inside the text, so read the text
    // without it.)
    for (const { editor } of [a, b]) {
      await expect.poll(() => plainText(editor)).toBe(expected)
    }

    // The database holds the merged text, and neither browser is left asking
    // the person to resolve a conflict between halves of the same text.
    await expect.poll(savedText, { timeout: 15_000 }).toContain(expected)
    await expect(first.locator('[data-conflict-banner]')).toHaveCount(0)
    await expect(second.locator('[data-conflict-banner]')).toHaveCount(0)
  })

  test('a block opened while others are in the room still takes the focus', async ({
    browser,
  }) => {
    const first = await (await browser.newContext()).newPage()
    const second = await (await browser.newContext()).newPage()
    const a = await openBlock(first)
    const b = await openBlock(second)
    await expect(a.block.getByRole('status')).toContainText('Editing here', {
      timeout: 15_000,
    })
    await expect(b.block.getByRole('status')).toContainText('Editing here')

    // A second block that nobody has opened yet. The person opening it finds
    // the room already busy, so its editor is swapped for the shared one a
    // moment after the click. They must still be left in it, ready to type,
    // rather than looking at an editor that has lost the focus.
    const other = '68000000-0000-4000-8000-000000000015'
    await admin.query(
      `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'rich_text',$3,2,$4)`,
      [other, RECORD, richText('Second note.'), FIXTURE_USER_ID],
    )
    const third = await (await browser.newContext()).newPage()
    const c = await openBlock(third, { id: other, text: 'Second note.' })
    await c.editor.press('Control+End')
    await c.editor.pressSequentially(' Typed at once.')
    await expect
      .poll(() => plainText(c.editor))
      .toBe('Second note. Typed at once.')
  })

  test('a change saved outside the room is still offered as a conflict, never overwritten', async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage()
    const { editor } = await openBlock(page)

    // Something other than a collaborator (an import, the API, an assistant
    // action) changes the block behind the editor's back.
    await admin.query(
      `UPDATE api.blocks SET payload=$2, version=version+1 WHERE id=$1`,
      [BLOCK, richText('Rewritten by an import.')],
    )
    await editor.press('Control+End')
    await editor.pressSequentially(' My edit.')

    await expect(page.locator('[data-conflict-banner]')).toBeVisible({
      timeout: 15_000,
    })
    expect(await savedText()).toContain('Rewritten by an import.')
    expect(await savedText()).not.toContain('My edit.')
  })
})
