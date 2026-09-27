/**
 * PROJ-03.3 — project archival is admin-only, reversible, audited, and makes
 * the project's records read-only while they stay readable.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000050a'
const PROJECT = '00000000-0000-4000-8000-00000000050b'
const RECORD = '00000000-0000-4000-8000-00000000050c'
const ADMIN = 'archive-admin'
const MEMBER = 'archive-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${ADMIN}', 'Archive Admin', 'archive-admin@sheetbase.test', true),
      ('${MEMBER}', 'Archive Member', 'archive-member@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'archive-ws', 'Archive WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${ADMIN}', 'admin'),
      ('${WS}', '${MEMBER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES ('${PROJECT}', '${WS}', 'arch', 'Archive me')`,
  )
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-A1', 'Readable record', '${ADMIN}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

describe('api.archive_project', () => {
  it('refuses a non-admin member', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(`SELECT api.archive_project('${PROJECT}')`),
      '42501',
    )
  })

  it('archives for an admin and makes the project read-only', async () => {
    const admin = await asAuthenticated(ADMIN)
    const { rows } = await admin.query<{ status: string; archived_at: string }>(
      `SELECT * FROM api.archive_project('${PROJECT}')`,
    )
    expect(rows[0]?.status).toBe('archived')
    expect(rows[0]?.archived_at).not.toBeNull()

    // Records stay readable.
    const read = await admin.query(
      `SELECT title FROM api.records WHERE id = $1`,
      [RECORD],
    )
    expect(read.rows[0]?.title).toBe('Readable record')

    // But existing records cannot be edited…
    await expect(
      admin.query(`UPDATE api.records SET title = 'edited' WHERE id = $1`, [
        RECORD,
      ]),
    ).rejects.toMatchObject({ code: 'SB004' })

    // …and no new record can be created in the project.
    await expect(
      admin.query(
        `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id)
         VALUES ('${WS}', '${PROJECT}', 'experiment', 'EXP-A2', 'New record', '${ADMIN}')`,
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('records the archive as a change event', async () => {
    const events = await migrator.query<{
      operation: string
      payload: { status?: string }
    }>(
      `SELECT operation, payload FROM api.change_events
        WHERE entity_type = 'project' AND entity_uuid = $1
        ORDER BY sequence DESC LIMIT 5`,
      [PROJECT],
    )
    expect(
      events.rows.some(
        (row) =>
          row.operation === 'update' && row.payload.status === 'archived',
      ),
    ).toBe(true)
  })

  it('unarchives for an admin and restores writes', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(`SELECT api.unarchive_project('${PROJECT}')`),
      '42501',
    )

    const admin = await asAuthenticated(ADMIN)
    const { rows } = await admin.query<{
      status: string
      archived_at: string | null
    }>(`SELECT * FROM api.unarchive_project('${PROJECT}')`)
    expect(rows[0]?.status).toBe('active')
    expect(rows[0]?.archived_at).toBeNull()

    const updated = await admin.query(
      `UPDATE api.records SET title = 'editable again' WHERE id = $1`,
      [RECORD],
    )
    expect(updated.rowCount).toBe(1)
  })
})
