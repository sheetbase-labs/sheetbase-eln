/** SHEET-03 exercises canonical PostgreSQL comments through the real app. */
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import { z } from 'zod'

import { createAdHocTextField } from '../../src/lib/sheet-local-data'
import { parseSheetInstanceState } from '../../src/lib/sheet-instance'
import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })
const user = '00000000-0000-4000-8000-000000000310'
const workspace = '00000000-0000-4000-8000-000000000300'
const project = '00000000-0000-4000-8000-000000000320'
const field = randomUUID()
const group = randomUUID()
const rows = [randomUUID(), randomUUID(), randomUUID()]
let admin: Client
let actor: Client
let originalAppearance: string
const fixtures: Array<{ instance: string; record: string }> = []

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })

function state() {
  return parseSheetInstanceState({
    bindings: [],
    localFields: [
      { ...createAdHocTextField('Recovery'), fieldId: field },
      { ...createAdHocTextField('Group'), fieldId: group },
    ],
    localValues: {
      [rows[0]]: { [field]: '37', [group]: 'keep' },
      [rows[1]]: { [field]: '4', [group]: 'hide' },
      [rows[2]]: { [field]: '91', [group]: 'keep' },
    },
    calculationOverrides: {},
    presentation: {
      columnOrder: [field, group],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [{ columnId: field, direction: 'asc' }],
    },
    provenance: { createdFrom: 'ad_hoc' },
  })
}

/**
 * The PostgREST authenticator's own connection string, pointed at the database
 * DATABASE_URL already names. `.env.local` gives PGRST_DB_URI the Compose-only
 * host `postgres` (docs/development/testing.md), which the machine running the
 * tests cannot resolve; the seeds combine the two the same way.
 */
function actorConnectionString(): string {
  const pgrst = new URL(process.env.PGRST_DB_URI ?? '')
  if (!pgrst.username) {
    throw new Error('PGRST_DB_URI is required for the comment actor')
  }
  const local = new URL(process.env.DATABASE_URL ?? '')
  local.username = pgrst.username
  local.password = pgrst.password
  return local.toString()
}

test.beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Local disposable database required')
  admin = new Client({ connectionString: url })
  await admin.connect()
  await admin.query(
    `insert into internal.session(id,token,"userId","expiresAt") values($1,$1,$2,now()+interval '12 hours') on conflict(id) do update set "expiresAt"=excluded."expiresAt"`,
    [`parity-${user}`, user],
  )
  actor = new Client({ connectionString: actorConnectionString() })
  await actor.connect()
  await actor.query('set role authenticated')
  await actor.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      role: 'authenticated',
      workspace_id: workspace,
      sub: user,
      session_id: `parity-${user}`,
    }),
  ])
  originalAppearance = z
    .enum(['light', 'dark', 'system'])
    .parse(
      (
        await actor.query(
          "select coalesce((select appearance from api.user_preferences),'system') appearance",
        )
      ).rows[0].appearance,
    )
})

test.afterAll(async () => {
  if (!admin) return
  for (const fixture of fixtures) {
    // Retain immutable historical evidence. Retire only these disposable fixtures
    // using the same actor and authority as the app, never a trigger bypass.
    const submissions = (
      await actor.query(
        'select s.id,s.state,r.integrity_digest from api.review_submissions s join api.revisions r on r.id=s.revision_id where s.record_id=$1',
        [fixture.record],
      )
    ).rows
    for (const submission of submissions) {
      if (submission.state === 'submitted')
        await actor.query(
          "select api.withdraw_review($1,'SHEET-03 browser fixture finished','submitted',$2)",
          [submission.id, submission.integrity_digest],
        )
    }
    const live = (
      await actor.query(
        'select revision,lifecycle from api.sheet_instances where id=$1',
        [fixture.instance],
      )
    ).rows[0]
    if (live.lifecycle === 'active')
      await actor.query('select api.archive_sheet_instance($1,$2)', [
        fixture.instance,
        live.revision,
      ])
    await actor.query('update api.records set archived_at=now() where id=$1', [
      fixture.record,
    ])
  }
  if (actor) {
    await actor.query('select api.set_user_appearance($1)', [
      originalAppearance,
    ])
    await actor.end()
  }
  await admin.end()
})

