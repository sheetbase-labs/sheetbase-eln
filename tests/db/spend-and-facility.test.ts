/**
 * Money and facility use (migration 0090).
 *
 * Proves: any model can be the supplier list and an order can name a supplier
 * record from it (and only from it); a price is kept per order and read only by
 * the people who place orders; spend lines carry the price; an instrument's
 * recharge rate is set by instrument managers; usage lines clip hours to the
 * period and leave out cancelled bookings; project status counts experiments by
 * state; a scheduled report can only be set up by the right people, goes only
 * to current members, falls due on its own rhythm, is claimed once, and a queued
 * report email carries its files.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000090a0'
const PROJ = '00000000-0000-4000-8000-0000000090a1'
const INSTRUMENT = '00000000-0000-4000-8000-0000000090a2'
const OWNER = 'sf-owner'
const STEWARD = 'sf-steward'
const MEMBER = 'sf-member'
const OUTSIDER = 'sf-outsider'

/** The call is refused for lack of standing. */
function denied(promise: Promise<unknown>): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    code: '42501',
  }) as unknown as Promise<void>
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS, { session_id: `session-${userId}` })
  return client
}

async function material(client: Client, title: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT id FROM api.create_record($1::uuid,'material',$2,'available',ARRAY[]::text[],$3::jsonb)`,
    [
      PROJ,
      title,
      JSON.stringify({ supplier: 'Sigma', unit: 'mL', quantity: 2 }),
    ],
  )
  return rows[0].id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, STEWARD, MEMBER, OUTSIDER]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'sf','Spend')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'steward'),($1,$4,'member')`,
    [WS, OWNER, STEWARD, MEMBER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'sf','Spend project',$3)`,
    [PROJ, WS, STEWARD],
  )
  for (const userId of [OWNER, STEWARD, MEMBER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJ,
      userId,
      canEdit: true,
    })
  }
  await migrator.query(
    `INSERT INTO api.instruments(id,workspace_id,name,instrument_type,created_by_user_id)
     VALUES ($1,$2,'Plate reader','qpcr',$3)`,
    [INSTRUMENT, WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

const SUPPLIER_FIELDS = JSON.stringify([
  { field_name: 'contact_name', label: 'Contact', show_in_list: true },
  { field_name: 'email', label: 'Email' },
])

describe('suppliers and prices', () => {
  it('sets up a supplier model, takes an order against a supplier record, and keeps the price private', async () => {
    const steward = await actor(STEWARD)
    const member = await actor(MEMBER)

    await denied(
      member.query(
        `SELECT api.create_supplier_model('supplier','Supplier','SUP','Who we buy from',$1::jsonb)`,
        [SUPPLIER_FIELDS],
      ),
    )
    await steward.query(
      `SELECT api.create_supplier_model('supplier','Supplier','SUP','Who we buy from',$1::jsonb)`,
      [SUPPLIER_FIELDS],
    )
    const lists = await member.query(
      `SELECT model_key FROM api.supplier_models`,
    )
    expect(lists.rows.map((r) => r.model_key)).toEqual(['supplier'])

    const supplier = (
      await steward.query(
        `SELECT id, title FROM api.create_model_record($1::uuid,'supplier','Fisher Scientific')`,
        [PROJ],
      )
    ).rows[0]
    const notASupplier = await material(steward, 'Not a supplier')

    const lot = await material(member, 'Tris buffer')
    const order = (
      await member.query(`SELECT * FROM api.request_reagent_order($1, 4)`, [
        lot,
      ])
    ).rows[0]

    // Only the people who place orders may place one, and a record outside the
    // supplier list is refused.
    await denied(
      member.query(
        `SELECT api.mark_reagent_ordered($1, 'PO-1', null, null, $2::uuid, 120, 'GBP')`,
        [order.id, supplier.id],
      ),
    )
    await expect(
      steward.query(
        `SELECT api.mark_reagent_ordered($1, 'PO-1', null, null, $2::uuid, 120, 'GBP')`,
        [order.id, notASupplier],
      ),
    ).rejects.toMatchObject({ code: '22023' })

    const placed = (
      await steward.query(
        `SELECT * FROM api.mark_reagent_ordered($1, 'PO-1', '2099-01-01', null, $2::uuid, 120.5, 'gbp')`,
        [order.id, supplier.id],
      )
    ).rows[0]
    expect(placed.status).toBe('ordered')
    expect(placed.supplier).toBe('Fisher Scientific')
    expect(placed.supplier_record_id).toBe(supplier.id)

    // The price is stored with an upper-case currency and read by the buyer only.
    const price = await steward.query(
      `SELECT total_price, currency FROM api.reagent_order_prices WHERE order_id = $1`,
      [order.id],
    )
    expect(price.rows[0]).toMatchObject({
      total_price: '120.50',
      currency: 'GBP',
    })
    const seenByMember = await member.query(
      `SELECT 1 FROM api.reagent_order_prices WHERE order_id = $1`,
      [order.id],
    )
    expect(seenByMember.rowCount).toBe(0)

    await expect(
      steward.query(`SELECT api.set_reagent_order_price($1, 10, 'pounds')`, [
        order.id,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await denied(
      member.query(`SELECT api.set_reagent_order_price($1, 1, 'GBP')`, [
        order.id,
      ]),
    )

    // Spend lines carry the price for the buyer and no price for the member.
    const from = '2000-01-01T00:00:00Z'
    const to = '2100-01-01T00:00:00Z'
    const spend = await steward.query(
      `SELECT * FROM api.report_spend_lines($1, $2, $3)`,
      [WS, from, to],
    )
    expect(spend.rows).toHaveLength(1)
    expect(spend.rows[0]).toMatchObject({
      supplier: 'Fisher Scientific',
      project_title: 'Spend project',
      total_price: '120.50',
      currency: 'GBP',
    })
    const spendForMember = await member.query(
      `SELECT total_price FROM api.report_spend_lines($1, $2, $3)`,
      [WS, from, to],
    )
    expect(spendForMember.rows[0].total_price).toBeNull()

    // Clearing a price removes it.
    await steward.query(`SELECT api.set_reagent_order_price($1, null, null)`, [
      order.id,
    ])
    const cleared = await steward.query(
      `SELECT 1 FROM api.reagent_order_prices WHERE order_id = $1`,
      [order.id],
    )
    expect(cleared.rowCount).toBe(0)
  })

  it('lets another model be ticked as a supplier list, and unticked', async () => {
    const steward = await actor(STEWARD)
    await steward.query(
      `SELECT api.create_workspace_model($1,'vendor','Vendor','VEN')`,
      [WS],
    )
    await steward.query(`SELECT api.set_model_supplier_list('vendor', true)`)
    let lists = await steward.query(
      `SELECT model_key FROM api.supplier_models ORDER BY model_key`,
    )
    expect(lists.rows.map((r) => r.model_key)).toEqual(['supplier', 'vendor'])
    await steward.query(`SELECT api.set_model_supplier_list('vendor', false)`)
    lists = await steward.query(`SELECT model_key FROM api.supplier_models`)
    expect(lists.rows.map((r) => r.model_key)).toEqual(['supplier'])
    await expect(
      steward.query(`SELECT api.set_model_supplier_list('nothing', true)`),
    ).rejects.toMatchObject({ code: 'SB036' })
  })
})

describe('instrument usage and recharge', () => {
  it('sets a rate, clips hours to the period and leaves out cancelled bookings', async () => {
    const owner = await actor(OWNER)
    const member = await actor(MEMBER)

    await denied(
      member.query(`SELECT api.set_instrument_rate($1, 12.5, 'GBP')`, [
        INSTRUMENT,
      ]),
    )
    await owner.query(`SELECT api.set_instrument_rate($1, 12.5, 'gbp')`, [
      INSTRUMENT,
    ])
    await expect(
      owner.query(`SELECT api.set_instrument_rate($1, -1, 'GBP')`, [
        INSTRUMENT,
      ]),
    ).rejects.toMatchObject({ code: '22023' })

    // Three hours inside the period, one that spills over its start, one cancelled.
    await migrator.query(
      `INSERT INTO api.calendar_bookings
         (workspace_id,resource_id,project_id,title,status,starts_at,ends_at,created_by_user_id,cancelled_at)
       VALUES
         ($1,$2,$3,'Inside','confirmed','2026-03-10T09:00Z','2026-03-10T12:00Z',$4,NULL),
         ($1,$2,NULL,'Spills in','confirmed','2026-02-28T23:00Z','2026-03-01T02:00Z',$5,NULL),
         ($1,$2,$3,'Dropped','cancelled','2026-03-11T09:00Z','2026-03-11T10:00Z',$4,now())`,
      [WS, INSTRUMENT, PROJ, MEMBER, OWNER],
    )

    const lines = await member.query(
      `SELECT title, hours, rate_per_hour, currency, project_title, user_id
         FROM api.report_usage_lines($1,'2026-03-01T00:00Z','2026-04-01T00:00Z')
        ORDER BY starts_at`,
      [WS],
    )
    expect(lines.rows.map((r) => [r.title, Number(r.hours)])).toEqual([
      ['Spills in', 2],
      ['Inside', 3],
    ])
    expect(lines.rows[1]).toMatchObject({
      rate_per_hour: '12.50',
      currency: 'GBP',
      project_title: 'Spend project',
      user_id: MEMBER,
    })

    await owner.query(`SELECT api.set_instrument_rate($1, null, null)`, [
      INSTRUMENT,
    ])
    const unrated = await member.query(
      `SELECT rate_per_hour FROM api.report_usage_lines($1,'2026-03-01T00:00Z','2026-04-01T00:00Z')`,
      [WS],
    )
    expect(unrated.rows.every((r) => r.rate_per_hour === null)).toBe(true)
  })
})

describe('project status', () => {
  it('counts experiments by state, what is late and what is still on order', async () => {
    const steward = await actor(STEWARD)
    const make = async (title: string, status: string) => {
      const { rows } = await steward.query(
        `SELECT id FROM api.create_record($1::uuid,'experiment',$2,'draft',ARRAY[]::text[],'{}'::jsonb)`,
        [PROJ, title],
      )
      await migrator.query(`UPDATE api.records SET status = $2 WHERE id = $1`, [
        rows[0].id,
        status,
      ])
      return rows[0].id as string
    }
    await make('Running', 'in_progress')
    await make('Paused', 'on_hold')
    await make('Waiting for review', 'in_review')
    const late = await make('Late', 'in_progress')
    await migrator.query(
      `UPDATE api.records SET planned_end = '2020-01-01' WHERE id = $1`,
      [late],
    )

    const status = await steward.query(
      `SELECT * FROM api.report_project_status($1, null, now() - interval '7 days', now() + interval '1 day')`,
      [WS],
    )
    expect(status.rows).toHaveLength(1)
    expect(status.rows[0]).toMatchObject({
      project_title: 'Spend project',
      in_progress: 2,
      on_hold: 1,
      in_review: 1,
      overdue: 1,
      started_in_period: 4,
    })
  })
})

describe('scheduled reports', () => {
  const save = (client: Client, name: string, recipients: string[]) =>
    client.query(
      `SELECT * FROM api.save_scheduled_report(null, $1, 'spend', null, 'previous_week', 10,
         'weekly', 1, 1, 8, 'Europe/London', $2::text[], true)`,
      [name, recipients],
    )

  it('is set up by the right people, for current members only', async () => {
    const steward = await actor(STEWARD)
    const member = await actor(MEMBER)
    const owner = await actor(OWNER)

    await denied(save(member, 'Weekly spend', [MEMBER]))
    await denied(
      member.query(
        `SELECT api.save_scheduled_report(null,'Use','instrument_usage',null,'previous_week',10,
           'weekly',1,1,8,'UTC',ARRAY['${MEMBER}'],true)`,
      ),
    )

    const saved = (await save(steward, 'Weekly spend', [STEWARD, OUTSIDER]))
      .rows[0]
    // The outsider is not a member, so only the steward is kept.
    expect(saved.recipient_user_ids).toEqual([STEWARD])
    expect(new Date(saved.next_run_at).getTime()).toBeGreaterThan(Date.now())
    // Weekly on Monday at 08:00 London time.
    const next = await migrator.query(
      `SELECT extract(dow FROM next_run_at AT TIME ZONE 'Europe/London')::int AS dow,
              extract(hour FROM next_run_at AT TIME ZONE 'Europe/London')::int AS hour
         FROM api.scheduled_reports WHERE id = $1`,
      [saved.id],
    )
    expect(next.rows[0]).toEqual({ dow: 1, hour: 8 })

    await expect(save(steward, 'Nobody', [OUTSIDER])).rejects.toMatchObject({
      code: '22023',
    })
    await expect(
      steward.query(
        `SELECT api.save_scheduled_report(null,'Bad zone','spend',null,'previous_week',10,
           'daily',1,1,8,'Mars/Olympus',ARRAY['${STEWARD}'],true)`,
      ),
    ).rejects.toMatchObject({ code: '22023' })

    // The owner can see and delete it; a member cannot see it.
    const seen = await member.query(`SELECT 1 FROM api.scheduled_reports`)
    expect(seen.rowCount).toBe(0)
    await denied(
      member.query(`SELECT api.delete_scheduled_report($1)`, [saved.id]),
    )
    await owner.query(`SELECT api.delete_scheduled_report($1)`, [saved.id])
  })

  it('falls due once, moves to its next slot, and can be sent now', async () => {
    const steward = await actor(STEWARD)
    const saved = (await save(steward, 'Rolling', [STEWARD])).rows[0]

    // Nothing is due yet.
    let claimed = await migrator.query(
      `SELECT * FROM internal.claim_due_scheduled_reports(10)`,
    )
    expect(claimed.rowCount).toBe(0)

    await migrator.query(
      `UPDATE api.scheduled_reports SET next_run_at = now() - interval '1 minute' WHERE id = $1`,
      [saved.id],
    )
    claimed = await migrator.query(
      `SELECT * FROM internal.claim_due_scheduled_reports(10)`,
    )
    expect(claimed.rows.map((r) => r.id)).toEqual([saved.id])
    expect(new Date(claimed.rows[0].next_run_at).getTime()).toBeGreaterThan(
      Date.now(),
    )
    // A second pass finds nothing: it was moved on in the same step.
    claimed = await migrator.query(
      `SELECT * FROM internal.claim_due_scheduled_reports(10)`,
    )
    expect(claimed.rowCount).toBe(0)

    // Sending now is picked up on the next pass without moving the rhythm.
    const before = (
      await migrator.query(
        `SELECT next_run_at FROM api.scheduled_reports WHERE id = $1`,
        [saved.id],
      )
    ).rows[0].next_run_at
    await steward.query(`SELECT api.send_scheduled_report_now($1)`, [saved.id])
    claimed = await migrator.query(
      `SELECT * FROM internal.claim_due_scheduled_reports(10)`,
    )
    expect(claimed.rows.map((r) => r.id)).toEqual([saved.id])
    expect(claimed.rows[0].next_run_at).toEqual(before)

    // A paused schedule is never claimed.
    await steward.query(`SELECT api.set_scheduled_report_active($1, false)`, [
      saved.id,
    ])
    await migrator.query(
      `UPDATE api.scheduled_reports SET next_run_at = now() - interval '1 minute' WHERE id = $1`,
      [saved.id],
    )
    claimed = await migrator.query(
      `SELECT * FROM internal.claim_due_scheduled_reports(10)`,
    )
    expect(claimed.rowCount).toBe(0)
  })

  it('queues a report email with its files', async () => {
    const attachments = [
      { filename: 'spend.csv', content: 'a,b\n1,2\n', contentType: 'text/csv' },
    ]
    const id = (
      await migrator.query(
        `SELECT internal.enqueue_report_email($1,$2,'Weekly spend','Body',$3::jsonb) AS id`,
        [WS, STEWARD, JSON.stringify(attachments)],
      )
    ).rows[0].id
    const row = (
      await migrator.query(
        `SELECT event_type, to_email, attachments FROM internal.email_deliveries WHERE id = $1`,
        [id],
      )
    ).rows[0]
    expect(row.event_type).toBe('scheduled_report')
    expect(row.to_email).toBe(`${STEWARD}@test.invalid`)
    expect(row.attachments).toEqual(attachments)

    const nobody = await migrator.query(
      `SELECT internal.enqueue_report_email($1,'no-such-user','x','y',null) AS id`,
      [WS],
    )
    expect(nobody.rows[0].id).toBeNull()
  })
})
