/**
 * NOTE-01 browser acceptance. Exercises the real Notebook route, PostgREST
 * block RPCs, focus movement, structure concurrency, autosave, and conflict
 * resolution in Chromium rather than reproducing those contracts in a mock.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

import { FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID } from '#/db/seed/identities'

config({ path: ['.env.local', '.env'] })

const PROJECT = '67000000-0000-4000-8000-000000000011'
const AUTHOR_RECORD = '67000000-0000-4000-8000-000000000012'
const CONFLICT_RECORD = '67000000-0000-4000-8000-000000000013'
const CONFLICT_BLOCK = '67000000-0000-4000-8000-000000000014'

let admin: Client

function richText(text: string) {
  return {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: text ? [{ type: 'text', text }] : undefined,
        },
      ],
    },
  }
}

async function savedBlockText(blockId: string): Promise<string> {
  const saved = await admin.query<{ payload: unknown }>(
    `SELECT payload FROM api.blocks WHERE id=$1`,
    [blockId],
  )
  return JSON.stringify(saved.rows[0]?.payload ?? {})
}

async function clean() {
  await admin.query('RESET ROLE')
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN ($1,$2) OR target_record_id IN ($1,$2)`,
    [AUTHOR_RECORD, CONFLICT_RECORD],
  )
  await admin.query(`DELETE FROM api.blocks WHERE record_id IN ($1,$2)`, [
    AUTHOR_RECORD,
    CONFLICT_RECORD,
  ])
  await admin.query(`DELETE FROM api.revisions WHERE record_id IN ($1,$2)`, [
    AUTHOR_RECORD,
    CONFLICT_RECORD,
  ])
  await admin.query(`DELETE FROM api.records WHERE id IN ($1,$2)`, [
    AUTHOR_RECORD,
    CONFLICT_RECORD,
  ])
  await admin.query(
    `DELETE FROM api.change_events WHERE project_id=$1 OR record_id IN ($2,$3)`,
    [PROJECT, AUTHOR_RECORD, CONFLICT_RECORD],
  )
  await admin.query(`DELETE FROM api.projects WHERE id=$1`, [PROJECT])
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()

  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'NOTE01','Notebook Authoring')`,
    [PROJECT, FIXTURE_WORKSPACE_ID],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES ($1,$2,$3,'experiment','EXP-2026-0101','Fluid authoring study','in_progress',$4),($5,$2,$3,'experiment','EXP-2026-0102','Concurrent observations','in_progress',$4)`,
    [
      AUTHOR_RECORD,
      FIXTURE_WORKSPACE_ID,
      PROJECT,
      FIXTURE_USER_ID,
      CONFLICT_RECORD,
    ],
  )
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'rich_text',$3,1,$4)`,
    [
      CONFLICT_BLOCK,
      CONFLICT_RECORD,
      richText('Initial conclusion'),
      FIXTURE_USER_ID,
    ],
  )
})

test.afterAll(async () => {
  await clean()
  await admin.end()
})

test.describe('NOTE-01 Notebook authoring', () => {
  test('builds, navigates, reorders, and deletes blocks from the keyboard without losing focus', async ({
    page,
  }) => {
    await page.goto(`/records/${AUTHOR_RECORD}`)

    await expect(
      page.getByRole('heading', { name: 'Start this Notebook' }),
    ).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Start writing' }).click()

    const blocks = page.locator('[id^="block-"]')
    await expect(blocks).toHaveCount(1)
    const firstId = await blocks.first().getAttribute('id')
    const firstBlockId = firstId!.replace('block-', '')
    const firstEditor = blocks.first().getByRole('textbox', {
      name: 'Text content',
    })
    await expect(firstEditor).toBeFocused()
    await firstEditor.pressSequentially(
      'Objective: compare vector recovery after refrigerated hold.',
    )
    await expect
      .poll(() => savedBlockText(firstBlockId), { timeout: 5_000 })
      .toContain('Objective: compare vector recovery after refrigerated hold.')

    await firstEditor.press('Alt+Enter')
    await expect(blocks).toHaveCount(2)
    const secondId = await blocks.nth(1).getAttribute('id')
    const secondBlockId = secondId!.replace('block-', '')
    const secondEditor = blocks.nth(1).getByRole('textbox', {
      name: 'Text content',
    })
    await expect(secondEditor).toBeFocused()
    await secondEditor.pressSequentially(
      'Method: quantify vector genomes by qPCR at day 0 and day 28.',
    )
    await expect
      .poll(() => savedBlockText(secondBlockId), { timeout: 5_000 })
      .toContain('Method: quantify vector genomes by qPCR at day 0 and day 28.')

    // Navigation is independent of structure. Move focus to the first block,
    // then reorder it through the same outer block keyboard contract.
    await secondEditor.press('Control+ArrowUp')
    await expect(
      blocks.first().getByRole('textbox', { name: 'Text content' }),
    ).toBeFocused()
    await page.keyboard.press('Alt+ArrowDown')
    await expect(blocks.nth(0)).toHaveAttribute('id', secondId!)
    await expect(blocks.nth(1)).toHaveAttribute('id', firstId!)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    await expect(
      blocks.nth(1).getByRole('textbox', { name: 'Text content' }),
    ).toBeFocused()

    // Enter at the end creates a focused empty text block. Backspace removes
    // it and restores focus to the preceding scientific content.
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(blocks).toHaveCount(3)
    await expect(
      blocks.nth(2).getByRole('textbox', { name: 'Text content' }),
    ).toBeFocused()
    await page.keyboard.press('Backspace')
    await expect(blocks).toHaveCount(2)
    await expect(blocks.nth(1)).toHaveAttribute('id', firstId!)
    await expect(
      blocks.nth(1).getByRole('textbox', { name: 'Text content' }),
    ).toBeFocused()
  })

  test('preserves both local and server content when autosave conflicts', async ({
    page,
  }) => {
    await page.goto(`/records/${CONFLICT_RECORD}`)
    const block = page.locator(`#block-${CONFLICT_BLOCK}`)
    await expect(block.getByText('Initial conclusion')).toBeVisible({
      timeout: 15_000,
    })
    await block.click()
    const editor = block.getByRole('textbox', { name: 'Text content' })
    await expect(editor).toBeFocused()

    let injectedConflict = false
    await page.route('**/api/db/rpc/update_block_payload', async (route) => {
      if (!injectedConflict) {
        injectedConflict = true
        await admin.query(
          `UPDATE api.blocks SET payload=$2, version=version+1 WHERE id=$1`,
          [CONFLICT_BLOCK, richText('Server conclusion from another client')],
        )
      }
      await route.continue()
    })

    await editor.press('Control+A')
    await editor.pressSequentially('Local conclusion with assay context')

    const conflict = block.locator('[data-conflict-banner]')
    await expect(conflict).toBeVisible({ timeout: 5_000 })
    await expect(editor).toHaveText('Local conclusion with assay context')
    await expect(
      conflict.locator('[data-conflict-server-preview]'),
    ).toContainText('Server conclusion from another client')

    await conflict.getByRole('button', { name: 'Keep my edit' }).click()
    await expect(conflict).toBeHidden()
    await expect
      .poll(() => savedBlockText(CONFLICT_BLOCK), { timeout: 5_000 })
      .toContain('Local conclusion with assay context')
  })
})
