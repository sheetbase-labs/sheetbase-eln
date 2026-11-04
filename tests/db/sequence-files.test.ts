/**
 * Sequence files keep a summary on the file, written only by people who can edit.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, grantProjectAccess } from './helpers'

const WS = '00000000-0000-4000-8000-000000001b0a'
const OTHER_WS = '00000000-0000-4000-8000-000000001b0b'
const PROJECT = '00000000-0000-4000-8000-000000001b0c'
const OTHER_PROJECT = '00000000-0000-4000-8000-000000001b0d'
const RECORD = '00000000-0000-4000-8000-000000001b0e'
const OTHER_RECORD = '00000000-0000-4000-8000-000000001b0f'
const FILE_ID = '00000000-0000-4000-8000-000000001b10'
const OTHER_FILE_ID = '00000000-0000-4000-8000-000000001b11'
const MEMBER = 'sq-member'
const VIEWER = 'sq-viewer'
const OUTSIDER = 'sq-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

const storageKey = (first: string) =>
  `${first}/00000000-0000-4000-8000-000000001b02/0000000000000000000000000000aaaa`

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
      ('${WS}', 'sq-ws', 'FCS WS'),
      ('${OTHER_WS}', 'sq-other', 'FCS other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'sq', 'FCS', '${MEMBER}'),
      ('${OTHER_PROJECT}', '${OTHER_WS}', 'sqo', 'FCS other', '${OUTSIDER}')`,
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
      ('${FILE_ID}', '${WS}', '${RECORD}', '${storageKey('aa01aa01-aa01-4a01-8a01-000000000001')}', 'pTest.gb', 'text/plain', 42, 'pTest', now()),
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

const SUMMARY = {
  name: 'pTest',
  molecule: 'dna',
  topology: 'circular',
  length: 4268,
  featureCount: 8,
  gc: 52.2,
}

describe('api.record_file_sequence', () => {
  it('lets a member keep a sequence summary on a file', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    await member.query(`SELECT api.record_file_sequence($1, $2)`, [
      FILE_ID,
      JSON.stringify(SUMMARY),
    ])
    const { rows } = await member.query<{ sequence_summary: typeof SUMMARY }>(
      `SELECT sequence_summary FROM api.file_objects WHERE id = $1`,
      [FILE_ID],
    )
    expect(rows[0]?.sequence_summary).toMatchObject({
      topology: 'circular',
      length: 4268,
    })
  })

  it('refuses a summary that is not a sequence summary', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    await expect(
      member.query(`SELECT api.record_file_sequence($1, $2)`, [
        FILE_ID,
        JSON.stringify({ ...SUMMARY, molecule: 'lipid' }),
      ]),
    ).rejects.toThrow(/chk_file_objects_sequence_summary/)
  })

  it('denies a viewer', async () => {
    const viewer = await asAuthenticated(VIEWER, WS)
    await expect(
      viewer.query(`SELECT api.record_file_sequence($1, $2)`, [
        FILE_ID,
        JSON.stringify(SUMMARY),
      ]),
    ).rejects.toThrow()
  })

  it('denies an outsider', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    await expect(
      outsider.query(`SELECT api.record_file_sequence($1, $2)`, [
        FILE_ID,
        JSON.stringify(SUMMARY),
      ]),
    ).rejects.toThrow(/workspace|access denied|permitted/i)
  })
})
