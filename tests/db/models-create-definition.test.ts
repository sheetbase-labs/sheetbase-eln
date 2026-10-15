import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000d055'
const OWNER = 'qa4-models-owner'
const MEMBER = 'qa4-models-member'

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
      ('${OWNER}','Owner','qa4-models-owner@test.invalid',true),
      ('${MEMBER}','Member','qa4-models-member@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','qa4-models-create','QA4 models create');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${MEMBER}','member')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

/**
 * The board's create flow goes through `api.create_dataset_schema_definition`.
 * A unit test proves the dialog and the route wire that call; this proves the
 * definition actually exists afterwards, and that the two refusals the UI is
 * built around are the server's real ones.
 */
describe('QA4 · creating a model from the board', () => {
  it('stores the definition, its draft v1 and its fields', async () => {
    const owner = await actor(OWNER)
    const created = (
      await owner.query(
        `select api.create_dataset_schema_definition(
           $1,'cell_bank_reading','Cell bank reading','Viability at thaw.',$2::jsonb
         ) result`,
        [
          WS,
          JSON.stringify([
            {
              key: 'viability',
              label: 'Viability',
              logical_type: 'decimal',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(created.schema_definition_id).toBeTruthy()
    expect(created.schema_version_id).toBeTruthy()

    const { rows } = await owner.query(
      `select d.key, d.name, d.description, d.lifecycle, d.created_by_user_id,
              v.version, v.lifecycle as version_lifecycle,
              f.key as field_key, f.label
         from api.dataset_schema_definitions d
         join api.dataset_schema_versions v on v.schema_id = d.id
         join api.dataset_schema_version_fields f on f.schema_version_id = v.id
        where d.id = $1`,
      [created.schema_definition_id],
    )
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'cell_bank_reading',
        name: 'Cell bank reading',
        description: 'Viability at thaw.',
        lifecycle: 'draft',
        created_by_user_id: OWNER,
        version: 1,
        version_lifecycle: 'draft',
        field_key: 'viability',
        label: 'Viability',
      }),
    ])
  })

  it('refuses a role without schema.edit, which is why the board hides the control', async () => {
    const member = await actor(MEMBER)
    await expectDenied(
      member.query(
        `select api.create_dataset_schema_definition($1,'member_model','Member model',null,'[]'::jsonb)`,
        [WS],
      ),
      '42501',
    )
  })

  it('refuses metadata outside the contract (SB071), which the dialog validates', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        `select api.create_dataset_schema_definition($1,'Bad Key','Bad key',null,'[]'::jsonb)`,
        [WS],
      ),
      'SB071',
    )
  })
})
