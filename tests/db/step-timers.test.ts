/**
 * Step timers (migration 0061): a countdown started from a step with a duration.
 *
 * Proves: a timer uses the step's own duration, or a length given; it is fixed
 * to an end time on the server; a step with no duration cannot be timed;
 * starting again replaces the running timer; only the person who started a
 * timer sees or stops it; stopping before the end cancels it and stopping
 * after dismisses it; the sweep writes one bell notification per ended timer,
 * once, and not for a timer that was stopped; a person outside the workspace
 * cannot time a step.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000061a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000061a1'
const PROTOCOL = '00000000-0000-4000-8000-0000000061a2'
const ANN = 'timer-ann'
const BEN = 'timer-ben'
const STRANGER = 'timer-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let timedStep: string
let plainStep: string

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ANN, BEN, STRANGER]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'st','Timers'),($2,'st2','Elsewhere')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'owner'),($4,$5,'owner')`,
    [WS, ANN, BEN, OTHER_WS, STRANGER],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     VALUES ($1,$2,'protocol_template','PRT-ST','Incubation protocol','active',$3)`,
    [PROTOCOL, WS, ANN],
  )
  const steps = await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id) VALUES
       ($1,'procedure_step',$2::jsonb,1,$3),
       ($1,'procedure_step',$4::jsonb,2,$3) RETURNING id`,
    [
      PROTOCOL,
      JSON.stringify({
        text: 'Incubate at 37 C',
        stepNumber: 1,
        durationSeconds: 1800,
      }),
      ANN,
      JSON.stringify({ text: 'Read the plate', stepNumber: 2 }),
    ],
  )
  timedStep = steps.rows[0].id
  plainStep = steps.rows[1].id
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
})

describe('step timers', () => {
  it('starts from the step duration and fixes the end time', async () => {
    const ann = await actor(ANN)
    const { rows } = await ann.query(`SELECT * FROM api.start_step_timer($1)`, [
      timedStep,
    ])
    expect(rows[0].duration_seconds).toBe(1800)
    expect(rows[0].label).toBe('Incubate at 37 C')
    const gap =
      new Date(rows[0].ends_at).getTime() -
      new Date(rows[0].started_at).getTime()
    expect(gap).toBe(1_800_000)
    const mine = await ann.query(`SELECT * FROM api.my_step_timers`)
    expect(mine.rows).toHaveLength(1)
    expect(new Date(mine.rows[0].server_now).getTime()).toBeGreaterThan(0)
  })

  it('cannot time a step with no duration unless a length is given', async () => {
    const ann = await actor(ANN)
    await expectDenied(
      ann.query(`SELECT api.start_step_timer($1)`, [plainStep]),
      '22023',
    )
    const { rows } = await ann.query(
      `SELECT * FROM api.start_step_timer($1, 90)`,
      [plainStep],
    )
    expect(rows[0].duration_seconds).toBe(90)
    await expectDenied(
      ann.query(`SELECT api.start_step_timer($1, 0)`, [plainStep]),
      '22023',
    )
  })

  it('replaces a running timer when started again', async () => {
    const ann = await actor(ANN)
    await ann.query(`SELECT api.start_step_timer($1)`, [timedStep])
    const live = await migrator.query(
      `SELECT count(*)::int AS n FROM api.step_timers WHERE user_id=$1 AND block_id=$2 AND status='running'`,
      [ANN, timedStep],
    )
    expect(live.rows[0].n).toBe(1)
  })

  it('keeps timers private to the person who started them', async () => {
    const ben = await actor(BEN)
    expect(
      (await ben.query(`SELECT * FROM api.my_step_timers`)).rows,
    ).toHaveLength(0)
    const annsTimer = await migrator.query(
      `SELECT id FROM api.step_timers WHERE user_id=$1 AND status='running' LIMIT 1`,
      [ANN],
    )
    await expectDenied(
      ben.query(`SELECT api.end_step_timer($1)`, [annsTimer.rows[0].id]),
      '42501',
    )
  })

  it('refuses a person outside the workspace', async () => {
    const stranger = await actor(STRANGER, OTHER_WS)
    await expectDenied(
      stranger.query(`SELECT api.start_step_timer($1)`, [timedStep]),
      '42501',
    )
  })

  it('cancels before the end and dismisses after it', async () => {
    const ann = await actor(ANN)
    const started = await ann.query(`SELECT * FROM api.start_step_timer($1)`, [
      timedStep,
    ])
    const cancelled = await ann.query(`SELECT * FROM api.end_step_timer($1)`, [
      started.rows[0].id,
    ])
    expect(cancelled.rows[0].status).toBe('cancelled')

    const again = await ann.query(`SELECT * FROM api.start_step_timer($1, 5)`, [
      timedStep,
    ])
    await migrator.query(
      `UPDATE api.step_timers SET ends_at = now() - interval '1 second' WHERE id=$1`,
      [again.rows[0].id],
    )
    const dismissed = await ann.query(`SELECT * FROM api.end_step_timer($1)`, [
      again.rows[0].id,
    ])
    expect(dismissed.rows[0].status).toBe('dismissed')
  })

  it('writes one bell notification per ended timer, once', async () => {
    const ann = await actor(ANN)
    const ended = await ann.query(`SELECT * FROM api.start_step_timer($1, 5)`, [
      timedStep,
    ])
    const stopped = await ann.query(
      `SELECT * FROM api.start_step_timer($1, 60)`,
      [plainStep],
    )
    await migrator.query(
      `UPDATE api.step_timers SET ends_at = now() - interval '1 second' WHERE id=$1`,
      [ended.rows[0].id],
    )
    await ann.query(`SELECT api.end_step_timer($1)`, [stopped.rows[0].id])

    const first = await migrator.query(
      `SELECT internal.sweep_step_timers() AS n`,
    )
    expect(first.rows[0].n).toBe(1)
    const second = await migrator.query(
      `SELECT internal.sweep_step_timers() AS n`,
    )
    expect(second.rows[0].n).toBe(0)

    const bell = await ann.query(
      `SELECT title, body FROM api.my_notifications WHERE event_type='step_timer'`,
    )
    expect(bell.rows).toEqual([
      { title: 'Timer finished', body: 'Incubate at 37 C' },
    ])
  })
})
