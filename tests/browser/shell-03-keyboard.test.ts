/** Original SHELL-03 bindings against the migrated, seeded app; no route mocks. */
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import { z } from 'zod'

import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })
const user = '00000000-0000-4000-8000-000000000310'
const workspace = '00000000-0000-4000-8000-000000000300'
const notebook = randomUUID()
const reviewRecord = randomUUID()
let sheet: { id: string; projectId: string }
let revision: string
let admin: Client

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test.beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Local disposable database required')
  admin = new Client({ connectionString: url })
  await admin.connect()
  const { rows } = await admin.query<{ id: string; project_id: string | null }>(
    `select id, project_id from api.sheet_instances
     where workspace_id=$1 and name=$2 and lifecycle='active'`,
    [workspace, 'Clarification working sheet'],
  )
  if (rows.length !== 1 || !rows[0].project_id)
    throw new Error(
      'Expected one active Clarification working sheet with an owning project in the design workspace. Run the design seed.',
    )
  sheet = { id: rows[0].id, projectId: rows[0].project_id }
  for (const id of [notebook, reviewRecord])
    await admin.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
       values($1,$2,$3,'experiment',$4,'SHELL-03 keyboard fixture','draft',$5)`,
      [id, workspace, sheet.projectId, `EXP-SHELL03-${id}`, user],
    )
  const actor = new Client({ connectionString: process.env.PGRST_DB_URI })
  await actor.connect()
  try {
    await actor.query('set role authenticated')
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        role: 'authenticated',
        workspace_id: workspace,
        sub: user,
        session_id: `parity-${user}`,
      }),
    ])
    await actor.query(
      'select api.insert_sheet_instance_block($1,null,null,$2)',
      [notebook, sheet.id],
    )
    const submissionSchema = z.object({
      revision: z.object({ id: z.uuid(), integrityDigest: z.string() }),
      submission: z.object({ id: z.uuid() }),
    })
    const submit = async () => {
      const preview = await actor.query(
        "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
        [reviewRecord],
      )
      const result = await actor.query(
        "select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result",
        [
          reviewRecord,
          preview.rows[0].digest,
          ['00000000-0000-4000-8000-000000000311'],
          randomUUID(),
        ],
      )
      return submissionSchema.parse(result.rows[0].result)
    }
    const first = await submit()
    await actor.query(
      "select api.withdraw_review($1,'Keyboard comparison fixture','submitted',$2)",
      [first.submission.id, first.revision.integrityDigest],
    )
    for (const text of [
      'First independent change',
      'Second independent change',
    ])
      await actor.query("select api.insert_block($1,'rich_text',$2::jsonb)", [
        reviewRecord,
        JSON.stringify({
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          },
        }),
      ])
    revision = (await submit()).revision.id
  } finally {
    await actor.end()
  }
})

test.afterAll(async () => {
  if (admin) {
    await admin.query('delete from api.comments where record_id=$1', [
      reviewRecord,
    ])
    await admin.query(
      'delete from api.review_decisions where submission_id in (select id from api.review_submissions where record_id=$1)',
      [reviewRecord],
    )
    await admin.query('delete from api.review_submissions where record_id=$1', [
      reviewRecord,
    ])
    await admin.query('delete from api.revisions where record_id=$1', [
      reviewRecord,
    ])
    await admin.query('delete from api.records where id=$1', [reviewRecord])
    await admin.query('delete from api.records where id=$1', [notebook])
    await admin.end()
  }
})

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, user)
})

test('global bindings, Windows modifiers, input suppression and overlay focus', async ({
  page,
}) => {
  const preferences = page.waitForResponse(
    (response) =>
      response.url().includes('/api/db/user_preferences') && response.ok(),
  )
  await page.goto('/help/shortcuts?os=windows')
  await preferences
  await expect(page).toHaveURL(/os=windows/)
  const trigger = page.getByRole('button', {
    name: 'Show keyboard shortcuts',
    exact: true,
  })
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  // A real click waits for hydration rather than firing at inert SSR chrome.
  await trigger.click()
  await expect(shortcuts).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(shortcuts).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('?')
  await expect(shortcuts).toBeVisible()
  for (const label of ['Select', 'Save the row', 'Approve and sign…'])
    await expect(shortcuts.getByText(label, { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(shortcuts).not.toBeVisible()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog')
  await expect(palette).toBeVisible()
  const input = palette.getByRole('combobox', { name: 'Search', exact: true })
  await expect(input).toBeFocused()
  await page.keyboard.type('c?gh')
  await expect(input).toHaveValue('c?gh')
  await expect(page).toHaveURL(/\/help\/shortcuts/)
  await expect(shortcuts).not.toBeVisible()
  await page.keyboard.press('Tab')
  expect(
    await palette.evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(palette).not.toBeVisible()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('c')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Experiment/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()

  const nav = page.locator('nav[aria-label="Main"]:visible')
  const before = await nav.boundingBox()
  await page.keyboard.press('Control+Backslash')
  await expect
    .poll(async () => (await nav.boundingBox())?.width)
    .not.toBe(before?.width)
  await page.keyboard.press('Control+Backslash')
  await expect
    .poll(async () => (await nav.boundingBox())?.width)
    .toBe(before?.width)
  for (const [key, route] of [
    ['h', '/'],
    ['i', '/inbox'],
    ['e', '/experiments'],
  ]) {
    await page.keyboard.press('g')
    await page.keyboard.press(key)
    await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`))
    await expect(page.locator('#main')).toBeVisible()
  }
})

