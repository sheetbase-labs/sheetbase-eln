import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c054'
const PROJECT = '00000000-0000-4000-8000-00000000c154'
const OWNER = 'core-05-dep-owner'
const STEWARD = 'core-05-dep-steward'
const MEMBER = 'core-05-dep-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','dep-owner@test.invalid',true),
      ('${STEWARD}','Steward','dep-steward@test.invalid',true),
      ('${MEMBER}','Member','dep-member@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','core-05-dep','CORE-05 deps');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${STEWARD}','steward'),
      ('${WS}','${MEMBER}','member');
    insert into api.projects(id,workspace_id,key,title)
      values('${PROJECT}','${WS}','dep','Deps')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-05 dependency discovery and lifecycle', () => {
  it('discovers Dataset and Definition consumers by stable schema/field IDs', async () => {
    const steward = await actor(STEWARD)
    const created = (
      await steward.query(
        `select api.create_dataset_schema_definition($1,'dep_result','Dep result',null,$2::jsonb) result`,
        [
          WS,
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
    ).rows[0].result
    await steward.query(`select api.publish_dataset_schema_version($1)`, [
      created.schema_version_id,
    ])
    const fieldId = (
      await steward.query(
        `select field_id from api.dataset_schema_version_fields where schema_version_id=$1`,
        [created.schema_version_id],
      )
    ).rows[0].field_id as string
    const dataset = (
      await steward.query(
        `insert into api.datasets(workspace_id,schema_version_id,name)
         values($1,$2,'Bound dataset') returning id,revision`,
        [WS, created.schema_version_id],
      )
    ).rows[0]
    const configuration = validSheetDefinitionConfiguration() as {
      parameters: Array<{ type: { contract: { schemaVersionId?: string } } }>
    }
    configuration.parameters[0].type.contract.schemaVersionId =
      created.schema_version_id
    await steward.query(
      `select api.create_sheet_definition($1,'dep_sheet','Dep sheet','',$2::jsonb)`,
      [WS, JSON.stringify(configuration)],
    )

    const schemaDeps = (
      await steward.query(
        `select api.discover_object_dependencies('dataset_schema_version',$1) result`,
        [created.schema_version_id],
      )
    ).rows[0].result
    expect(schemaDeps.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dataset',
          id: dataset.id,
          liveness: 'active',
          effect: 'blocks_deletion',
        }),
        expect.objectContaining({
          kind: 'sheet_definition_version',
          relation: 'configuration_schema_version',
          effect: 'requires_migration',
        }),
      ]),
    )

    const fieldDeps = (
      await steward.query(
        `select api.discover_object_dependencies('dataset_schema_field',$1) result`,
        [fieldId],
      )
    ).rows[0].result
    expect(fieldDeps.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dataset_schema_version',
          id: created.schema_version_id,
        }),
      ]),
    )

    const preview = (
      await steward.query(
        `select api.preview_hard_delete('dataset_schema_version',$1) result`,
        [created.schema_version_id],
      )
    ).rows[0].result
    expect(preview.allowed).toBe(false)
    await expectDenied(
      steward.query(
        `select api.execute_hard_delete('dataset_schema_version',$1)`,
        [created.schema_version_id],
      ),
      'SB072',
    )

    const archived = (
      await steward.query(
        `select lifecycle,revision from api.archive_dataset($1,$2)`,
        [dataset.id, dataset.revision],
      )
    ).rows[0]
    expect(archived.lifecycle).toBe('archived')
    const restored = (
      await steward.query(
        `select lifecycle from api.restore_dataset($1,$2)`,
        [dataset.id, archived.revision],
      )
    ).rows[0]
    expect(restored.lifecycle).toBe('active')
  })

  it('restores retired schema definitions and blocks member hard-delete', async () => {
    const steward = await actor(STEWARD)
    const member = await actor(MEMBER)
    const created = (
      await steward.query(
        `select api.create_dataset_schema_definition($1,'retire_me','Retire me',null,'[]'::jsonb) result`,
        [WS],
      )
    ).rows[0].result
    await steward.query(
      `select api.retire_dataset_schema_definition($1)`,
      [created.schema_definition_id],
    )
    const restored = (
      await steward.query(
        `select lifecycle from api.restore_dataset_schema_definition($1)`,
        [created.schema_definition_id],
      )
    ).rows[0]
    expect(restored.lifecycle).toBe('draft')
    await expectDenied(
      member.query(
        `select api.execute_hard_delete('dataset_schema_definition',$1)`,
        [created.schema_definition_id],
      ),
      '42501',
    )
    const deleted = (
      await steward.query(
        `select api.execute_hard_delete('dataset_schema_definition',$1) result`,
        [created.schema_definition_id],
      )
    ).rows[0].result
    expect(deleted.ok).toBe(true)
  })
})
