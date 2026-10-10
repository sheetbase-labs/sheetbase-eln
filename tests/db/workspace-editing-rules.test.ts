/**
 * SET-01.3 — editing rules enforced server-side.
 *
 * The design's SettingsGeneral states "Ask for a reason when a saved value is
 * changed — The reason is written to History with the old and new value." The
 * rule is per workspace, set by an owner, and enforced by triggers on the saved
 * value tables, so it holds for RPC writes and direct writes alike. The reason
 * travels in the request header PostgREST exposes as `request.headers`.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAdHocTextField } from '#/lib/sheet-local-data'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c600'
const PROJECT = '00000000-0000-4000-8000-00000000c601'
const RECORD = '00000000-0000-4000-8000-00000000c602'
const BLOCK = '00000000-0000-4000-8000-00000000c603'
const OWNER = 'set01-owner'
const MEMBER = 'set01-member'
const FIELD = '00000000-0000-4000-8000-00000000c605'
const ROW = '00000000-0000-4000-8000-00000000c606'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const REASON_HEADER = 'x-sheetbase-change-reason'

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, MEMBER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'set01','SET-01')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'SET01','Editing rules',$3)`,
    [PROJECT, WS, OWNER],
  )
  // The project-owner trigger already granted the lead, so only the member
  // needs an explicit rule.
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,can_edit,granted_by_user_id)
     values($1,$2,$3,true,true,$4)`,
    [WS, PROJECT, MEMBER, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-EDIT','Editing rules','draft',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  await migrator.query(
    `insert into api.blocks(id,record_id,type,payload,"order",created_by_user_id)
     values($1,$2,'rich_text',$3::jsonb,1,$4)`,
    [BLOCK, RECORD, JSON.stringify({ text: 'Saved reading' }), OWNER],
  )
  // Sheet Instances are created through their controlled RPC, with the state
  // shape the Sheet Definition validator accepts.
  await setActorJwt(migrator, OWNER, WS)
  await migrator.query(
    `select api.create_sheet_instance($1,'Editing rules sheet',null,null,$2,null,$3::jsonb)`,
    [
      WS,
      PROJECT,
      JSON.stringify({
        bindings: [],
        localFields: [{ ...createAdHocTextField('Reading'), fieldId: FIELD }],
        localValues: { [ROW]: { [FIELD]: 'initial' } },
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
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, reason?: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  await client.query("select set_config('request.headers',$1,false)", [
    JSON.stringify(reason === undefined ? {} : { [REASON_HEADER]: reason }),
  ])
  return client
}

async function setRule(client: Client, on: boolean) {
  return client.query(
    'select * from api.update_workspace_settings($1,$2,$3,$4,$5,$6,$7,$8)',
    [WS, null, null, null, null, null, null, on],
  )
}

async function writeBlock(client: Client, text: string, version: number) {
  return client.query(
    'update api.blocks set payload=$2::jsonb, version=$3 where id=$1',
    [BLOCK, JSON.stringify({ text }), version],
  )
}

describe('SET-01.3 workspace editing rules', () => {
  it('leaves writes unchanged until a workspace opts in', async () => {
    const owner = await actor(OWNER)
    await writeBlock(owner, 'First edit', 2)
    const { rows } = await migrator.query<{ payload: { text: string } }>(
      'select payload from api.blocks where id=$1',
      [BLOCK],
    )
    expect(rows[0]!.payload.text).toBe('First edit')
  })

  it('requires a reason for a saved block value once enabled, and writes it to History', async () => {
    const owner = await actor(OWNER)
    await setRule(owner, true)
    await expectDenied(writeBlock(owner, 'Unreasoned edit', 3), 'SB114')

    const reasoned = await actor(OWNER, 'Corrected against the bench sheet')
    await writeBlock(reasoned, 'Reasoned edit', 3)

    const events = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events
        where entity_type='block' and entity_uuid=$1 order by sequence desc limit 1`,
      [BLOCK],
    )
    expect(events.rows[0]!.payload).toMatchObject({
      reason: 'Corrected against the bench sheet',
      effect: 'value_changed',
      changes: {
        text: {
          from: 'First edit',
          to: 'Reasoned edit',
          label: 'Saved value',
        },
      },
    })
  })

  it('requires a reason for a sheet cell value once enabled', async () => {
    // Sheet state is writable only through the controlled RPC, and the rule is
    // enforced on the table that RPC writes.
    const instance = (
      await migrator.query<{ id: string; revision: string }>(
        `select id, revision from api.sheet_instances where name='Editing rules sheet'`,
      )
    ).rows[0]!
    const mutate = (client: Client) =>
      client.query(
        `select api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb)`,
        [
          instance.id,
          instance.revision,
          crypto.randomUUID(),
          JSON.stringify([
            {
              operation: 'add',
              field: {
                ...createAdHocTextField('Second reading'),
                fieldId: '00000000-0000-4000-8000-00000000c607',
              },
            },
          ]),
        ],
      )
    const owner = await actor(OWNER)
    await expectDenied(mutate(owner), 'SB114')
    const reasoned = await actor(OWNER, 'Added a second reading column')
    await expect(mutate(reasoned)).resolves.toBeDefined()
  })

  it('lets only an owner change the rules and audits the change', async () => {
    const member = await actor(MEMBER)
    await expectDenied(setRule(member, false), 'SB056')
    const owner = await actor(OWNER)
    const { rows } = await setRule(owner, false)
    expect(rows[0]).toMatchObject({
      require_change_reason: false,
      lock_on_sign: true,
      allow_offline_editing: true,
    })
    const events = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events
        where entity_type='workspace_settings' and entity_uuid=$1`,
      [WS],
    )
    expect(events.rows.at(-1)!.payload).toMatchObject({
      effect: 'editing_rules',
      requireChangeReason: false,
    })
  })
})
