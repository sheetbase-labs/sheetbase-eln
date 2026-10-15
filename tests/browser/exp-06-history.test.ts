import { test, expect } from 'playwright/test'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { config } from 'dotenv'
import { signInAsDesignUser } from '../visual/sign-in'
import { z } from 'zod'

config({ path: ['.env.local', '.env'] })

test('real history selection, category/actor counts and server CSV agree', async ({
  page,
}) => {
  const database = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  })
  const userId = `exp06-browser-${crypto.randomUUID()}`
  const workspaceId = crypto.randomUUID()
  await database.connect()
  try {
    await database.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'History scientist',$1||'@sheetbase.test',true)`,
      [userId],
    )
    await database.query(
      `INSERT INTO api.workspaces(id,slug,name) VALUES($1::uuid,$1::uuid::text,'History browser')`,
      [workspaceId],
    )
    await database.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
      [workspaceId, userId],
    )
    await database.query(
      `INSERT INTO api.workspace_settings(workspace_id,timezone,created_by_user_id) VALUES($1,'Europe/London',$2)`,
      [workspaceId, userId],
    )
    await signInAsDesignUser(page, userId)
    await database.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        sub: userId,
        workspace_id: workspaceId,
        session_id: `parity-${userId}`,
        role: 'authenticated',
      }),
    ])
    const project = z
      .uuid()
      .parse(
        (
          await database.query(
            `SELECT id FROM api.create_project('History browser project')`,
          )
        ).rows[0].id,
      )
    const record = z
      .uuid()
      .parse(
        (
          await database.query(
            `SELECT id FROM api.create_record($1,'experiment','Original method')`,
            [project],
          )
        ).rows[0].id,
      )
    await database.query(
      `UPDATE api.records SET title='Corrected method' WHERE id=$1`,
      [record],
    )
    await page.goto(`/experiments/${record}/history`)
    await expect(page.locator('[data-history-ready="true"]')).toBeVisible({
      timeout: 20_000,
    })
    await page
      .getByRole('button', {
        name: /^Inspect audit entry.*updated Record Corrected method$/,
      })
      .click()
    const inspector = page.getByRole('complementary', { name: 'Entry details' })
    await expect(
      inspector.getByText('Original method', { exact: true }),
    ).toBeVisible()
    await expect(
      inspector.getByText('Corrected method', { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: '.amp/in/artifacts/exp06-integrated-selected.png',
    })
    await page.getByRole('button', { name: /^text 1$/ }).click()
    await expect(inspector).toHaveCount(0)
    await page
      .getByRole('combobox', { name: 'History actor' })
      .selectOption(userId)
    await expect(page.getByRole('button', { name: /^all 2$/ })).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export audit trail' }).click()
    const download = await downloadPromise
    expect(await download.failure()).toBeNull()
    const csv = await readFile(z.string().parse(await download.path()), 'utf8')
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2)
    expect(csv).toContain(',Title,Original method,Corrected method,')
    await page.getByRole('button', { name: /^signatures 0$/ }).click()
    await expect(
      page.getByText('No signatures in this selection.'),
    ).toBeVisible()
  } finally {
    await database.query(`SELECT set_config('request.jwt.claims','{}',false)`)
    await database.query(`DELETE FROM api.data_exports WHERE workspace_id=$1`, [
      workspaceId,
    ])
    // The audit chain is append-only and a workspace delete cascades its
    // entries, so the guard is disabled for that delete alone and re-enabled
    // inside the same transaction, the way the audit fixtures do.
    await database.query('BEGIN')
    try {
      await database.query(
        'ALTER TABLE api.change_events DISABLE TRIGGER refuse_change_event_mutation',
      )
      await database.query(`DELETE FROM api.workspaces WHERE id=$1`, [
        workspaceId,
      ])
      await database.query(
        'ALTER TABLE api.change_events ENABLE TRIGGER refuse_change_event_mutation',
      )
      await database.query('COMMIT')
    } catch (error) {
      await database.query('ROLLBACK')
      throw error
    }
    await database.query(`DELETE FROM internal.session WHERE "userId"=$1`, [
      userId,
    ])
    await database.query(`DELETE FROM internal."user" WHERE id=$1`, [userId])
    await database.end()
  }
})
