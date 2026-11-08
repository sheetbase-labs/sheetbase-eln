/**
 * Lots of a registry entry: a registry names the model its lots are made from,
 * and a lot is a record of that model linked to the entry. Core knows nothing
 * about what the registry holds. Runs against a freshly migrated database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c701'
const PROJECT = '00000000-0000-4000-8000-00000000c711'
const OWNER = 'lot-owner'
const VIEWER = 'lot-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','lot-owner@test.invalid',true),
      ('${VIEWER}','Viewer','lot-viewer@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','lots','Lots');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJECT}','${WS}','lots','Lots','${OWNER}')`)
  owner = await actor(OWNER)
  viewer = await actor(VIEWER)
  await owner.query(
    `select api.create_starter_model('batch','Batch','LOT',null,$1::jsonb,false)`,
    [JSON.stringify([{ field_name: 'lot_number', label: 'Lot number' }])],
  )
  await owner.query(
    `select api.create_registry_model('reagent','Reagent','RGT',null,$1::jsonb,'{}',null)`,
    [JSON.stringify([{ field_name: 'name', label: 'Name' }])],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function entry(title: string): Promise<string> {
  const { rows } = await owner.query(
    `select id from api.create_registry_entry($1,'reagent',$2,'{}'::jsonb,true)`,
    [PROJECT, title],
  )
  return rows[0].id as string
}

describe('choosing the lot model', () => {
  it('needs a registry, another model that exists, and schema rights', async () => {
    await expect(
      owner.query(`select api.set_registry_lot_kind('batch','reagent')`),
    ).rejects.toThrow(/registry first/)
    await expect(
      owner.query(`select api.set_registry_lot_kind('reagent','reagent')`),
    ).rejects.toThrow(/another model/)
    await expect(
      owner.query(`select api.set_registry_lot_kind('reagent','nope')`),
    ).rejects.toThrow(/another model/)
    await expectDenied(
      viewer.query(`select api.set_registry_lot_kind('reagent','batch')`),
      '42501',
    )
  })

  it('keeps the choice and clears it', async () => {
    const set = await owner.query(
      `select * from api.set_registry_lot_kind('reagent','batch')`,
    )
    expect(set.rows[0].registry_lot_kind).toBe('batch')
    const cleared = await owner.query(
      `select * from api.set_registry_lot_kind('reagent')`,
    )
    expect(cleared.rows[0].registry_lot_kind).toBeNull()
    await owner.query(`select api.set_registry_lot_kind('reagent','batch')`)
  })
})

describe('lots', () => {
  it('adds a lot to an entry and lists it, in the entry’s project', async () => {
    const id = await entry('Sodium chloride')
    const { rows } = await owner.query(
      `select * from api.add_compound_lot($1,null,'Batch 1','{"lot_number":"B-001"}'::jsonb)`,
      [id],
    )
    expect(rows[0].identifier).toBe('LOT-0001')
    expect(rows[0].project_id).toBe(PROJECT)
    await owner.query(`select api.add_compound_lot($1,null,null)`, [id])
    const lots = await owner.query(`select * from api.list_compound_lots($1)`, [
      id,
    ])
    expect(lots.rows.map((l) => l.title)).toEqual([
      'Batch 1',
      `${(await owner.query(`select identifier from api.records where id=$1`, [id])).rows[0].identifier} lot`,
    ])
    expect(lots.rows[0].custom_fields).toEqual({ lot_number: 'B-001' })
  })

  it('needs a lot model and the right to write', async () => {
    const id = await entry('Potassium chloride')
    await expect(
      viewer.query(`select api.add_compound_lot($1,null,'Nope')`, [id]),
    ).rejects.toThrow()
    await owner.query(`select api.set_registry_lot_kind('reagent')`)
    await expect(
      owner.query(`select api.add_compound_lot($1,null,'Nope')`, [id]),
    ).rejects.toThrow(/no lot model/)
  })
})
