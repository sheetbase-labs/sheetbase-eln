/**
 * Reagent ordering (migration 0058): request a reorder from a material, place
 * it, receive it as a new lot, or cancel it.
 *
 * Proves: the steps run in order and refuse out-of-order moves; a request tells
 * the people who place orders and a placed or received order tells the person
 * who asked (never the person acting); receiving registers a linked sibling lot;
 * only one reorder stays open per material; ordinary members cannot place an
 * order; the Inbox shows open requests to buyers and orders on their way to the
 * person who asked; every step is written to the material's history.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-0000000058a0'
const PROJ = '00000000-0000-4000-8000-0000000058a1'
const BUYER = 'ro-buyer'
const ASKER = 'ro-asker'
const VIEWER = 'ro-viewer'

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
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'ro','Reorders')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'member'),($1,$4,'viewer')`,
    [WS, BUYER, ASKER, VIEWER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'ro','Reorders',$3)`,
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

describe('reagent orders', () => {
  it('runs request, order and receive, telling the right people', async () => {
    const asker = await actor(ASKER)
    const buyer = await actor(BUYER)
    const lot = await material(asker, 'Tris buffer')

    const requested = await asker.query(
      `SELECT * FROM api.request_reagent_order($1, 4, null, 'Down to the last bottle')`,
      [lot],
    )
    const order = requested.rows[0]
    expect(order.status).toBe('requested')
    expect(order.number).toBe(1)
    expect(order.unit).toBe('mL')
    expect(order.supplier).toBe('Sigma')

    // The buyer is told, the person who asked is not.
    let notes = await migrator.query(
      `SELECT user_id, title FROM internal.notifications WHERE event_type='reagent_order' ORDER BY created_at`,
    )
    expect(notes.rows.map((r) => r.user_id)).toEqual([BUYER])

    // The buyer's Inbox lists the open request; the asker's does not.
    const buyerInbox = await buyer.query(
      `SELECT kind, identifier FROM api.my_work_items WHERE kind='reorder_requested'`,
    )
    expect(buyerInbox.rows).toEqual([
      { kind: 'reorder_requested', identifier: 'RO-0001' },
    ])
    const askerInbox = await asker.query(
      `SELECT kind FROM api.my_work_items WHERE kind LIKE 'reorder_%'`,
    )
    expect(askerInbox.rows).toEqual([])

    // A second reorder for the same material is refused while this one is open.
    await expectDenied(
      asker.query(`SELECT api.request_reagent_order($1, 1)`, [lot]),
      /already open/,
    )

    // A member cannot place an order.
    await expectDenied(
      asker.query(`SELECT api.mark_reagent_ordered($1, 'PO-1')`, [order.id]),
      /only the people who place orders/,
    )
    const ordered = await buyer.query(
      `SELECT * FROM api.mark_reagent_ordered($1, 'PO-77', '2099-01-01', null)`,
      [order.id],
    )
    expect(ordered.rows[0].status).toBe('ordered')
    expect(ordered.rows[0].order_reference).toBe('PO-77')

    notes = await migrator.query(
      `SELECT user_id, title FROM internal.notifications
        WHERE event_type='reagent_order' AND user_id=$1`,
      [ASKER],
    )
    expect(notes.rows.map((r) => r.title)).toEqual(['Reorder placed'])

    const askerIncoming = await asker.query(
      `SELECT kind, state FROM api.my_work_items WHERE kind='reorder_incoming'`,
    )
    expect(askerIncoming.rows).toEqual([
      { kind: 'reorder_incoming', state: 'following' },
    ])
    const buyerAfter = await buyer.query(
      `SELECT 1 FROM api.my_work_items WHERE kind='reorder_requested'`,
    )
    expect(buyerAfter.rows).toEqual([])

    // Receiving needs a fresh lot number.
    await expectDenied(
      asker.query(
        `SELECT api.receive_reagent_order($1, 'L-OLD', '2028-01-01')`,
        [order.id],
      ),
      /new lot number/,
    )
    const received = await asker.query(
      `SELECT * FROM api.receive_reagent_order($1, 'L-NEW', '2028-01-01', 6)`,
      [order.id],
    )
    expect(received.rows[0].status).toBe('received')
    expect(received.rows[0].received_lot).toBe('L-NEW')

    const newLot = await migrator.query(
      `SELECT properties, title FROM api.records WHERE id=$1`,
      [received.rows[0].received_record_id],
    )
    expect(newLot.rows[0].title).toBe('Tris buffer')
    expect(newLot.rows[0].properties).toMatchObject({
      lot: 'L-NEW',
      quantity: 6,
      supplier: 'Sigma',
      low_stock_threshold: 5,
    })
    const link = await migrator.query(
      `SELECT link_metadata FROM api.record_links WHERE source_record_id=$1 AND target_record_id=$2`,
      [lot, received.rows[0].received_record_id],
    )
    expect(link.rows[0].link_metadata.reason).toBe('Reorder RO-0001')

    // Done is done.
    await expectDenied(
      buyer.query(`SELECT api.cancel_reagent_order($1)`, [order.id]),
      /already received/,
    )
    await expectDenied(
      asker.query(`SELECT api.receive_reagent_order($1, 'L-X', '2028-01-01')`, [
        order.id,
      ]),
      /already received/,
    )

    // The history of the material records every step, and a new request is
    // allowed again.
    const history = await migrator.query(
      `SELECT payload->>'action' AS action FROM api.change_events
        WHERE entity_type='material' AND record_id=$1 AND payload ? 'orderId'
        ORDER BY sequence`,
      [lot],
    )
    expect(history.rows.map((r) => r.action)).toEqual([
      'reorder-requested',
      'reorder-ordered',
      'reorder-received',
    ])
    await asker.query(`SELECT api.request_reagent_order($1, 2)`, [lot])
  })

  it('lets the person who asked, or a buyer, cancel an open order', async () => {
    const asker = await actor(ASKER)
    const buyer = await actor(BUYER)
    const lot = await material(asker, 'Glycine')
    const first = await asker.query(
      `SELECT * FROM api.request_reagent_order($1, 1)`,
      [lot],
    )
    const cancelled = await asker.query(
      `SELECT * FROM api.cancel_reagent_order($1, 'No longer needed')`,
      [first.rows[0].id],
    )
    expect(cancelled.rows[0].status).toBe('cancelled')
    expect(cancelled.rows[0].cancel_reason).toBe('No longer needed')

    const second = await asker.query(
      `SELECT * FROM api.request_reagent_order($1, 1)`,
      [lot],
    )
    await buyer.query(
      `SELECT api.cancel_reagent_order($1, 'Out of catalogue')`,
      [second.rows[0].id],
    )
    const notes = await migrator.query(
      `SELECT title FROM internal.notifications
        WHERE event_type='reagent_order' AND user_id=$1 AND title='Reorder cancelled'`,
      [ASKER],
    )
    // Only the cancellation by someone else tells the person who asked.
    expect(notes.rows).toHaveLength(1)
  })

  it('keeps viewers from requesting and lets them read orders', async () => {
    const viewer = await actor(VIEWER)
    const asker = await actor(ASKER)
    const lot = await material(asker, 'Acetone')
    await expectDenied(
      viewer.query(`SELECT api.request_reagent_order($1, 1)`, [lot]),
      /not permitted|cannot write/,
    )

    // Orders are visible to workspace members.
    const seen = await viewer.query(
      `SELECT count(*)::int AS n FROM api.reagent_orders`,
    )
    expect(seen.rows[0].n).toBeGreaterThan(0)
  })
})
