/**
 * SCI-02 database contract proof for saved analysis definitions: RLS
 * isolation (workspace read, owner-only mutation), the version-bump trigger
 * with immutable identity, and stale-source revision storage.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000120a'
const PROJECT_A = '00000000-0000-4000-8000-00000000121a'
const OWNER = 'sci-02-owner'
const OTHER = 'sci-02-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function authenticated(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, workspace_id: WS_A, role: 'authenticated' }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('${OWNER}','SCI 02 Owner','sci-02-owner@sheetbase.test',true),
     ('${OTHER}','SCI 02 Other','sci-02-other@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS_A}','sci-02-a','SCI 02 A')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${OWNER}','owner'),('${WS_A}','${OTHER}','member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title)
     VALUES ('${PROJECT_A}','${WS_A}','sci-02-a','SCI 02 A')`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

const definition = {
  definitionVersion: 1,
  kind: 'regression',
  datasets: [{ tableId: '00000000-0000-4000-8000-00000000000f' }],
  outcome: { columnId: '00000000-0000-4000-8000-000000000010', fieldName: 'recovery' },
  predictor: { columnId: '00000000-0000-4000-8000-000000000011', fieldName: 'time_h' },
  degree: 1,
}

describe('SCI-02 analysis definitions', () => {
  it('bumps the version on update and keeps identity immutable', async () => {
    const owner = await authenticated(OWNER)
    const inserted = await owner.query(
      `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
       VALUES ($1,$2,'Recovery fit',$3::jsonb,'[]'::jsonb) RETURNING *`,
      [WS_A, OWNER, JSON.stringify(definition)],
    )
    expect(inserted.rows[0].version).toBe(1)

    const updated = await owner.query(
      `UPDATE api.analysis_definitions SET definition=$2::jsonb WHERE id=$1 RETURNING *`,
      [
        inserted.rows[0].id,
        JSON.stringify({ ...definition, degree: 2 }),
      ],
    )
    expect(updated.rows[0].version).toBe(2)

    // Identity is immutable even for the owner.
    await expect(
      owner.query(
        `UPDATE api.analysis_definitions SET workspace_id='00000000-0000-4000-8000-000000000099' WHERE id=$1`,
        [inserted.rows[0].id],
      ),
    ).rejects.toThrow(/identity/)
  })

  it('lets any workspace member read but only the owner mutate', async () => {
    const other = await authenticated(OTHER)
    const owner = await authenticated(OWNER)
    const read = await other.query(`SELECT id FROM api.analysis_definitions`)
    expect(read.rows).toHaveLength(1)

    // Foreign rows are invisible under RLS: mutations resolve but touch
    // nothing.
    const hijack = await other.query(
      `UPDATE api.analysis_definitions SET name=$1 WHERE name='Recovery fit'`,
      ['Hijacked'],
    )
    expect(hijack.rowCount).toBe(0)
    const remove = await other.query(
      `DELETE FROM api.analysis_definitions WHERE name='Recovery fit'`,
    )
    expect(remove.rowCount).toBe(0)

    const untouched = await owner.query(
      `SELECT name FROM api.analysis_definitions WHERE name=$1`,
      ['Recovery fit'],
    )
    expect(untouched.rows).toHaveLength(1)
  })

  it('stores source revisions so stale sources are detectable later', async () => {
    const owner = await authenticated(OWNER)
    const revisions = JSON.stringify([
      {
        tableId: '00000000-0000-4000-8000-00000000000f',
        schemaVersion: 4,
        datasetSchemaId: null,
        datasetSchemaRevision: null,
      },
    ])
    const res = await owner.query(
      `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
       VALUES ($1,$2,'Pinned sources',$3::jsonb,$4::jsonb) RETURNING source_revisions`,
      [WS_A, OWNER, JSON.stringify(definition), revisions],
    )
    expect(res.rows[0].source_revisions[0].schemaVersion).toBe(4)
  })
})
