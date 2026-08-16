import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c059'
const OWNER = 'core-05-role-owner'
const ADMIN = 'core-05-role-admin'
const STEWARD = 'core-05-role-steward'
const SCIENTIST = 'core-05-role-scientist'

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
      ('${OWNER}','Owner','role-owner@test.invalid',true),
      ('${ADMIN}','Admin','role-admin@test.invalid',true),
      ('${STEWARD}','Steward','role-steward@test.invalid',true),
      ('${SCIENTIST}','Scientist','role-scientist@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','core-05-roles','CORE-05 roles');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${ADMIN}','admin'),
      ('${WS}','${STEWARD}','steward'),
      ('${WS}','${SCIENTIST}','scientist')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-05.11 role-specific configuration proof', () => {
  it('proves scientist, steward and admin against the same Dataset Schema', async () => {
    const steward = await actor(STEWARD)
    const scientist = await actor(SCIENTIST)
    const admin = await actor(ADMIN)
    const owner = await actor(OWNER)
    const created = (
      await steward.query(
        `select api.create_dataset_schema_definition($1,'role_schema','Role schema',null,'[]'::jsonb) result`,
        [WS],
      )
    ).rows[0].result
    await expectDenied(
      scientist.query(`select api.publish_dataset_schema_version($1)`, [
        created.schema_version_id,
      ]),
      '42501',
    )
    const published = (
      await steward.query(
        `select lifecycle from api.publish_dataset_schema_version($1)`,
        [created.schema_version_id],
      )
    ).rows[0]
    expect(published.lifecycle).toBe('active')
    await expectDenied(
      scientist.query(
        `select api.apply_dataset_schema_evolution($1,'[]'::jsonb,'sci-evo')`,
        [created.schema_version_id],
      ),
      '42501',
    )
    const next = (
      await admin.query(
        `select api.create_next_dataset_schema_version($1) result`,
        [created.schema_definition_id],
      )
    ).rows[0].result
    await admin.query(`select api.publish_dataset_schema_version($1)`, [
      next.schema_version_id,
    ])
    const ownerCaps = (
      await owner.query(
        `select api.has_capability($1,'workspace.admin') admin,
                api.has_capability($1,'schema.publish') publish`,
        [WS],
      )
    ).rows[0]
    const stewardCaps = (
      await steward.query(
        `select api.has_capability($1,'workspace.admin') admin,
                api.has_capability($1,'schema.publish') publish`,
        [WS],
      )
    ).rows[0]
    expect(ownerCaps).toEqual({ admin: true, publish: true })
    expect(stewardCaps).toEqual({ admin: false, publish: true })
    await expectDenied(
      steward.query(
        `select api.create_invitation($1,'x@test.invalid','member',7)`,
        [WS],
      ),
      'SB061',
    )
    const local = (
      await scientist.query(
        `select to_jsonb(api.create_sheet_instance($1,'Local work',null,null,null,null,$2::jsonb)) result`,
        [
          WS,
          JSON.stringify({
            bindings: [],
            localFields: [],
            localValues: {},
            instanceCalculations: [],
            calculationOverrides: {},
            presentation: {
              columnOrder: [],
              hiddenColumnIds: [],
              columnWidths: {},
              frozenColumnCount: 0,
              density: 'standard',
            },
            provenance: { createdFrom: 'ad_hoc' },
          }),
        ],
      )
    ).rows[0].result
    expect(local.id).toBeTruthy()
  })
})