test('Inbox arrows, J/K, Space/X selection, filter and Enter open actual items', async ({
  page,
}) => {
  await page.goto('/inbox')
  const rows = page
    .getByRole('list', { name: 'Inbox items' })
    .getByRole('listitem')
  await expect.poll(() => rows.count()).toBeGreaterThan(1)
  const first = rows.nth(0)
  const second = rows.nth(1)
  await page.getByRole('heading', { name: 'Inbox', exact: true }).click()
  await page.keyboard.press('Space')
  await expect(first.getByRole('button')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('ArrowDown')
  await expect(second).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('x')
  await expect(second.getByRole('button')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(first.getByRole('button')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page
    .getByRole('list', { name: 'Inbox items' })
    .screenshot({ path: '.amp/in/artifacts/shell03-inbox-selection.png' })
  await page.keyboard.press('ArrowUp')
  await expect(first).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('j')
  await expect(second).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('k')
  await expect(first).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Space')
  await expect(second.getByRole('button')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.keyboard.press('/')
  await expect(
    page.getByRole('button', { name: 'All types', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).not.toHaveURL(/\/inbox(?:\?|$)/)
})

test('actual sheet Enter edits, Escape cancels, Tab advances and Ctrl+Enter persists', async ({
  page,
}) => {
  await page.goto(`/sheets/${sheet.id}?projectId=${sheet.projectId}`)
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  await grid.focus()
  await page.keyboard.press('Control+Home')
  const first = page.locator(
    '[role="gridcell"][aria-rowindex="1"][aria-colindex="1"]',
  )
  const next = page.locator(
    '[role="gridcell"][aria-rowindex="1"][aria-colindex="2"]',
  )
  const original = (await first.textContent()) ?? ''
  await page.keyboard.press('Enter')
  const editor = page.locator('input.cell-editor')
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue(original)
  await editor.fill('shell03-cancelled')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(first).toHaveText(original)
  await expect(grid).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(next).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Enter')
  await editor.fill('shell03-persisted')
  const saved = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes('/api/db/rpc/mutate_sheet_instance_local_state') &&
      response.request().method() === 'POST',
  )
  await page.keyboard.press('Control+Enter')
  expect((await saved).status()).toBe(200)
  await expect(editor).toHaveCount(0)
  await expect(first).toHaveText('shell03-persisted')
  await page.reload()
  await expect(first).toHaveText('shell03-persisted')
  await grid.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Enter')
  await editor.fill(original)
  const restored = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes('/api/db/rpc/mutate_sheet_instance_local_state') &&
      response.request().method() === 'POST',
  )
  await page.keyboard.press('Control+Enter')
  expect((await restored).status()).toBe(200)
  await expect(first).toHaveText(original)
})

test('Notebook slash inserts a real block and Ctrl+Alt+M opens selected cell comments', async ({
  page,
}) => {
  await page.goto(`/records/${notebook}/notebook`)
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  await grid.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+Alt+m')
  await expect(
    page.getByRole('region', { name: 'Sheet comments' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'New comment body' }),
  ).toBeVisible()
  await page
    .getByRole('complementary', { name: 'Sheet comments inspector' })
    .screenshot({
      path: '.amp/in/artifacts/shell03-sheet-comment-inspector.png',
    })
  // Ordinary typing must not invoke global C or Notebook slash bindings.
  const comment = page.getByRole('textbox', { name: 'New comment body' })
  await comment.focus()
  await page.keyboard.type('c/?')
  await expect(comment).toHaveValue('c/?')
  await expect(page.getByRole('menu')).toHaveCount(0)
  const blocks = page.locator('[id^="block-"]')
  const count = await blocks.count()
  await comment.fill('')
  await page
    .getByRole('button', { name: 'Close comments', exact: true })
    .click()
  const inserted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/db/rpc/insert_') && response.ok(),
  )
  await page.keyboard.press('/')
  await inserted
  await expect(blocks).toHaveCount(count + 1)
})

test('Review N/P navigate real changes and R focuses an actual comment reply', async ({
  page,
}) => {
  await page.goto(`/review/${revision}`)
  const changes = page.locator('[data-revision-change-id]')
  await expect.poll(() => changes.count()).toBeGreaterThan(1)
  const active = page.locator('[data-revision-change-id][aria-current="step"]')
  const first = await active.getAttribute('data-revision-change-id')
  await page.keyboard.press('n')
  await expect(active).not.toHaveAttribute(
    'data-revision-change-id',
    first ?? '',
  )
  await page.keyboard.press('p')
  await expect(active).toHaveAttribute('data-revision-change-id', first ?? '')
  await page.getByRole('tab', { name: 'Comments', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'New comment body' })
    .fill('SHELL-03 reply fixture')
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  await expect(
    page.getByText('SHELL-03 reply fixture', { exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Comments', exact: true }).focus()
  await page.keyboard.press('r')
  await expect(
    page.getByRole('textbox', { name: 'Reply body' }).first(),
  ).toBeFocused()
  await page.keyboard.type('npr')
  await expect(
    page.getByRole('textbox', { name: 'Reply body' }).first(),
  ).toHaveValue('npr')
})

test('Mac platform uses Meta for the palette and real selected-cell comments', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }),
  )
  await page.goto(`/records/${notebook}/notebook`)
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  await grid.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Meta+Alt+m')
  await expect(
    page.getByRole('region', { name: 'Sheet comments' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Close comments', exact: true })
    .click()
  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog')
  await expect(
    palette.getByRole('combobox', { name: 'Search', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(palette).not.toBeVisible()
})
