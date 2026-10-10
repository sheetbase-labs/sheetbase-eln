/**
 * LAB-04.2 — a usage record link cannot point at a held or expired lot.
 *
 * The materials block refuses a quarantined or expired lot; this covers the other
 * way an experiment cites a material, the `link_type = 'reagent'` link the registry
 * reads as "Used in". Other link types stay open, because linking a report or a
 * file to a held lot is legitimate.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-000000030000'
const PROJECT = '00000000-0000-4000-8000-000000030001'
const EXPERIMENT = '00000000-0000-4000-8000-000000030002'
const MATERIAL = '00000000-0000-4000-8000-000000030003'
const USER = 'lab042-link'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [USER, `${USER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab042l','LAB-04.2')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'L42L','Materials',$3)`,
    [PROJECT, WS, USER],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: USER,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-L042','Uses a lot','in_progress',$4),
            ($5,$2,$3,'reagent','MAT-L042','Filter train C','available',$4)`,
    [EXPERIMENT, WS, PROJECT, USER, MATERIAL],
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

function link(client: Client, linkType: string) {
  return client.query(`select api.create_record_link($1,$2,$3,$4,$5)`, [
    EXPERIMENT,
    'reagent',
    'MAT-L042',
    linkType,
    MATERIAL,
  ])
}

describe('LAB-04.2 usage link to a held or expired lot', () => {
  it('accepts an available lot and refuses a quarantined one', async () => {
    const client = await actor(USER)
    await expect(link(client, 'reagent')).resolves.toBeDefined()

    await migrator.query(
      `update api.records set status='quarantined' where id=$1`,
      [MATERIAL],
    )
    await expectDenied(link(client, 'reagent'), 'SB120')

    // Released again: the same link already exists, so the refusal is what matters.
    await migrator.query(
      `update api.records set status='available' where id=$1`,
      [MATERIAL],
    )
  })

  it('refuses an expired lot', async () => {
    const client = await actor(USER)
    await migrator.query(
      `update api.records set status='expired' where id=$1`,
      [MATERIAL],
    )
    await expectDenied(link(client, 'reagent'), 'SB124')

    await migrator.query(
      `update api.records set status='available' where id=$1`,
      [MATERIAL],
    )
  })

  it('leaves other link types open', async () => {
    const client = await actor(USER)
    await migrator.query(
      `update api.records set status='quarantined' where id=$1`,
      [MATERIAL],
    )
    // Linking a report to a held lot is legitimate.
    await expect(link(client, 'general')).resolves.toBeDefined()
    await migrator.query(
      `update api.records set status='available' where id=$1`,
      [MATERIAL],
    )
  })
})
