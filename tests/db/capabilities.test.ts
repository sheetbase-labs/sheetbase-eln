import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000c052'
const WS_B = '00000000-0000-4000-8000-00000000c053'
const PROJECT_A = '00000000-0000-4000-8000-00000000c152'
const OWNER = 'core-05-cap-owner'
const ADMIN = 'core-05-cap-admin'
const STEWARD = 'core-05-cap-steward'
const MEMBER = 'core-05-cap-member'
const VIEWER = 'core-05-cap-viewer'
const OTHER_OWNER = 'core-05-cap-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','cap-owner@test.invalid',true),
      ('${ADMIN}','Admin','cap-admin@test.invalid',true),
      ('${STEWARD}','Steward','cap-steward@test.invalid',true),
      ('${MEMBER}','Member','cap-member@test.invalid',true),
      ('${VIEWER}','Viewer','cap-viewer@test.invalid',true),
      ('${OTHER_OWNER}','Other','cap-other@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','core-05-cap-a','CORE-05 capabilities A'),
      ('${WS_B}','core-05-cap-b','CORE-05 capabilities B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER}','owner'),
      ('${WS_A}','${ADMIN}','admin'),
      ('${WS_A}','${STEWARD}','steward'),
      ('${WS_A}','${MEMBER}','member'),
      ('${WS_A}','${VIEWER}','viewer'),
      ('${WS_B}','${OTHER_OWNER}','owner');
    insert into api.projects(id,workspace_id,key,title) values
      ('${PROJECT_A}','${WS_A}','cap','Capabilities')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-05 capability resolver', () => {
  it('maps steward to governed schema capabilities without workspace.admin', async () => {
    const steward = await actor(STEWARD, WS_A)
    const { rows } = await steward.query(
      `select api.has_capability($1,'workspace.admin') as workspace_admin,
              api.has_capability($1,'schema.edit') as schema_edit,
              api.has_capability($1,'schema.publish') as schema_publish,
              api.has_capability($1,'schema.retire') as schema_retire,
              api.has_capability($1,'record.link') as record_link,
              api.has_capability($1,'record.create') as record_create,
              api.has_capability($1,'instance.upgrade') as instance_upgrade,
              api.has_capability($1,'unknown.cap') as unknown_cap,
              api.list_capabilities($1) as listed`,
      [WS_A],
    )
    expect(rows[0]).toMatchObject({
      workspace_admin: false,
      schema_edit: true,
      schema_publish: true,
      schema_retire: true,
      record_link: true,
      record_create: true,
      instance_upgrade: true,
      unknown_cap: false,
    })
    expect(rows[0].listed).toEqual([
      'instance.upgrade',
      'record.create',
      'record.link',
      'schema.edit',
      'schema.publish',
      'schema.retire',
    ])
  })

  it('keeps unused viewer as a full member-class data actor, not schema authority', async () => {
    const viewer = await actor(VIEWER, WS_A)
    const { rows } = await viewer.query(
      `select api.has_capability($1,'schema.publish') as schema_publish,
              api.has_capability($1,'record.create') as record_create,
              api.has_capability($1,'instance.upgrade') as instance_upgrade`,
      [WS_A],
    )
    expect(rows[0]).toEqual({
      schema_publish: false,
      record_create: true,
      instance_upgrade: true,
    })
  })

  it('isolates capabilities to the JWT workspace', async () => {
    const steward = await actor(STEWARD, WS_A)
    const { rows } = await steward.query(
      `select api.has_capability($1,'schema.publish') allowed`,
      [WS_B],
    )
    expect(rows[0].allowed).toBe(false)
  })

  it('lets a steward manage canonical Dataset Schema without inviting members', async () => {
    const steward = await actor(STEWARD, WS_A)
    const member = await actor(MEMBER, WS_A)
    const created = await steward.query(
      `select api.create_dataset_schema_definition($1,'stability_result','Stability result',null,$2::jsonb) result`,
      [
        WS_A,
        JSON.stringify([
          {
            key: 'titre',
            label: 'Titre',
            logical_type: 'decimal',
            nullable: true,
          },
        ]),
      ],
    )
    const ids = created.rows[0].result
    expect(ids.schema_definition_id).toBeTruthy()
    const published = await steward.query(
      `select lifecycle from api.publish_dataset_schema_version($1)`,
      [ids.schema_version_id],
    )
    expect(published.rows[0].lifecycle).toBe('active')
    await expectDenied(
      steward.query(
        `select api.create_invitation($1,'x@test.invalid','member',7)`,
        [WS_A],
      ),
      'SB061',
    )
    await expectDenied(
      member.query(
        `select api.create_dataset_schema_definition($1,'member_schema','Member schema',null,'[]'::jsonb)`,
        [WS_A],
      ),
      '42501',
    )
    await expectDenied(
      steward.query(
        `select api.replace_dataset_schema_version_fields($1,'[]'::jsonb)`,
        [ids.schema_version_id],
      ),
      'SB072',
    )
  })

  it('lets a steward configure Model fields and Sheet Definitions while members are denied', async () => {
    const steward = await actor(STEWARD, WS_A)
    const member = await actor(MEMBER, WS_A)
    const field = await steward.query(
      `select id from api.create_model_field($1,'sample','cap_note','Note','text',true,null,'{}'::jsonb)`,
      [WS_A],
    )
    expect(field.rows[0].id).toBeTruthy()
    await expectDenied(
      member.query(
        `select api.create_model_field($1,'sample','member_note','Note','text',true,null,'{}'::jsonb)`,
        [WS_A],
      ),
      '42501',
    )
    const configuration = JSON.stringify(validSheetDefinitionConfiguration())
    const definition = await steward.query(
      `select api.create_sheet_definition($1,'cap_sheet','Capability sheet','',$2::jsonb) result`,
      [WS_A, configuration],
    )
    expect(definition.rows[0].result.definition.id).toBeTruthy()
    await expectDenied(
      member.query(
        `select api.create_sheet_definition($1,'member_sheet','Member sheet','',$2::jsonb)`,
        [WS_A, configuration],
      ),
      '42501',
    )
  })

  it('distinguishes record.link and record.create at the RPC boundary', async () => {
    const { rows } = await migrator.query(
      `select proname, pg_get_functiondef(oid) as def
         from pg_proc
        where pronamespace = 'api'::regnamespace
          and proname in (
            'search_sheet_records',
            'create_and_link_sheet_record',
            'create_model_record',
            'validate_sheet_record_batch',
            'commit_sheet_record_batch',
            'preview_sheet_instance_definition_upgrade'
          )`,
    )
    const byName = Object.fromEntries(rows.map((row) => [row.proname, row.def]))
    expect(byName.search_sheet_records).toMatch(/record\.link/)
    expect(byName.search_sheet_records).not.toMatch(/record\.create/)
    expect(byName.create_and_link_sheet_record).toMatch(/record\.create/)
    expect(byName.create_model_record).toMatch(/record\.create/)
    expect(byName.validate_sheet_record_batch).toMatch(
      /assert_record_batch_capabilities/,
    )
    expect(byName.commit_sheet_record_batch).toMatch(
      /assert_record_batch_capabilities/,
    )
    expect(byName.preview_sheet_instance_definition_upgrade).toMatch(
      /instance\.upgrade/,
    )
    const member = await actor(MEMBER, WS_A)
    const search = await member.query(
      `select api.search_sheet_records('sample','',5,false) as result`,
    )
    expect(search.rows[0].result).toEqual([])
    const created = await member.query(
      `select id from api.create_model_record($1,'sample','Capability sample','available',ARRAY[]::text[],'{}'::jsonb,'{}'::jsonb)`,
      [PROJECT_A],
    )
    expect(created.rows[0].id).toBeTruthy()
  })

  it('does not let a member write canonical Dataset Schema tables directly', async () => {
    const member = await actor(MEMBER, WS_A)
    await expectDenied(
      member.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,'member_direct','Member direct')`,
        [WS_A],
      ),
      '42501',
    )
  })
})
