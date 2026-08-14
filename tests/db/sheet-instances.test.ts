import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS_A = '13000000-0000-4000-8000-000000000001'
const WS_B = '13000000-0000-4000-8000-000000000002'
const OWNER = 'sheet-instance-owner'
const MEMBER = 'sheet-instance-member'
const OUTSIDER = 'sheet-instance-outsider'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const state = (value = 'one') => ({
  bindings: [],
  localFields: [
    {
      fieldId: '13000000-0000-4000-8000-000000000010',
      key: 'observation',
      label: 'Observation',
      description: null,
      logicalType: 'text',
      nullable: true,
      defaultValue: null,
      cardinality: 'one',
      quantity: null,
      validation: {},
      category: null,
      relationship: null,
      computation: { mode: 'stored' },
      lifecycle: 'active',
    },
  ],
  localValues: {
    '13000000-0000-4000-8000-000000000011': {
      '13000000-0000-4000-8000-000000000010': value,
    },
  },
  calculationOverrides: {},
  presentation: {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  },
  provenance: {
    createdFrom: 'duplicate',
    duplicatedFromInstanceId: crypto.randomUUID(),
  },
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

async function create(client: Client, value = 'one') {
  return (
    await client.query(
      `select to_jsonb(api.create_sheet_instance($1,'Working sheet',null,null,null,null,$2::jsonb)) result`,
      [WS_A, JSON.stringify(state(value))],
    )
  ).rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','si-owner@test.invalid',true),($2,'Member','si-member@test.invalid',true),($3,'Outsider','si-outsider@test.invalid',true)`,
    [OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'si-a','SI A'),($2,'si-b','SI B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($1,$4,'member'),($2,$5,'owner')`,
    [WS_A, WS_B, OWNER, MEMBER, OUTSIDER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('Sheet Instance durability and authority', () => {
  it('pins two independent Instances to one exact published Definition Version despite a later version', async () => {
    const owner = await actor(OWNER, WS_A)
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'instance_source','Instance source',null,$2::jsonb) result`,
        [WS_A, JSON.stringify(validSheetDefinitionConfiguration())],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
      definition.version.id,
    ])
    const createPinned = () =>
      owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'Pinned',null,$2,null,null,$3::jsonb)) result`,
        [WS_A, definition.version.id, JSON.stringify(state())],
      )
    const first = (await createPinned()).rows[0].result
    const second = (await createPinned()).rows[0].result
    await owner.query(
      `select api.create_sheet_definition_version($1,1,$2::jsonb)`,
      [
        definition.definition.id,
        JSON.stringify(validSheetDefinitionConfiguration()),
      ],
    )
    expect(first.id).not.toBe(second.id)
    expect(
      (
        await owner.query(
          `select distinct source_definition_version_id from api.sheet_instances where id=any($1)`,
          [[first.id, second.id]],
        )
      ).rows,
    ).toEqual([{ source_definition_version_id: definition.version.id }])
  })

  it('creates independent durable identities, updates one with optimistic revision, and reloads isolation', async () => {
    const owner = await actor(OWNER, WS_A)
    const first = await create(owner)
    const second = await create(owner)
    expect(first.id).not.toBe(second.id)
    await owner.query(`select api.update_sheet_instance($1,1,$2::jsonb)`, [
      first.id,
      JSON.stringify(state('changed')),
    ])
    const rows = (
      await owner.query(
        `select id,revision,state#>>'{localValues,13000000-0000-4000-8000-000000000011,13000000-0000-4000-8000-000000000010}' value from api.sheet_instances where id=any($1) order by id`,
        [[first.id, second.id]],
      )
    ).rows
    expect(rows.map((row) => row.value).sort()).toEqual(['changed', 'one'])
    await expect(
      owner.query(`select api.update_sheet_instance($1,1,$2::jsonb)`, [
        first.id,
        JSON.stringify(state()),
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('duplicates copied local state under a new identity and then isolates mutation', async () => {
    const owner = await actor(OWNER, WS_A)
    const source = await create(owner)
    const copy = (
      await owner.query(
        `select to_jsonb(api.duplicate_sheet_instance($1,1,'Copy')) result`,
        [source.id],
      )
    ).rows[0].result
    expect(copy.id).not.toBe(source.id)
    expect(copy.duplicated_from_instance_id).toBe(source.id)
    expect(copy.state.provenance).toEqual({
      createdFrom: 'duplicate',
      duplicatedFromInstanceId: source.id,
    })
    await owner.query(`select api.update_sheet_instance($1,1,$2::jsonb)`, [
      copy.id,
      JSON.stringify(state('copy changed')),
    ])
    expect(
      (
        await owner.query(`select state from api.sheet_instances where id=$1`, [
          source.id,
        ])
      ).rows[0].state.localValues['13000000-0000-4000-8000-000000000011'][
        '13000000-0000-4000-8000-000000000010'
      ],
    ).toBe('one')
  })

  it('keeps archives readable and rejects update, repeat archive and reduplication', async () => {
    const owner = await actor(OWNER, WS_A)
    const row = await create(owner)
    const archived = (
      await owner.query(
        `select to_jsonb(api.archive_sheet_instance($1,1)) result`,
        [row.id],
      )
    ).rows[0].result
    expect(archived.lifecycle).toBe('archived')
    expect(
      (
        await owner.query(`select id from api.sheet_instances where id=$1`, [
          row.id,
        ])
      ).rowCount,
    ).toBe(1)
    await expect(
      owner.query(`select api.update_sheet_instance($1,2,$2::jsonb)`, [
        row.id,
        JSON.stringify(state()),
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query(`select api.archive_sheet_instance($1,2)`, [row.id]),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query(`select api.duplicate_sheet_instance($1,2,'No')`, [row.id]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('permits member reads, hides rows from non-members, denies direct writes and protects helper ACL/trigger', async () => {
    const owner = await actor(OWNER, WS_A)
    const row = await create(owner)
    const member = await actor(MEMBER, WS_A)
    const outsider = await actor(OUTSIDER, WS_B)
    expect(
      (
        await member.query(`select id from api.sheet_instances where id=$1`, [
          row.id,
        ])
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await outsider.query(`select id from api.sheet_instances where id=$1`, [
          row.id,
        ])
      ).rowCount,
    ).toBe(0)
    await expect(
      member.query(`update api.sheet_instances set name='Bypass' where id=$1`, [
        row.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      migrator.query(`delete from api.sheet_instances where id=$1`, [row.id]),
    ).rejects.toMatchObject({ code: '42501' })
    expect(
      (
        await migrator.query(
          `select tgenabled from pg_trigger where tgrelid='api.sheet_instances'::regclass and tgname='guard_sheet_instance'`,
        )
      ).rows,
    ).toEqual([{ tgenabled: 'O' }])
    expect(
      (
        await migrator.query(
          `select has_function_privilege('authenticated','internal.validate_sheet_instance_state(jsonb)','execute') allowed`,
        )
      ).rows[0].allowed,
    ).toBe(false)
  })
})
