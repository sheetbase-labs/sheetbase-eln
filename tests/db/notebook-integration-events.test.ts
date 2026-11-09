/**
 * Notebook work on the change feed: files quarantined and restored through
 * the two new calls, and people being given protocols to train on.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ce00'
const PROJECT = '00000000-0000-4000-8000-00000000ce02'
const RECORD = '00000000-0000-4000-8000-00000000ce03'
const FILE = '00000000-0000-4000-8000-00000000ce04'
const PROTOCOL = '00000000-0000-4000-8000-00000000ce05'
const OWNER = 'nbev-owner'
const TRAINEE = 'nbev-trainee'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, TRAINEE]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'nbev','Notebook events')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, TRAINEE],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'NBEV','Events',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-NBEV','Run','draft',$4),
           ($5,$2,$3,'protocol_template','PRT-NBEV','Wash','active',$4)`,
    [RECORD, WS, PROJECT, OWNER, PROTOCOL],
  )
  await migrator.query(
    `insert into api.file_objects(id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,checksum,checksum_algorithm,status,storage_backend,version,created_by_user_id)
     values($1,$2,$3,'00000000-0000-4000-8000-00000000ce00/00000000-0000-4000-8000-00000000ce03/0123456789abcdef0123456789abcdef','a.csv','text/csv',10,'aaa','sha256','active','local',1,$4)`,
    [FILE, WS, RECORD, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

const events = async (entityType: string, entityId: string) =>
  (
    await migrator.query<{
      operation: string
      payload: Record<string, unknown>
    }>(
      `select operation,payload from api.change_events
        where workspace_id=$1 and entity_type=$2 and entity_uuid=$3 order by sequence`,
      [WS, entityType, entityId],
    )
  ).rows

describe('notebook change events', () => {
  it('writes quarantine and restore events from the two file calls', async () => {
    const owner = await actor(OWNER)
    const quarantined = await owner.query<{ version: number; status: string }>(
      'select version,status from api.quarantine_file($1,1,$2)',
      [FILE, 'Suspect upload'],
    )
    expect(quarantined.rows[0]!.status).toBe('quarantined')
    const restored = await owner.query<{ status: string }>(
      'select status from api.restore_file($1,$2)',
      [FILE, quarantined.rows[0]!.version],
    )
    expect(restored.rows[0]!.status).toBe('active')
    expect((await events('file', FILE)).map((row) => row.operation)).toEqual([
      'quarantine',
      'restore',
    ])
  })

  it('writes training assigned and removed events', async () => {
    await setActorJwt(migrator, OWNER, WS)
    const { rows } = await migrator.query<{ id: string }>(
      `insert into api.protocol_training(workspace_id,protocol_record_id,user_id)
       values($1,$2,$3) returning id`,
      [WS, PROTOCOL, TRAINEE],
    )
    const id = rows[0]!.id
    await migrator.query('delete from api.protocol_training where id=$1', [id])
    const seen = await events('protocol_training', id)
    expect(seen.map((row) => row.operation)).toEqual(['create', 'delete'])
    expect(seen[0]!.payload).toMatchObject({
      protocolRecordId: PROTOCOL,
      userId: TRAINEE,
    })
  })

  it('lets an agent delete a file but nothing else that deletes', async () => {
    const { rows } = await migrator.query<{ file: boolean; record: boolean }>(
      `SELECT internal.agent_action_always_never('delete_file') AS file,
              internal.agent_action_always_never('delete_record') AS record`,
    )
    expect(rows[0]).toEqual({ file: false, record: true })
  })
})
