/**
 * PROJ-04.3 — file versions.
 *
 * "Upload new version" creates the next version with its own checksum and a link
 * to the one it replaced, so every earlier file stays downloadable; retention
 * comes from the workspace policy and raw files are never deleted.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cb00'
const OTHER_WS = '00000000-0000-4000-8000-00000000cb01'
const PROJECT = '00000000-0000-4000-8000-00000000cb02'
const RECORD = '00000000-0000-4000-8000-00000000cb03'
const FILE_V1 = '00000000-0000-4000-8000-00000000cb04'
const OWNER = 'proj043-owner'
const OUTSIDER = 'proj043-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const key = (suffix: string) =>
  `00000000-0000-4000-8000-00000000c${suffix}/00000000-0000-4000-8000-00000000c${suffix}/0123456789abcdef0123456789abcdef`

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'proj043','PROJ-04.3'),($2,'proj043-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($3,$4,'owner')`,
    [WS, OWNER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'P43','Files',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-P43','Uploaded data','draft',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  await migrator.query(
    `insert into api.file_objects(id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,checksum,checksum_algorithm,status,storage_backend,version,created_by_user_id)
     values($1,$2,$3,$4,'plate-export.csv','text/csv',128,'aaa','sha256','active','local',1,$5)`,
    [FILE_V1, WS, RECORD, key('b04'), OWNER],
  )
  await migrator.query(
    `insert into api.workspace_settings(workspace_id,audit_retention_days,created_by_user_id) values($1,365,$2)
     on conflict (workspace_id) do update set audit_retention_days=365`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

async function chain(client: Client, fileId = FILE_V1) {
  return (
    await client.query<{
      version: number
      checksum: string
      current: boolean
      retention_until: Date | null
    }>(
      'select version,checksum,current,retention_until from api.file_version_chain($1)',
      [fileId],
    )
  ).rows
}

describe('PROJ-04.3 file versions', () => {
  it('creates the next version with its own checksum and keeps the chain', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ id: string; version: number }>(
      'select id,version from api.register_file_version($1,$2,$3,$4,$5,$6)',
      [FILE_V1, 'plate-export.csv', key('b05'), 'text/csv', 256, 'bbb'],
    )
    expect(rows[0]!.version).toBe(2)

    const versions = await chain(owner)
    expect(
      versions.map((row) => [row.version, row.checksum, row.current]),
    ).toEqual([
      [2, 'bbb', true],
      [1, 'aaa', false],
    ])
    // Retention comes from the workspace policy.
    const first = versions[0]!
    const days = Math.round(
      (new Date(first.retention_until!).getTime() - Date.now()) / 86_400_000,
    )
    expect(days).toBeGreaterThan(360)
    expect(days).toBeLessThanOrEqual(365)

    // A third version chains onto the second.
    const third = await owner.query<{ id: string }>(
      'select id from api.register_file_version($1,$2,$3,$4,$5,$6)',
      [rows[0]!.id, 'plate-export.csv', key('b06'), 'text/csv', 512, 'ccc'],
    )
    expect((await chain(owner)).map((row) => row.version)).toEqual([3, 2, 1])
    expect(third.rows[0]!.id).toBeTruthy()
  })

  it('refuses to delete a raw file', async () => {
    await expectDenied(
      migrator.query('delete from api.file_objects where id=$1', [FILE_V1]),
      'SB118',
    )
    const { rows } = await migrator.query(
      'select 1 from api.file_objects where id=$1',
      [FILE_V1],
    )
    expect(rows).toHaveLength(1)
  })

  it('keeps another workspace out of the chain', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(await chain(outsider)).toEqual([])
  })
})
