/**
 * SRCH-01.3 — extracted file text is searchable by line and write-scoped.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, grantProjectAccess } from './helpers'

const WS = '00000000-0000-4000-8000-000000001a0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001a0b'
const PROJECT = '00000000-0000-4000-8000-000000001a0c'
const OTHER_PROJECT = '00000000-0000-4000-8000-000000001a0d'
const RECORD = '00000000-0000-4000-8000-000000001a0e'
const OTHER_RECORD = '00000000-0000-4000-8000-000000001a0f'
const FILE_ID = '00000000-0000-4000-8000-000000001a10'
const OTHER_FILE_ID = '00000000-0000-4000-8000-000000001a11'
const MEMBER = 'fcs-member'
const VIEWER = 'fcs-viewer'
const OUTSIDER = 'fcs-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

const storageKey = (first: string) =>
  `${first}/00000000-0000-4000-8000-000000001a02/0000000000000000000000000000aaaa`

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'FCS Member', 'fcs@sheetbase.test', true),
      ('${VIEWER}', 'FCS Viewer', 'fcsv@sheetbase.test', true),
      ('${OUTSIDER}', 'FCS Outsider', 'fcso@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'fcs-ws', 'FCS WS'),
      ('${OTHER_WS}', 'fcs-other', 'FCS other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'fcs', 'FCS', '${MEMBER}'),
      ('${OTHER_PROJECT}', '${OTHER_WS}', 'fcso', 'FCS other', '${OUTSIDER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
  await migrator.query(`SELECT 1 WHERE false`)
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${RECORD}', '${WS}', '${PROJECT}', 'file', 'FILE-A', 'Run 07 CSV', '${MEMBER}'),
      ('${OTHER_RECORD}', '${OTHER_WS}', '${OTHER_PROJECT}', 'file', 'FILE-B', 'Other CSV', '${OUTSIDER}')`,
  )
  await migrator.query(
    `INSERT INTO api.file_objects
       (id, workspace_id, record_id, storage_key, display_name, media_type, byte_size, extracted_text, extracted_at)
     VALUES
      ('${FILE_ID}', '${WS}', '${RECORD}', '${storageKey('aa01aa01-aa01-4a01-8a01-000000000001')}', 'run07.csv', 'text/csv', 42, 'day,conc\n0,4\n7,3.5\n', now()),
      ('${OTHER_FILE_ID}', '${OTHER_WS}', '${OTHER_RECORD}', '${storageKey('aa01aa01-aa01-4a01-8a01-000000000002')}', 'other.csv', 'text/csv', 42, 'day,conc\n0,9\n', now())`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('api.search_file_contents', () => {
  it('returns the matching line with its number', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows } = await member.query<{
      identifier: string
      display_name: string
      line_number: number
      line_text: string
    }>(`SELECT * FROM api.search_file_contents('conc', 20)`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      identifier: 'FILE-A',
      display_name: 'run07.csv',
      line_number: 1,
    })
    expect(rows[0]?.line_text).toContain('conc')
  })

  it('lets a workspace viewer read file content matches', async () => {
    const viewer = await asAuthenticated(VIEWER, WS)
    const { rows } = await viewer.query(
      `SELECT * FROM api.search_file_contents('conc', 20)`,
    )
    expect(rows).toHaveLength(1)
  })

  it('shows an outsider only their own workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const { rows } = await outsider.query<{ identifier: string }>(
      `SELECT * FROM api.search_file_contents('conc', 20)`,
    )
    expect(rows.map((row) => row.identifier)).toEqual(['FILE-B'])
  })

  it('returns nothing when an outsider claims another workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, WS)
    const { rows } = await outsider.query(
      `SELECT * FROM api.search_file_contents('conc', 20)`,
    )
    expect(rows).toEqual([])
  })
})

describe('api.record_file_text', () => {
  it('lets a member replace the extracted text', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    await member.query(`SELECT api.record_file_text($1, $2)`, [
      FILE_ID,
      'day,conc\n0,4\n14,2.1\n',
    ])
    const { rows } = await member.query<{ line_text: string }>(
      `SELECT line_text FROM api.search_file_contents('2.1', 20)`,
    )
    expect(rows[0]?.line_text).toContain('2.1')
  })

  it('denies an outsider', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    await expect(
      outsider.query(`SELECT api.record_file_text($1, $2)`, [FILE_ID, 'leak']),
    ).rejects.toThrow(/workspace|access denied/i)
  })
})
