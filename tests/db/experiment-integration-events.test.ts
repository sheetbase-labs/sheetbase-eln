/**
 * Record aliases and label templates on the change feed: adding and removing
 * another name for a record, and adding or archiving a label template, write
 * the events their webhook names pick on.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { mapEventType } from '#/lib/webhook-events'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ce00'
const PROJECT = '00000000-0000-4000-8000-00000000ce01'
const RECORD = '00000000-0000-4000-8000-00000000ce02'
const OWNER = 'expev-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'expev','Experiment events')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'EV1','Events',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'sample','SMP-9001','A sample',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function owner(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, OWNER, WS)
  return client
}

const events = async (entityType: string) =>
  (
    await migrator.query<{
      operation: string
      record_id: string | null
      payload: Record<string, unknown>
    }>(
      `select operation,record_id,payload from api.change_events
        where workspace_id=$1 and entity_type=$2 order by sequence`,
      [WS, entityType],
    )
  ).rows

it('writes another name added to and taken off a record', async () => {
  const db = await owner()
  await db.query(`select api.add_record_alias($1,'SUP-77')`, [RECORD])
  await db.query(`select api.remove_record_alias($1,'SUP-77')`, [RECORD])
  const rows = await events('record_alias')
  expect(
    rows.map((row) => mapEventType('record_alias', row.operation, row.payload)),
  ).toEqual(['record.alias.added', 'record.alias.removed'])
  expect(rows[0]).toMatchObject({
    record_id: RECORD,
    payload: { recordId: RECORD, alias: 'SUP-77' },
  })
})

it('writes a label template added and archived', async () => {
  // Saved as the owner, as the label settings screen saves it.
  await setActorJwt(migrator, OWNER, WS)
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.label_templates(workspace_id,name,record_kind,created_by_user_id)
     values($1,'Cryovial','sample',$2) returning id`,
    [WS, OWNER],
  )
  const db = await owner()
  await db.query(`select api.set_label_template_archived($1,true)`, [
    rows[0]!.id,
  ])
  const written = await events('label_template')
  expect(
    written.map((row) =>
      mapEventType('label_template', row.operation, row.payload),
    ),
  ).toEqual(['label.template.created', 'label.template.updated'])
  expect(written[1]!.payload).toMatchObject({
    name: 'Cryovial',
    archived: true,
  })
})
