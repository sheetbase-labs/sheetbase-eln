/**
 * GOV-01: workspace `viewer` is read-only across the authenticated write
 * plane. Role semantics stay as accepted (viewer read-only; scientist /
 * analyst / reviewer remain member-class; steward schema authority;
 * api_client independent).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000c045'
const WS_B = '00000000-0000-4000-8000-00000000c046'
const PROJECT_A = '00000000-0000-4000-8000-00000000c145'
const PROJECT_B = '00000000-0000-4000-8000-00000000c146'
const OWNER = 'gov-01-owner'
const ADMIN = 'gov-01-admin'
const STEWARD = 'gov-01-steward'
const MEMBER = 'gov-01-member'
const SCIENTIST = 'gov-01-scientist'
const ANALYST = 'gov-01-analyst'
const REVIEWER = 'gov-01-reviewer'
const VIEWER = 'gov-01-viewer'
const OTHER_OWNER = 'gov-01-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string, role = 'authenticated') {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query(`SET ROLE ${role}`)
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role,
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','gov01-owner@test.invalid',true),
      ('${ADMIN}','Admin','gov01-admin@test.invalid',true),
      ('${STEWARD}','Steward','gov01-steward@test.invalid',true),
      ('${MEMBER}','Member','gov01-member@test.invalid',true),
      ('${SCIENTIST}','Scientist','gov01-scientist@test.invalid',true),
      ('${ANALYST}','Analyst','gov01-analyst@test.invalid',true),
      ('${REVIEWER}','Reviewer','gov01-reviewer@test.invalid',true),
      ('${VIEWER}','Viewer','gov01-viewer@test.invalid',true),
      ('${OTHER_OWNER}','Other','gov01-other@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','gov-01-a','GOV-01 A'),
      ('${WS_B}','gov-01-b','GOV-01 B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER}','owner'),
      ('${WS_A}','${ADMIN}','admin'),
      ('${WS_A}','${STEWARD}','steward'),
      ('${WS_A}','${MEMBER}','member'),
      ('${WS_A}','${SCIENTIST}','scientist'),
      ('${WS_A}','${ANALYST}','analyst'),
      ('${WS_A}','${REVIEWER}','reviewer'),
      ('${WS_A}','${VIEWER}','viewer'),
      ('${WS_B}','${OTHER_OWNER}','owner');
    insert into api.projects(id,workspace_id,key,title) values
      ('${PROJECT_A}','${WS_A}','gov1','GOV-01 A'),
      ('${PROJECT_B}','${WS_B}','gov1b','GOV-01 B')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('GOV-01 write-plane inventory', () => {
  it('fails closed: no leftover authenticated write policies or mutation RPCs', async () => {
    const policies = await migrator.query(
      `select relname, polname, cmd, detail
         from internal.gov01_authenticated_write_policy_violations()`,
    )
    const rpcs = await migrator.query(
      `select proname, signature, detail
         from internal.gov01_authenticated_mutation_rpc_violations()`,
    )
    expect(policies.rows).toEqual([])
    expect(rpcs.rows).toEqual([])
  })

  it('inventories authenticated writable api tables and requires a writer/capability/owner gate', async () => {
    const tables = await migrator.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'api'
          and c.relkind = 'r'
          and (
            has_table_privilege('authenticated', c.oid, 'INSERT')
            or has_table_privilege('authenticated', c.oid, 'UPDATE')
            or has_table_privilege('authenticated', c.oid, 'DELETE')
          )
        order by 1`,
    )
    expect(tables.rows.map((row) => row.relname)).toEqual(
      expect.arrayContaining([
        'records',
        'blocks',
        'record_links',
        'datasets',
        'storage_sites',
        'report_definitions',
      ]),
    )
    expect(tables.rowCount).toBeGreaterThan(20)

    const unguarded = await migrator.query(
      `select c.relname,
              p.polname,
              case p.polcmd
                when 'a' then 'INSERT'
                when 'w' then 'UPDATE'
                when 'd' then 'DELETE'
                when '*' then 'ALL'
              end as cmd
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'api'
          and p.polcmd in ('a','w','d','*')
          and p.polroles @> array[(select oid from pg_roles where rolname = 'authenticated')]
          and not p.polroles @> array[(select oid from pg_roles where rolname = 'api_client')]
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
            || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
            !~ 'is_workspace_writer|has_capability|is_workspace_member\\([^)]+,'
        order by 1, 2`,
    )
    expect(unguarded.rows).toEqual([])
  })

  it('inventories authenticated mutation RPCs that remain membership-gated', async () => {
    const { rows } = await migrator.query<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api'
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and p.proname = 'create_record'
          and pg_get_functiondef(p.oid) like '%is_workspace_writer%'`,
    )
    expect(rows[0]?.n).toBeGreaterThan(0)
  })
})

describe('GOV-01 viewer cannot mutate; other roles are not narrowed', () => {
  it('lets member, scientist, analyst, reviewer and steward create records', async () => {
    for (const userId of [MEMBER, SCIENTIST, ANALYST, REVIEWER, STEWARD]) {
      const client = await actor(userId, WS_A)
      const created = await client.query(
        `select id from api.create_record($1::uuid, 'experiment', $2, 'draft', ARRAY[]::text[], '{}'::jsonb)`,
        [PROJECT_A, `${userId} experiment`],
      )
      expect(created.rows[0].id).toBeTruthy()
    }
  })

  it('denies viewer create_record, create_model_record, table inserts and updates', async () => {
    const member = await actor(MEMBER, WS_A)
    const created = await member.query(
      `select id from api.create_record($1::uuid, 'experiment', 'Visible to viewer', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
      [PROJECT_A],
    )
    const recordId = created.rows[0].id as string
    const viewer = await actor(VIEWER, WS_A)

    await expectDenied(
      viewer.query(
        `select id from api.create_record($1::uuid, 'experiment', 'Viewer experiment', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
        [PROJECT_A],
      ),
      '42501',
    )
    await expectDenied(
      viewer.query(
        `select id from api.create_model_record($1,'sample','Viewer sample','available',ARRAY[]::text[],'{}'::jsonb,'{}'::jsonb)`,
        [PROJECT_A],
      ),
      '42501',
    )
    await expectDenied(
      viewer.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
         values($1,$2,'experiment','GOV-V-1','direct',$3)`,
        [WS_A, PROJECT_A, VIEWER],
      ),
      '42501',
    )
    const updated = await viewer.query(
      `update api.records set title = 'viewer-mutate' where id = $1`,
      [recordId],
    )
    expect(updated.rowCount).toBe(0)
    const deleted = await viewer.query(`delete from api.records where id = $1`, [
      recordId,
    ])
    expect(deleted.rowCount).toBe(0)

    const visible = await viewer.query(
      `select id, title from api.records where id = $1`,
      [recordId],
    )
    expect(visible.rows[0].title).toBe('Visible to viewer')
  })

  it('keeps viewer SELECT while blocking Dataset and storage writes', async () => {
    const steward = await actor(STEWARD, WS_A)
    const member = await actor(MEMBER, WS_A)
    const schema = await steward.query(
      `select api.create_dataset_schema_definition($1,'gov01_ds','GOV-01 dataset',null,$2::jsonb) result`,
      [
        WS_A,
        JSON.stringify([
          {
            key: 'value',
            label: 'Value',
            logical_type: 'integer',
            nullable: true,
          },
        ]),
      ],
    )
    await steward.query(
      `select api.publish_dataset_schema_version($1)`,
      [schema.rows[0].result.schema_version_id],
    )
    const dataset = await member.query(
      `insert into api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       values($1,$2,'gov01-ds',$3) returning id`,
      [WS_A, schema.rows[0].result.schema_version_id, MEMBER],
    )
    const datasetId = dataset.rows[0].id as string
    await member.query(
      `insert into api.storage_sites(workspace_id,name,code) values($1,'gov01-site','G01')`,
      [WS_A],
    )

    const viewer = await actor(VIEWER, WS_A)
    const seen = await viewer.query(`select id from api.datasets where id = $1`, [
      datasetId,
    ])
    expect(seen.rowCount).toBe(1)
    const sites = await viewer.query(
      `select name from api.storage_sites where name = 'gov01-site'`,
    )
    expect(sites.rowCount).toBe(1)

    await expectDenied(
      viewer.query(
        `insert into api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
         values($1,$2,'viewer-ds',$3)`,
        [WS_A, schema.rows[0].result.schema_version_id, VIEWER],
      ),
      '42501',
    )
    await expectDenied(
      viewer.query(
        `insert into api.storage_sites(workspace_id,name,code) values($1,'viewer-site','V01')`,
        [WS_A],
      ),
      '42501',
    )
  })

  it('does not narrow steward schema authority or owner admin', async () => {
    const steward = await actor(STEWARD, WS_A)
    const created = await steward.query(
      `select api.create_dataset_schema_definition($1,'gov01_result','GOV-01 result',null,$2::jsonb) result`,
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
    expect(created.rows[0].result.schema_definition_id).toBeTruthy()
    const configuration = JSON.stringify(validSheetDefinitionConfiguration())
    const definition = await steward.query(
      `select api.create_sheet_definition($1,'gov01_sheet','GOV-01 sheet','',$2::jsonb) result`,
      [WS_A, configuration],
    )
    expect(definition.rows[0].result.definition.id).toBeTruthy()
    await expectDenied(
      steward.query(
        `select api.create_invitation($1,'gov01-x@test.invalid','member',7)`,
        [WS_A],
      ),
      'SB061',
    )

    const owner = await actor(OWNER, WS_A)
    const invited = await owner.query(
      `select api.create_invitation($1,'gov01-invite@test.invalid','viewer',7) result`,
      [WS_A],
    )
    expect(invited.rows[0].result).toBeTruthy()

    const admin = await actor(ADMIN, WS_A)
    const field = await admin.query(
      `select id from api.create_model_field($1,'sample','gov01_note','Note','text',true,null,'{}'::jsonb)`,
      [WS_A],
    )
    expect(field.rows[0].id).toBeTruthy()
  })

  it('keeps workspace isolation for viewer reads and writes', async () => {
    const other = await actor(OTHER_OWNER, WS_B)
    const foreign = await other.query(
      `select id from api.create_record($1::uuid, 'experiment', 'Foreign', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
      [PROJECT_B],
    )
    const viewer = await actor(VIEWER, WS_A)
    const leaked = await viewer.query(`select id from api.records where id = $1`, [
      foreign.rows[0].id,
    ])
    expect(leaked.rowCount).toBe(0)
    await expectDenied(
      viewer.query(
        `select id from api.create_record($1::uuid, 'experiment', 'Cross', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
        [PROJECT_B],
      ),
      '42501',
    )
  })

  it('leaves api_client write policies independent of viewer', async () => {
    const rewritten = await migrator.query(
      `select c.relname, p.polname
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'api'
          and p.polroles @> array[(select oid from pg_roles where rolname = 'api_client')]
          and (
            coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%is_workspace_writer%'
            or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_workspace_writer%'
            or coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%has_capability%'
            or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%has_capability%'
          )`,
    )
    expect(rewritten.rows).toEqual([])

    const apiClient = await actor(OWNER, WS_A, 'api_client')
    const inserted = await apiClient.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,'experiment','GOV-API-1','api client',$3)
       returning identifier`,
      [WS_A, PROJECT_A, OWNER],
    )
    expect(inserted.rows[0].identifier).toBe('GOV-API-1')
  })
})
