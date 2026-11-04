/**
 * Chemical safety on materials (migration 0062): hazards and a safety data sheet are
 * saved once for every lot of a material, a replacement lot inherits them, only
 * writers may change them, and bad codes are refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-0000000062a0'
const PROJ = '00000000-0000-4000-8000-0000000062a1'
const BUYER = 'cs-buyer'
const ASKER = 'cs-asker'
const VIEWER = 'cs-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function material(client: Client, title: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT id FROM api.create_record($1::uuid,'material',$2,'available',ARRAY[]::text[],$3::jsonb)`,
    [
      PROJ,
      title,
      JSON.stringify({
        supplier: 'Sigma',
        catalog_no: 'T9285',
        lot: 'L-OLD',
        expiry: '2027-01-01',
        quantity: 2,
        unit: 'mL',
        low_stock_threshold: 5,
      }),
    ],
  )
  return rows[0].id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [BUYER, ASKER, VIEWER]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'cs','Safety')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'member'),($1,$4,'viewer')`,
    [WS, BUYER, ASKER, VIEWER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'cs','Safety',$3)`,
    [PROJ, WS, BUYER],
  )
  for (const userId of [BUYER, ASKER, VIEWER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJ,
      userId,
      canEdit: userId !== VIEWER,
    })
  }
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('material safety', () => {
  it('saves hazards on every lot of the material and a replacement inherits them', async () => {
    const buyer = await actor(BUYER)
    const a = await material(buyer, 'Ethanol')
    const b = await material(buyer, 'Ethanol')
    const other = await material(buyer, 'Water')

    const saved = await buyer.query(
      `SELECT api.set_material_safety($1, ARRAY['GHS02','GHS07','GHS02'], 'Danger', ARRAY['H225','H319'], true) AS n`,
      [a],
    )
    expect(saved.rows[0].n).toBe(2)
    const rows = await buyer.query(
      `SELECT record_id, pictograms, signal_word, hazard_statements FROM api.material_safety ORDER BY record_id`,
    )
    expect(rows.rows.map((r) => r.record_id).sort()).toEqual([a, b].sort())
    expect(rows.rows[0].pictograms).toEqual(['GHS02', 'GHS07'])
    expect(rows.rows[0].signal_word).toBe('danger')
    expect(rows.rows[0].hazard_statements).toEqual(['H225', 'H319'])
    expect(rows.rows.find((r) => r.record_id === other)).toBeUndefined()

    // Only this lot when asked.
    const one = await buyer.query(
      `SELECT api.set_material_safety($1, ARRAY['GHS05'], 'warning', ARRAY[]::text[], false) AS n`,
      [b],
    )
    expect(one.rows[0].n).toBe(1)
    const aAfter = await buyer.query(
      `SELECT pictograms FROM api.material_safety WHERE record_id = $1`,
      [a],
    )
    expect(aAfter.rows[0].pictograms).toEqual(['GHS02', 'GHS07'])

    // A safety data sheet is a file object of the workspace; none is also fine.
    await expectDenied(
      buyer.query(`SELECT api.set_material_sds($1, gen_random_uuid(), true)`, [
        a,
      ]),
      'SB036',
    )
    await buyer.query(`SELECT api.set_material_sds($1, NULL, false)`, [a])

    // The replacement lot is the same chemical.
    const replacement = await buyer.query(
      `SELECT api.register_replacement_lot($1, 'L-NEW', '2028-01-01', 5) AS r`,
      [a],
    )
    const newId = replacement.rows[0].r.id
    const inherited = await buyer.query(
      `SELECT pictograms, signal_word FROM api.material_safety WHERE record_id = $1`,
      [newId],
    )
    expect(inherited.rows[0]).toEqual({
      pictograms: ['GHS02', 'GHS07'],
      signal_word: 'danger',
    })
  })

  it('refuses unknown codes and people who cannot write', async () => {
    const buyer = await actor(BUYER)
    const viewer = await actor(VIEWER)
    const lot = await material(buyer, 'Acetone')
    await expect(
      buyer.query(
        `SELECT api.set_material_safety($1, ARRAY['GHS99'], null, ARRAY[]::text[], false)`,
        [lot],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      buyer.query(
        `SELECT api.set_material_safety($1, ARRAY[]::text[], 'caution', ARRAY[]::text[], false)`,
        [lot],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      buyer.query(
        `SELECT api.set_material_safety($1, ARRAY[]::text[], null, ARRAY['not a code'], false)`,
        [lot],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expectDenied(
      viewer.query(
        `SELECT api.set_material_safety($1, ARRAY['GHS02'], null, ARRAY[]::text[], false)`,
        [lot],
      ),
      '42501',
    )
  })
})
