/**
 * LAB-04.2 — register a replacement lot.
 *
 * A replacement is a sibling lot for the same material: it inherits the supplier,
 * catalogue number and storage, takes a new lot number, expiry and quantity, and is
 * linked to the lot it replaces so the inspector can state whether one exists.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-000000020000'
const PROJECT = '00000000-0000-4000-8000-000000020001'
const MATERIAL = '00000000-0000-4000-8000-000000020002'
const AUTHOR = 'lab042-author'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [AUTHOR, `${AUTHOR}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab042','LAB-04.2')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'L42','Materials',$3)`,
    [PROJECT, WS, AUTHOR],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,properties,created_by_user_id)
     values($1,$2,$3,'material','MAT-9001','Filter train C','available',
            '{"supplier":"Sartorius","catalog_no":"DF-C0SP-01","lot":"L-77310",
              "expiry":"2026-10-01","quantity":2,"unit":"units",
              "storage":"Consumables store, bay 4"}'::jsonb,$4)`,
    [MATERIAL, WS, PROJECT, AUTHOR],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

describe('LAB-04.2 register replacement lot', () => {
  it('creates a sibling lot inheriting the material identity and links it', async () => {
    const author = await actor(AUTHOR)
    const { rows } = await author.query<{
      result: { id: string; identifier: string }
    }>(
      `select api.register_replacement_lot($1,'L-90112','2027-09-30',6,'units','Second filter train') as result`,
      [MATERIAL],
    )
    const replacement = rows[0]!.result
    expect(replacement.identifier).toMatch(/^MAT-/)

    const stored = await migrator.query<{
      properties: Record<string, unknown>
    }>('select properties from api.records where id=$1', [replacement.id])
    expect(stored.rows[0]!.properties).toMatchObject({
      supplier: 'Sartorius',
      catalog_no: 'DF-C0SP-01',
      lot: 'L-90112',
      expiry: '2027-09-30',
      quantity: 6,
      unit: 'units',
      storage: 'Consumables store, bay 4',
    })

    const links = await migrator.query<{
      link_metadata: Record<string, unknown>
    }>(
      `select link_metadata from api.record_links
        where source_record_id=$1 and target_record_id=$2 and link_type='material'`,
      [MATERIAL, replacement.id],
    )
    expect(links.rows).toHaveLength(1)
    expect(links.rows[0]!.link_metadata).toMatchObject({
      relation: 'replacement',
      reason: 'Second filter train',
    })
  })

  it('refuses a replacement that reuses the lot number', async () => {
    const author = await actor(AUTHOR)
    await expectDenied(
      author.query(
        `select api.register_replacement_lot($1,'L-77310','2027-01-01',4)`,
        [MATERIAL],
      ),
      '22023',
    )
  })

  it('refuses a missing expiry or a non-positive quantity', async () => {
    const author = await actor(AUTHOR)
    await expectDenied(
      author.query(`select api.register_replacement_lot($1,'L-1',null,4)`, [
        MATERIAL,
      ]),
      '22023',
    )
    await expectDenied(
      author.query(
        `select api.register_replacement_lot($1,'L-2','2027-01-01',0)`,
        [MATERIAL],
      ),
      '22023',
    )
  })

  it('refuses a caller who cannot edit the material', async () => {
    const outsider = 'lab042-outsider'
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [outsider, `${outsider}@test.invalid`],
    )
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('set role authenticated')
    await setActorJwt(client, outsider, WS)
    await expectDenied(
      client.query(
        `select api.register_replacement_lot($1,'L-3','2027-01-01',4)`,
        [MATERIAL],
      ),
      '42501',
    )
  })
})
