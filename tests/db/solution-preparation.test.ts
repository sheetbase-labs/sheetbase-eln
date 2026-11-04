/**
 * Making a solution from lots (migration 0064).
 *
 * Proves: preparing a solution draws each ingredient lot down through its ledger and
 * registers a new lot linked to them; the new lot's expiry defaults to the earliest
 * ingredient expiry and can be set shorter; a lot that is expired, quarantined, short
 * of stock or listed twice stops the whole preparation with nothing drawn down; a
 * viewer cannot prepare; the ingredients stay readable after the preparation.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-0000000064a0'
const PROJ = '00000000-0000-4000-8000-0000000064a1'
const MEMBER = 'sp-member'
const VIEWER = 'sp-viewer'

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

async function lot(
  client: Client,
  title: string,
  props: Record<string, unknown>,
): Promise<string> {
  const { rows } = await client.query(
    `SELECT id FROM api.create_record($1::uuid,'material',$2,'available',ARRAY[]::text[],$3::jsonb)`,
    [PROJ, title, JSON.stringify({ unit: 'g', ...props })],
  )
  return rows[0].id
}

async function stock(
  id: string,
): Promise<{ quantity: number; status: string }> {
  const { rows } = await migrator.query(
    `SELECT (properties->>'quantity')::numeric AS quantity, status FROM api.records WHERE id=$1`,
    [id],
  )
  return { quantity: Number(rows[0].quantity), status: rows[0].status }
}

function prepare(
  client: Client,
  ingredients: Array<{ recordId: string; quantity: number }>,
  options: { expiry?: string | null; lot?: string; quantity?: number } = {},
) {
  return client.query(
    `SELECT api.prepare_solution($1::uuid,'10x PBS',$2,$3,'mL',$4::jsonb,$5::date,'4 °C','Autoclaved') AS result`,
    [
      PROJ,
      options.lot ?? 'PBS-001',
      options.quantity ?? 500,
      JSON.stringify(ingredients),
      options.expiry ?? null,
    ],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [MEMBER, VIEWER]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'sp','Solutions')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'member'),($1,$3,'viewer')`,
    [WS, MEMBER, VIEWER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'sp','Solutions',$3)`,
    [PROJ, WS, MEMBER],
  )
  for (const userId of [MEMBER, VIEWER]) {
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

describe('making a solution from lots', () => {
  it('draws the ingredients down and links the new lot to them', async () => {
    const member = await actor(MEMBER)
    const nacl = await lot(member, 'Sodium chloride', {
      lot: 'NC-1',
      expiry: '2099-06-30',
      quantity: 500,
    })
    const water = await lot(member, 'Water', {
      lot: 'W-1',
      expiry: '2099-03-01',
      quantity: 1000,
    })

    const { rows } = await prepare(member, [
      { recordId: nacl, quantity: 80 },
      { recordId: water, quantity: 20 },
    ])
    const made = rows[0].result
    // Earliest ingredient expiry becomes the default.
    expect(made.expiry).toBe('2099-03-01')
    expect(made.lot).toBe('PBS-001')

    expect(await stock(nacl)).toEqual({ quantity: 420, status: 'available' })
    expect(await stock(water)).toEqual({ quantity: 980, status: 'available' })

    // The ingredient ledgers say why.
    const ledger = await migrator.query(
      `SELECT operation, quantity_delta, reason FROM api.reagent_movements WHERE reagent_record_id=$1`,
      [nacl],
    )
    expect(ledger.rows).toEqual([
      expect.objectContaining({
        operation: 'consume',
        reason: `Used to prepare ${made.identifier} · Autoclaved`,
      }),
    ])
    expect(Number(ledger.rows[0].quantity_delta)).toBe(-80)

    // The new lot is a material in its own right, with its own opening balance.
    const product = await migrator.query(
      `SELECT kind, status, tags, properties, custom_fields FROM api.records WHERE id=$1`,
      [made.id],
    )
    expect(product.rows[0]).toMatchObject({
      kind: 'material',
      status: 'available',
      tags: ['Solution'],
      properties: {
        lot: 'PBS-001',
        quantity: 500,
        unit: 'mL',
        storage: '4 °C',
        expiry: '2099-03-01',
      },
    })
    expect(product.rows[0].custom_fields).toEqual({})

    // It reads back from both ends, as the member would see it.
    const madeFrom = await member.query(
      `SELECT ingredient_identifier, ingredient_lot, quantity, unit
         FROM api.material_ingredients WHERE product_record_id=$1 ORDER BY position`,
      [made.id],
    )
    expect(madeFrom.rows.map((r) => r.ingredient_lot)).toEqual(['NC-1', 'W-1'])
    const usedIn = await member.query(
      `SELECT product_record_id FROM api.material_ingredients WHERE ingredient_record_id=$1`,
      [water],
    )
    expect(usedIn.rows).toEqual([{ product_record_id: made.id }])
  })

  it('lets the solution carry a shorter shelf life, and consumes a lot that runs out', async () => {
    const member = await actor(MEMBER)
    const salt = await lot(member, 'Potassium chloride', {
      lot: 'KC-1',
      expiry: '2099-12-31',
      quantity: 10,
    })
    const { rows } = await prepare(member, [{ recordId: salt, quantity: 10 }], {
      expiry: '2099-01-15',
      lot: 'KCL-1',
    })
    expect(rows[0].result.expiry).toBe('2099-01-15')
    expect(await stock(salt)).toEqual({ quantity: 0, status: 'consumed' })
  })

  it('gives a solution of long-life ingredients no expiry unless one is set', async () => {
    const member = await actor(MEMBER)
    const water = await lot(member, 'Milli-Q water', {
      lot: 'MQ-1',
      quantity: 100,
    })
    const { rows } = await prepare(member, [{ recordId: water, quantity: 5 }], {
      lot: 'MQ-SOL',
    })
    expect(rows[0].result.expiry).toBeNull()
  })

  it('refuses the whole preparation if any ingredient is unusable, drawing nothing down', async () => {
    const member = await actor(MEMBER)
    const good = await lot(member, 'Glycine', {
      lot: 'G-1',
      expiry: '2099-01-01',
      quantity: 50,
    })
    const old = await lot(member, 'Old EDTA', {
      lot: 'E-OLD',
      expiry: '2020-01-01',
      quantity: 50,
    })
    const held = await lot(member, 'Held SDS', {
      lot: 'S-1',
      expiry: '2099-01-01',
      quantity: 50,
    })
    await member.query(
      `SELECT api.record_reagent_movement($1,'quarantine',(SELECT metadata_version FROM api.records WHERE id=$1),0,'held')`,
      [held],
    )
    const short = await lot(member, 'Short Tris', {
      lot: 'T-1',
      expiry: '2099-01-01',
      quantity: 3,
    })

    await expectDenied(
      prepare(member, [
        { recordId: good, quantity: 5 },
        { recordId: old, quantity: 1 },
      ]),
      /expired on 2020-01-01/,
    )
    await expectDenied(
      prepare(member, [
        { recordId: good, quantity: 5 },
        { recordId: held, quantity: 1 },
      ]),
      /quarantined/,
    )
    await expectDenied(
      prepare(member, [
        { recordId: good, quantity: 5 },
        { recordId: short, quantity: 4 },
      ]),
      /only 3/,
    )
    await expectDenied(
      prepare(member, [
        { recordId: good, quantity: 5 },
        { recordId: good, quantity: 5 },
      ]),
      /listed once/,
    )
    await expectDenied(prepare(member, []), /at least one ingredient/)
    expect(await stock(good)).toEqual({ quantity: 50, status: 'available' })
    expect(await stock(short)).toEqual({ quantity: 3, status: 'available' })
    const noProduct = await migrator.query(
      `SELECT count(*)::int AS n FROM api.records WHERE title='10x PBS' AND properties->>'lot' = 'PBS-001' AND workspace_id=$1`,
      [WS],
    )
    // Only the first test's solution exists.
    expect(noProduct.rows[0].n).toBe(1)
  })

  it('does not let a viewer prepare a solution', async () => {
    const member = await actor(MEMBER)
    const viewer = await actor(VIEWER)
    const base = await lot(member, 'Viewer-test base', {
      lot: 'V-1',
      quantity: 10,
    })
    await expectDenied(
      prepare(viewer, [{ recordId: base, quantity: 1 }], { lot: 'V-SOL' }),
      /not permitted|cannot write/,
    )
    expect(await stock(base)).toEqual({ quantity: 10, status: 'available' })
  })
})