async function fixture(page: Page) {
  await signInAsDesignUser(page, user)
  const record = randomUUID()
  // Disposable ordinary unlocked Record; all Sheet/comment/revision writes use RPCs.
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment',$4,'SHEET-03 comment proof','draft',$5)`,
    [record, workspace, project, `EXP-SHEET03-${record}`, user],
  )
  const result = await actor.query(
    "select to_jsonb(api.create_sheet_instance($1,'SHEET-03 stable comment proof',null,null,$2,null,$3::jsonb)) result",
    [workspace, project, JSON.stringify(state())],
  )
  const instance = z.object({ id: z.uuid() }).parse(result.rows[0].result).id
  fixtures.push({ instance, record })
  await actor.query('select api.insert_sheet_instance_block($1,null,null,$2)', [
    record,
    instance,
  ])
  return { instance, record }
}

async function addComment(page: Page, body: string, frozen = false) {
  await page.getByRole('textbox', { name: 'New comment body' }).fill(body)
  const request = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(
          `/api/db/rpc/${frozen ? 'create_comment' : 'create_sheet_comment'}`,
        ) && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  const response = await request
  expect(response.status(), await response.text()).toBe(200)
  await expect(page.getByText(body, { exact: true })).toBeVisible()
}

for (const theme of ['light', 'dark']) {
  test(`persisted live cell/row/range threads retain identities and appear in Record comments (${theme})`, async ({
    page,
  }) => {
    const { instance, record } = await fixture(page)
    await actor.query('select api.set_user_appearance($1)', [theme])
    await page.addInitScript(
      (value) => (document.cookie = `sb-theme=${value}; path=/`),
      theme,
    )
    await page.goto(`/sheets/${instance}?projectId=${project}`)
    await page.getByRole('gridcell', { name: '4', exact: true }).click()
    if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
    else await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.getByRole('button', { name: 'Comment on selection' }).click()
    const cellBody = `SHEET-03 ${theme} recovery-four discussion`
    await addComment(page, cellBody)
    const root = (
      await admin.query(
        'select id,target,revision_id,record_id from api.comments where sheet_instance_id=$1 and body=$2',
        [instance, cellBody],
      )
    ).rows[0]
    expect(root).toMatchObject({
      target: { instanceId: instance, rowKeys: [rows[1]], fieldIds: [field] },
      revision_id: null,
      record_id: null,
    })
    await expect(
      page.getByRole('gridcell', { name: '4', exact: true }),
    ).toHaveClass(/annotated/)
    await page.getByRole('button', { name: 'Reply to thread' }).click()
    await page
      .getByRole('textbox', { name: 'Reply body' })
      .fill('Independent replication required')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(
      page.getByText('Independent replication required', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Resolve thread' }).click()
    await expect(
      page.getByRole('button', { name: 'Reopen thread' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Reopen thread' }).click()
    await expect(
      page.getByRole('button', { name: 'Resolve thread' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Row', exact: true }).click()
    await addComment(page, `SHEET-03 ${theme} row discussion`)
    await page.getByRole('button', { name: 'Close comments' }).click()
    await expect(
      page.locator('[role="gridcell"][aria-colindex="1"]'),
    ).toHaveText(['4', '37', '91'])
    await page.getByRole('gridcell', { name: '37', exact: true }).click()
    await page
      .getByRole('gridcell', { name: '91', exact: true })
      .click({ modifiers: ['Shift'] })
    await page.getByRole('button', { name: 'Comment on selection' }).click()
    const rangeBody = `SHEET-03 ${theme} asymmetric range discussion`
    await addComment(page, rangeBody)
    expect(
      (
        await admin.query(
          'select target_kind,target from api.comments where body=$1 and sheet_instance_id=$2',
          [rangeBody, instance],
        )
      ).rows[0],
    ).toMatchObject({
      target_kind: 'sheet_range',
      target: {
        instanceId: instance,
        rowKeys: [rows[0], rows[2]],
        fieldIds: [field],
      },
    })
    // Genuine grid sorting persists presentation, not durable comment coordinates.
    await page.getByRole('button', { name: 'Close comments' }).click()
    await page
      .getByRole('button', { name: `Sort ${field}`, exact: true })
      .click()
    await expect(
      page.getByRole('gridcell', { name: '4', exact: true }),
    ).toHaveClass(/annotated/)
    await page.reload()
    await expect(
      page.getByRole('gridcell', { name: '4', exact: true }),
    ).toHaveClass(/annotated/)
    const current = (
      await actor.query(
        'select revision,state from api.sheet_instances where id=$1',
        [instance],
      )
    ).rows[0]
    await actor.query('select api.update_sheet_instance($1,$2,$3::jsonb)', [
      instance,
      current.revision,
      JSON.stringify({
        ...current.state,
        presentation: {
          ...current.state.presentation,
          filters: [{ columnId: group, operator: 'equals', value: 'keep' }],
        },
      }),
    ])
    await page.reload()
    await expect(
      page.getByRole('gridcell', { name: '4', exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await admin.query('select target from api.comments where id=$1', [
          root.id,
        ])
      ).rows[0].target,
    ).toEqual(root.target)
    const filtered = (
      await actor.query(
        'select revision,state from api.sheet_instances where id=$1',
        [instance],
      )
    ).rows[0]
    await actor.query('select api.update_sheet_instance($1,$2,$3::jsonb)', [
      instance,
      filtered.revision,
      JSON.stringify({
        ...filtered.state,
        presentation: { ...filtered.state.presentation, filters: [] },
      }),
    ])
    // Comments and grid data load independently. Force persisted threads to
    // arrive after the engine mounts, rather than relying on a lucky response
    // order that puts every annotation into initialAnnotations.
    const commentsPattern = '**/api/db/comments?**'
    await page.route(commentsPattern, async (route) => {
      await page.getByRole('gridcell', { name: '4', exact: true }).waitFor()
      await route.continue()
    })
    await page.reload()
    await expect(
      page.getByRole('gridcell', { name: '4', exact: true }),
    ).toHaveClass(/annotated/)
    await page.unroute(commentsPattern)
    await expect(page.locator('[role="gridcell"].annotated')).toHaveCount(4)
    await page.screenshot({
      path: `.amp/in/artifacts/sheet03-marker-hydration-${theme}.png`,
    })
    const inserted = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes('/api/db/rpc/mutate_sheet_instance_local_state') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Add row', exact: true }).click()
    expect((await inserted).status()).toBe(200)
    await expect
      .poll(
        async () =>
          Object.keys(
            (
              await actor.query(
                'select state from api.sheet_instances where id=$1',
                [instance],
              )
            ).rows[0].state.localValues,
          ).length,
      )
      .toBe(4)
    expect(
      (
        await admin.query('select target from api.comments where id=$1', [
          root.id,
        ])
      ).rows[0].target,
    ).toEqual(root.target)
    await page.goto(`/records/${record}/notebook`)
    await page.getByRole('tab', { name: 'Comments', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Record comments' }),
    ).toContainText(cellBody)
    await expect(
      page.getByRole('region', { name: 'Record comments' }),
    ).toContainText(rangeBody)
    await page.screenshot({
      path: `.amp/in/artifacts/sheet03-record-comments-${theme}.png`,
    })
    // Field retirement has a genuine local mutation authority. Do not simulate
    // deleted rows through update_sheet_instance, which rejects local writes.
    const beforeRetirement = (
      await actor.query(
        'select revision,state from api.sheet_instances where id=$1',
        [instance],
      )
    ).rows[0]
    await actor.query(
      'select api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',
      [
        instance,
        beforeRetirement.revision,
        randomUUID(),
        JSON.stringify([{ operation: 'retire', fieldId: field }]),
        '[]',
        '[]',
      ],
    )
    await page.goto(`/sheets/${instance}?projectId=${project}`)
    await page
      .getByRole('gridcell', { name: 'keep', exact: true })
      .first()
      .click()
    await page.getByRole('button', { name: 'Comment on selection' }).click()
    await expect(
      page.getByText(/Original target unavailable in this view/),
    ).toHaveCount(2)
    await expect(page.getByText(cellBody, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('gridcell', { name: '4', exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await admin.query('select target from api.comments where id=$1', [
          root.id,
        ])
      ).rows[0].target,
    ).toEqual(root.target)
    await page
      .getByRole('complementary', { name: 'Sheet comments inspector' })
      .screenshot({
        path: `.amp/in/artifacts/sheet03-unavailable-target-${theme}.png`,
      })
    // Direct owner-link proof only. Canonical search still needs its queued SQL.
    const reply = (
      await admin.query(
        'select id from api.comments where root_id=$1 and parent_id=$1',
        [root.id],
      )
    ).rows[0]
    await page.goto(`/sheets/${instance}?commentId=${reply.id}`)
    await expect(page.locator(`[data-comment-id="${reply.id}"]`)).toBeFocused()
    await expect(page.getByText(cellBody, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'New comment body' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Reply to thread' }).first(),
    ).toBeVisible()
    await page
      .getByRole('complementary', { name: 'Sheet comments inspector' })
      .screenshot({
        path: `.amp/in/artifacts/sheet03-comment-owner-link-${theme}.png`,
      })
    await page.getByRole('button', { name: 'Close comments' }).click()
    await expect(
      page.getByRole('complementary', { name: 'Sheet comments inspector' }),
    ).toHaveCount(0)
  })
}

test('review comments use submitted cells after live edits and never rewrite frozen values or digest', async ({
  page,
}) => {
  const { instance, record } = await fixture(page)
  const preview = await actor.query(
    "select api.preview_submission_digest($1)->>'sourceDigest' digest",
    [record],
  )
  const submitted = await actor.query(
    "select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) result",
    [
      record,
      preview.rows[0].digest,
      ['00000000-0000-4000-8000-000000000311'],
      randomUUID(),
    ],
  )
  const revision = z
    .object({
      revision: z.object({ id: z.uuid(), integrityDigest: z.string() }),
    })
    .parse(submitted.rows[0].result).revision
  const evidence = (
    await admin.query(
      'select instance_state,composed_grid from api.revision_sheet_evidence where revision_id=$1',
      [revision.id],
    )
  ).rows
  const live = (
    await actor.query(
      'select revision,state from api.sheet_instances where id=$1',
      [instance],
    )
  ).rows[0]
  await actor.query(
    'select api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',
    [
      instance,
      live.revision,
      randomUUID(),
      '[]',
      JSON.stringify([{ kind: 'local', rowKey: rows[1] }]),
      JSON.stringify([{ rowKey: rows[1], fieldId: field, value: '77' }]),
    ],
  )
  await page.goto(`/review/${revision.id}`)
  const frozenFour = page
    .getByRole('button', { name: /^Select Recovery row / })
    .filter({ hasText: /^4$/ })
  await frozenFour.click()
  await expect(frozenFour).toHaveText('4')
  await page
    .getByRole('button', { name: 'Comment on frozen selection' })
    .click()
  const body = 'SHEET-03 frozen recovery-four, not live seventy-seven'
  await addComment(page, body, true)
  expect(
    (
      await admin.query(
        'select target,revision_id from api.comments where revision_id=$1 and body=$2',
        [revision.id, body],
      )
    ).rows[0],
  ).toEqual({
    target: { instanceId: instance, rowKeys: [rows[1]], fieldIds: [field] },
    revision_id: revision.id,
  })
  await page.getByRole('tab', { name: 'Diff', exact: true }).click()
  await frozenFour.click()
  await page
    .getByRole('combobox', { name: 'Frozen comment target' })
    .selectOption('sheet_row')
  await page
    .getByRole('button', { name: 'Comment on frozen selection' })
    .click()
  const rowBody = 'SHEET-03 frozen row discussion'
  await addComment(page, rowBody, true)
  expect(
    (
      await admin.query(
        'select target_kind,target from api.comments where revision_id=$1 and body=$2',
        [revision.id, rowBody],
      )
    ).rows[0],
  ).toEqual({
    target_kind: 'sheet_row',
    target: { instanceId: instance, rowKeys: [rows[1]], fieldIds: [] },
  })
  await page.getByRole('tab', { name: 'Diff', exact: true }).click()
  await page.getByRole('button', { name: 'Select Recovery row 1' }).click()
  await page
    .getByRole('button', { name: 'Select Group row 3' })
    .click({ modifiers: ['Shift'] })
  await page
    .getByRole('combobox', { name: 'Frozen comment target' })
    .selectOption('sheet_range')
  await page.screenshot({
    path: '.amp/in/artifacts/sheet03-frozen-range-selection.png',
  })
  await page
    .getByRole('button', { name: 'Comment on frozen selection' })
    .click()
  const rangeBody = 'SHEET-03 frozen asymmetric range discussion'
  await addComment(page, rangeBody, true)
  expect(
    (
      await admin.query(
        'select target_kind,target from api.comments where revision_id=$1 and body=$2',
        [revision.id, rangeBody],
      )
    ).rows[0],
  ).toEqual({
    target_kind: 'sheet_range',
    target: {
      instanceId: instance,
      rowKeys: [...rows].sort(),
      fieldIds: [field, group].sort(),
    },
  })
  expect(
    (
      await admin.query(
        'select instance_state,composed_grid from api.revision_sheet_evidence where revision_id=$1',
        [revision.id],
      )
    ).rows,
  ).toEqual(evidence)
  expect(
    (
      await admin.query(
        'select integrity_digest from api.revisions where id=$1',
        [revision.id],
      )
    ).rows[0].integrity_digest,
  ).toBe(revision.integrityDigest)
  await page.reload()
  await expect(page.getByText(body, { exact: true })).toBeVisible()
  const frozenComment = (
    await admin.query(
      'select id from api.comments where revision_id=$1 and body=$2',
      [revision.id, body],
    )
  ).rows[0]
  await page.goto(
    `/review/${revision.id}?tab=comments&commentId=${frozenComment.id}`,
  )
  await expect(
    page.locator(`[data-comment-id="${frozenComment.id}"]`),
  ).toBeFocused()
  await page.screenshot({
    path: '.amp/in/artifacts/sheet03-frozen-review-comment.png',
  })
})
