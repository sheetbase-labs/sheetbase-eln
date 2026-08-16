import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c105'
const OWNER = 'core-h5-owner'
const PROJECT = '00000000-0000-4000-8000-00000000c151'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','h5-owner@test.invalid',true)`,
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ('${WS}','core-h5','CORE H5')`,
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner')`,
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values
      ('${PROJECT}','${WS}','H5','H5')`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('H5 notebook template records are removed from the product', () => {
  it('no role can create or instantiate notebook_template records', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_record($1::uuid,'notebook_template','Blocked','draft',ARRAY[]::text[],'{}'::jsonb)`,
        [PROJECT],
      ),
      '42501',
    )
    await setActorJwt(migrator, OWNER, WS)
    await expectDenied(
      migrator.query(
        `SELECT * FROM api.create_record($1::uuid,'notebook_template','Legacy','draft',ARRAY[]::text[],'{}'::jsonb)`,
        [PROJECT],
      ),
      '42501',
    )
  })

  it('authenticated can still create protocol templates', async () => {
    const owner = await actor(OWNER)
    const protocol = await owner.query(
      `SELECT * FROM api.create_record($1::uuid,'protocol_template','Titration','draft',ARRAY[]::text[],'{"version":"1.0"}'::jsonb)`,
      [PROJECT],
    )
    expect(protocol.rows[0].kind).toBe('protocol_template')
    expect(protocol.rows[0].identifier).toMatch(/^PRT-/)
  })

  it('canonical CORE-06 create_notebook_template remains available', async () => {
    const owner = await actor(OWNER)
    const created = await owner.query(
      `select api.create_notebook_template($1,'h5_canonical','H5 canonical',null,$2::jsonb) result`,
      [
        WS,
        JSON.stringify({
          formatVersion: 1,
          parameters: [],
          placements: [
            {
              id: '00000000-0000-4000-8000-00000000c160',
              kind: 'narrative',
              order: 1,
              blockType: 'rich_text',
              payload: {
                doc: { type: 'doc', content: [{ type: 'paragraph' }] },
              },
            },
          ],
        }),
      ],
    )
    expect(created.rows[0].result.template.key).toBe('h5_canonical')
  })
})
