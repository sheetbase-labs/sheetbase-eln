/**
 * Work that repeats: weekly instrument bookings and experiments started from a
 * protocol on a schedule or at fixed time points.
 *
 * A schedule makes real bookings and experiments through the same RPCs a person
 * uses, so clashes and access rules still apply. An occurrence that cannot be
 * made is recorded with its reason, and running a schedule twice never doubles
 * anything up.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000d059'
const OWNER = 'rec-owner'
const OTHER = 'rec-other'
const PROJECT = '00000000-0000-4000-8000-00000000d060'
let templateId: string
const ZONE = 'America/New_York'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let instrumentId: string
let tomorrow: string

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OTHER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'recurring','Recurring')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'analyst')`,
    [WS, OWNER, OTHER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values($1,$2,'RC','Stability')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,can_edit,granted_by_user_id)
     values($1,$2,$3,true,true,$3)`,
    [WS, PROJECT, OWNER],
  )
  const owner = await actor(OWNER)
  const created = (
    await owner.query<{
      result: { template: { id: string }; version: { id: string; revision: string } }
    }>(
      `select api.create_notebook_template($1,'stability_pull','Stability pull',null,$2::jsonb) result`,
      [
        WS,
        JSON.stringify({
          formatVersion: 1,
          parameters: [],
          placements: [
            {
              id: '00000000-0000-4000-8000-00000000d062',
              kind: 'narrative',
              order: 1,
              blockType: 'rich_text',
              payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
            },
          ],
        }),
      ],
    )
  ).rows[0]!.result
  templateId = created.template.id
  await owner.query(
    `select api.publish_notebook_template_version($1,$2,'Ready')`,
    [created.version.id, created.version.revision],
  )
  instrumentId = (
    await owner.query<{ id: string }>(
      `select * from api.create_instrument($1,'Plate reader PR-01','qpcr',null,'PR-01-SERIAL',null,'Lab A',null,'{}'::jsonb,0,'none')`,
      [WS],
    )
  ).rows[0]!.id
  await migrator.query(
    `insert into api.instrument_calibrations(instrument_id,workspace_id,performed_at,due_at)
     values($1,$2,now() - interval '10 days',now() + interval '2 years')`,
    [instrumentId, WS],
  )
  await owner.query(
    'select * from api.set_instrument_qualification($1,$2,$3)',
    [instrumentId, OWNER, new Date(Date.now() + 2 * 365 * 86_400_000).toISOString()],
  )
  tomorrow = (
    await migrator.query<{ d: string }>(
      `select ((now() at time zone $1)::date + 1)::text as d`,
      [ZONE],
    )
  ).rows[0]!.d
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

interface Created {
  schedule: { id: string; status: string }
  result: {
    created: number
    skipped: number
    failed: number
    problems: { code: string }[]
  }
}

async function createBooking(
  client: Client,
  over: { startsOn?: string; maxOccurrences?: number; title?: string } = {},
): Promise<Created> {
  const { rows } = await client.query<{ r: Created }>(
    `select api.create_recurring_schedule(
       'booking', $2, 'weekly', $3::date, $4, 1, ARRAY[1,3]::smallint[], null, null, $5,
       $6::uuid, '09:00', '10:30') as r where $1::uuid is not null`,
    [
      WS,
      over.title ?? 'Plate reader QC',
      over.startsOn ?? tomorrow,
      ZONE,
      over.maxOccurrences ?? 4,
      instrumentId,
    ],
  )
  return rows[0]!.r
}

describe('repeating bookings', () => {
  it('makes real bookings on the chosen weekdays at the local time', async () => {
    const owner = await actor(OWNER)
    const made = await createBooking(owner)
    expect(made.result).toMatchObject({ created: 4, skipped: 0, failed: 0 })
    const { rows } = await migrator.query<{ day: string; start: string; end: string }>(
      `select (b.starts_at at time zone $2)::date::text as day,
              to_char(b.starts_at at time zone $2, 'HH24:MI') as start,
              to_char(b.ends_at at time zone $2, 'HH24:MI') as "end"
         from api.recurring_occurrences o join api.calendar_bookings b on b.id = o.booking_id
        where o.schedule_id = $1 order by b.starts_at`,
      [made.schedule.id, ZONE],
    )
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.start).toBe('09:00')
      expect(row.end).toBe('10:30')
      const weekday = new Date(`${row.day}T12:00:00Z`).getUTCDay()
      expect([1, 3]).toContain(weekday)
    }
  })

  it('does not double up when run again', async () => {
    const owner = await actor(OWNER)
    const { rows } = await migrator.query<{ id: string }>(
      `select id from api.recurring_schedules where title = 'Plate reader QC'`,
    )
    const again = await owner.query<{ r: Created['result'] }>(
      `select api.materialise_recurring_schedule($1) as r`,
      [rows[0]!.id],
    )
    expect(again.rows[0]!.r.created).toBe(0)
    const count = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.recurring_occurrences where schedule_id = $1`,
      [rows[0]!.id],
    )
    expect(count.rows[0]!.n).toBe(4)
  })

  it('records a clash with its reason and still makes the rest', async () => {
    const owner = await actor(OWNER)
    const clash = await createBooking(owner, { title: 'Second series' })
    expect(clash.result.created).toBe(0)
    expect(clash.result.skipped).toBe(4)
    expect(clash.result.problems[0]!.code).toBe('SB020')
    const { rows } = await migrator.query<{ outcome: string; message: string }>(
      `select outcome, message from api.recurring_occurrences where schedule_id = $1`,
      [clash.schedule.id],
    )
    expect(rows.every((r) => r.outcome === 'skipped')).toBe(true)
    expect(rows[0]!.message).toContain('overlaps')
  })

  it('refuses a start in the past and an unbounded repeat', async () => {
    const owner = await actor(OWNER)
    await expect(
      createBooking(owner, { startsOn: '2020-01-06' }),
    ).rejects.toThrow(/past/)
    await expect(
      owner.query(
        `select api.create_recurring_schedule('booking','x','daily',$2::date,$3,1,null,null,null,null,$4::uuid,'09:00','10:00') where $1::uuid is not null`,
        [WS, tomorrow, ZONE, instrumentId],
      ),
    ).rejects.toThrow(/chk_recurring_bounded/)
  })

  it('lets only the person who set it up run it, and stops with the upcoming ones cancelled', async () => {
    const owner = await actor(OWNER)
    const other = await actor(OTHER)
    const made = await createBooking(owner, {
      title: 'Cancelled series',
      startsOn: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10),
    })
    expect(made.result.created).toBeGreaterThan(0)
    await expect(
      other.query(`select api.materialise_recurring_schedule($1)`, [made.schedule.id]),
    ).rejects.toThrow(/set up/)
    await expect(
      other.query(`select api.end_recurring_schedule($1, true)`, [made.schedule.id]),
    ).rejects.toThrow(/set up/)
    const ended = await owner.query<{ r: { cancelled: number } }>(
      `select api.end_recurring_schedule($1, true) as r`,
      [made.schedule.id],
    )
    expect(ended.rows[0]!.r.cancelled).toBe(made.result.created)
    const live = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.recurring_occurrences o
         join api.calendar_bookings b on b.id = o.booking_id
        where o.schedule_id = $1 and b.status <> 'cancelled'`,
      [made.schedule.id],
    )
    expect(live.rows[0]!.n).toBe(0)
  })
})

describe('repeating experiments', () => {
  it('starts an experiment from the protocol on each time point as it falls due', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query<{ r: Created }>(
      `select api.create_recurring_schedule(
         'experiment','Stability pull', 'offsets', $2::date, $3, 1, null, ARRAY[0,7,30],
         null, null, null, null, null, $4::uuid, 0, $5::uuid) as r where $1::uuid is not null`,
      [WS, tomorrow, ZONE, templateId, PROJECT],
    )
    const made = rows[0]!.r
    // Nothing is due before the first day.
    expect(made.result.created).toBe(0)
    expect(made.schedule.status).toBe('active')

    // Time passes: the schedule started 40 days ago, so all three are due.
    await migrator.query(
      `update api.recurring_schedules set starts_on = starts_on - 40 where id = $1`,
      [made.schedule.id],
    )
    const run = await owner.query<{ r: Created['result'] }>(
      `select api.materialise_recurring_schedule($1) as r`,
      [made.schedule.id],
    )
    expect(run.rows[0]!.r).toMatchObject({ created: 3, failed: 0 })
    const titles = await migrator.query<{ title: string; kind: string }>(
      `select r.title, r.kind from api.recurring_occurrences o
         join api.records r on r.id = o.record_id
        where o.schedule_id = $1 order by o.occurrence_on`,
      [made.schedule.id],
    )
    expect(titles.rows.map((r) => r.kind)).toEqual([
      'experiment',
      'experiment',
      'experiment',
    ])
    expect(titles.rows[1]!.title).toMatch(/^Stability pull \(day 7, /)
    const status = await migrator.query<{ status: string }>(
      `select status from api.recurring_schedules where id = $1`,
      [made.schedule.id],
    )
    expect(status.rows[0]!.status).toBe('ended')
  })

  it('refuses a template with nothing published', async () => {
    const owner = await actor(OWNER)
    const draft = (
      await owner.query<{ result: { template: { id: string } } }>(
        `select api.create_notebook_template($1,'unpublished','Unpublished',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify({
            formatVersion: 1,
            parameters: [],
            placements: [
              {
                id: '00000000-0000-4000-8000-00000000d063',
                kind: 'narrative',
                order: 1,
                blockType: 'rich_text',
                payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
              },
            ],
          }),
        ],
      )
    ).rows[0]!.result.template.id
    await expect(
      owner.query(
        `select api.create_recurring_schedule('experiment','x','weekly',$2::date,$3,1,ARRAY[1]::smallint[],null,null,3,null,null,null,$4::uuid,0,$5::uuid) where $1::uuid is not null`,
        [WS, tomorrow, ZONE, draft, PROJECT],
      ),
    ).rejects.toThrow(/published/)
  })
})

describe('the dates a repeat falls on', () => {
  it('repeats monthly on the last day of a shorter month', async () => {
    const { rows } = await migrator.query<{ id: string }>(
      `insert into api.recurring_schedules(workspace_id,kind,title,frequency,interval_count,starts_on,max_occurrences,
         timezone,notebook_template_id,project_id,created_by_user_id)
       values($1,'experiment','Monthly','monthly',1,'2027-01-31',4,'UTC',$2,$3,$4) returning id`,
      [WS, templateId, PROJECT, OWNER],
    )
    const dates = await migrator.query<{ d: string }>(
      `select d::text from internal.recurring_dates(
         (select s from api.recurring_schedules s where id = $1), '2027-12-31') d`,
      [rows[0]!.id],
    )
    expect(dates.rows.map((r) => r.d)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ])
  })

  it('repeats every second week', async () => {
    const { rows } = await migrator.query<{ id: string }>(
      `insert into api.recurring_schedules(workspace_id,kind,title,frequency,interval_count,weekdays,starts_on,ends_on,
         timezone,notebook_template_id,project_id,created_by_user_id)
       values($1,'experiment','Fortnightly','weekly',2,ARRAY[2]::smallint[],'2027-01-05','2027-02-09','UTC',$2,$3,$4) returning id`,
      [WS, templateId, PROJECT, OWNER],
    )
    const dates = await migrator.query<{ d: string }>(
      `select d::text from internal.recurring_dates(
         (select s from api.recurring_schedules s where id = $1), '2027-12-31') d`,
      [rows[0]!.id],
    )
    expect(dates.rows.map((r) => r.d)).toEqual([
      '2027-01-05',
      '2027-01-19',
      '2027-02-02',
    ])
  })
})
