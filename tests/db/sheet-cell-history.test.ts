/**
 * Show changes — `api.sheet_cell_history` lists what each cell held before
 * and after every write, newest first. It runs as the caller, so the sheet's
 * own read authority decides whether anything comes back.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAdHocTextField } from '#/lib/sheet-local-data'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c710'
const OTHER_WS = '00000000-0000-4000-8000-00000000c711'
const PROJECT = '00000000-0000-4000-8000-00000000c712'
const FIELD = '00000000-0000-4000-8000-00000000c713'
const ROW = '00000000-0000-4000-8000-00000000c714'
const OWNER = 'history-owner'
const NOBODY = 'history-nobody'
const OUTSIDER = 'history-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let instanceId = ''
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, NOBODY, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'history','History'),($2,'history-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`,
    [WS, OWNER, NOBODY, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id)
     values($1,$2,'HIST','Clarification',$3)`,
    [PROJECT, WS, OWNER],
  )
  await setActorJwt(migrator, OWNER, WS)
  const created = await migrator.query<{ id: string }>(
    `select (api.create_sheet_instance($1,'Clarification runs',null,null,$2,null,$3::jsonb)).id`,
    [
      WS,
      PROJECT,
      JSON.stringify({
        bindings: [],
        localFields: [{ ...createAdHocTextField('Load'), fieldId: FIELD }],
        localValues: { [ROW]: { [FIELD]: '150' } },
        calculationOverrides: {},
        presentation: {
          columnOrder: [FIELD],
          hiddenColumnIds: [],
          columnWidths: {},
          frozenColumnCount: 0,
          density: 'standard',
          filters: [],
          sorts: [],
        },
        provenance: { createdFrom: 'ad_hoc' },
      }),
    ],
  )
  instanceId = created.rows[0]!.id
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

async function setCell(value: string) {
  const owner = await actor(OWNER)
  const revision = (
    await migrator.query<{ revision: string }>(
      'select revision from api.sheet_instances where id=$1',
      [instanceId],
    )
  ).rows[0]!.revision
  await owner.query(
    `select api.mutate_sheet_instance_local_state($1,$2,$3,'[]'::jsonb,$4::jsonb,$5::jsonb)`,
    [
      instanceId,
      revision,
      crypto.randomUUID(),
      JSON.stringify([{ kind: 'local', rowKey: ROW }]),
      JSON.stringify([{ rowKey: ROW, fieldId: FIELD, value }]),
    ],
  )
}

async function history(client: Client, limit?: number) {
  return (
    await client.query<{ history: Array<Record<string, unknown>> }>(
      'select api.sheet_cell_history($1,$2) as history',
      [instanceId, limit ?? null],
    )
  ).rows[0]!.history
}

describe('sheet cell history', () => {
  it('lists each change with the value before and after, newest first', async () => {
    await setCell('146')
    await setCell('148')
    const owner = await actor(OWNER)
    const changes = await history(owner)

    expect(
      changes.map(
        ({ before, after, beforeKnown, rowKey, fieldId, source }) => ({
          before,
          after,
          beforeKnown,
          rowKey,
          fieldId,
          source,
        }),
      ),
    ).toEqual([
      {
        before: '146',
        after: '148',
        beforeKnown: true,
        rowKey: ROW,
        fieldId: FIELD,
        source: 'sheet',
      },
      // The first write after the sheet was made: what it held before is
      // not kept, so the change says so instead of guessing.
      {
        before: null,
        after: '146',
        beforeKnown: false,
        rowKey: ROW,
        fieldId: FIELD,
        source: 'sheet',
      },
    ])
    expect(changes[0]?.actorUserId).toBe(OWNER)
  })

  it('keeps the value before the oldest change it returns', async () => {
    const owner = await actor(OWNER)
    const [only] = await history(owner, 1)

    expect(only).toMatchObject({ before: '146', after: '148' })
  })

  it('returns nothing to people who cannot open the sheet', async () => {
    expect(await history(await actor(NOBODY))).toEqual([])
    expect(await history(await actor(OUTSIDER, OTHER_WS))).toEqual([])
  })
})
