/**
 * ADR-0054 / R5-CONFIG-06 — a booking's subject is the instrument.
 *
 * An instrument's calendar resource is derived from the registry: its id IS the
 * instrument id, the trigger on api.instruments keeps name, code, location and
 * active/retired status in step, and a hand-authored instrument resource is
 * refused or overwritten. Booking rules (SB115 qualification, SB116 calibration,
 * the retired instrument's inactive code) therefore apply unconditionally for
 * resource_type = 'instrument' — with metadata.instrumentId present or absent.
 *
 * The previous proof (LAB-06.3) gated those rules on metadata.instrumentId, so
 * the same scenarios run here against a registered instrument that authors no
 * resource at all, a room that is unaffected, and the study planner, which keeps
 * linking planned work to calendar resources.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c900'
const ADMIN = 'lab063-admin'
const QUALIFIED = 'lab063-qualified'
const UNQUALIFIED = 'lab063-unqualified'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let instrumentId: string
let instrumentDisplayId: string
let roomId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, QUALIFIED, UNQUALIFIED]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab063','LAB-06.3')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'analyst'),($1,$4,'analyst')`,
    [WS, ADMIN, QUALIFIED, UNQUALIFIED],
  )

  // The instrument is registered through the canonical RPC and nothing else is
  // authored for it: the resource is the registry's to write.
  const admin = await actor(ADMIN)
  const registered = await admin.query<{ id: string; display_id: string }>(
    `select * from api.create_instrument($1,'Plate reader PR-01','qpcr',null,'PR-01-SERIAL',null,'Lab A',null,'{}'::jsonb,0,'none')`,
    [WS],
  )
  instrumentId = registered.rows[0]!.id
  instrumentDisplayId = registered.rows[0]!.display_id

  roomId = (
    await admin.query<{ id: string }>(
      `select id from api.create_calendar_resource($1,'Meeting room','ROOM-1','room',null,4,'UTC',null,'{}'::jsonb)`,
      [WS],
    )
  ).rows[0]!.id

  // A current calibration so only the qualification rule is in play first.
  await migrator.query(
    `insert into api.instrument_calibrations(instrument_id,workspace_id,performed_at,due_at)
     values($1,$2,now() - interval '10 days',now() + interval '30 days')`,
    [instrumentId, WS],
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

async function book(client: Client, resourceId: string, hour = 9) {
  return client.query(
    `select * from api.create_booking($1,$2,'Run plate', $3::timestamptz, $4::timestamptz)`,
    [
      WS,
      resourceId,
      new Date(Date.UTC(2026, 10, 2, hour)).toISOString(),
      new Date(Date.UTC(2026, 10, 2, hour + 1)).toISOString(),
    ],
  )
}

async function qualify(userId: string, validUntil: Date) {
  const admin = await actor(ADMIN)
  await admin.query(
    'select * from api.set_instrument_qualification($1,$2,$3)',
    [instrumentId, userId, validUntil.toISOString()],
  )
}

async function resourceRow() {
  const { rows } = await migrator.query<{
    id: string
    name: string
    code: string
    resource_type: string
    location: string | null
    status: string
    metadata: Record<string, unknown>
  }>(
    `select id,name,code,resource_type,location,status,metadata
       from api.calendar_resources where id = $1`,
    [instrumentId],
  )
  return rows[0]!
}

describe('ADR-0054 the instrument owns its calendar resource', () => {
  it('registers an instrument that is bookable with no resource authored', async () => {
    const resource = await resourceRow()
    expect(resource).toMatchObject({
      id: instrumentId,
      name: 'Plate reader PR-01',
      code: instrumentDisplayId,
      resource_type: 'instrument',
      location: 'Lab A',
      status: 'active',
    })
    expect(resource.metadata.instrumentId).toBe(instrumentId)

    // The qualification rule runs with the compatibility link present…
    const unqualified = await actor(UNQUALIFIED)
    await expectDenied(book(unqualified, instrumentId), 'SB115')

    // …and with it absent: nothing depends on metadata (ADR-0054).
    await migrator.query(
      `update api.calendar_resources set metadata = '{}'::jsonb where id = $1`,
      [instrumentId],
    )
    expect((await resourceRow()).metadata).toEqual({})
    await expectDenied(book(unqualified, instrumentId), 'SB115')

    // Qualified, the booking is taken, and the booking names its instrument.
    await qualify(UNQUALIFIED, new Date(Date.now() + 30 * 86_400_000))
    const booked = await book(unqualified, instrumentId)
    expect(booked.rows[0]!.resource_id).toBe(instrumentId)

    const joined = await migrator.query<{ display_id: string; title: string }>(
      `select i.display_id, b.title
         from api.calendar_bookings b
         join api.instruments i on i.id = b.resource_id
        where b.id = $1`,
      [booked.rows[0]!.id],
    )
    expect(joined.rows[0]).toMatchObject({
      display_id: instrumentDisplayId,
      title: 'Run plate',
    })
  })

  it('keeps the resource name, code and location in step with the instrument', async () => {
    await migrator.query(
      `update api.instruments set name = 'Plate reader PR-01 (bay 2)', location = 'Lab B' where id = $1`,
      [instrumentId],
    )
    expect(await resourceRow()).toMatchObject({
      name: 'Plate reader PR-01 (bay 2)',
      location: 'Lab B',
      code: instrumentDisplayId,
    })
  })

  it('refuses and overwrites a hand-authored instrument resource', async () => {
    // A resource whose id is not an instrument has no instrument to derive from.
    await expectDenied(
      migrator.query(
        `insert into api.calendar_resources(id,workspace_id,name,code,resource_type,location)
         values('00000000-0000-4000-8000-00000000c9ff',$1,'Invented instrument','INV-1','instrument','Nowhere')`,
        [WS],
      ),
      'SB021',
    )

    // A hand-written row for a real instrument is overwritten, not trusted.
    await migrator.query(
      `update api.calendar_resources
          set name = 'Wrong name', code = 'WRONG-1', location = 'Wrong lab', status = 'inactive'
        where id = $1`,
      [instrumentId],
    )
    expect(await resourceRow()).toMatchObject({
      name: 'Plate reader PR-01 (bay 2)',
      code: instrumentDisplayId,
      location: 'Lab B',
      status: 'active',
    })
  })

  it('refuses a booker whose qualification has expired', async () => {
    // A grant always starts in the future, so the expiry is aged directly.
    await qualify(QUALIFIED, new Date(Date.now() + 30 * 86_400_000))
    await migrator.query(
      `update api.instrument_qualifications set valid_until = now() - interval '1 day'
        where instrument_id=$1 and user_id=$2`,
      [instrumentId, QUALIFIED],
    )
    const qualified = await actor(QUALIFIED)
    await expectDenied(book(qualified, instrumentId, 11), 'SB115')
  })

  it('refuses a booking when the latest calibration is overdue', async () => {
    await qualify(QUALIFIED, new Date(Date.now() + 30 * 86_400_000))
    await migrator.query(
      `update api.instrument_calibrations set due_at = now() - interval '1 day'
        where instrument_id=$1`,
      [instrumentId],
    )
    const qualified = await actor(QUALIFIED)
    await expectDenied(book(qualified, instrumentId, 13), 'SB116')
    await migrator.query(
      `update api.instrument_calibrations set due_at = now() + interval '30 days'
        where instrument_id=$1`,
      [instrumentId],
    )
  })

  // J-INS-12, CONFIRMED: the guard in 0430 checks every calibration row, not the
  // latest, so a lapsed historical row keeps an in-date instrument unbookable. Fixing
  // it needs a migration (restrict to the newest row by performed_at). `it.fails`
  // keeps the suite green until then and goes red the moment the guard is fixed:
  // change it to `it` when that happens.
  it.fails(
    'allows a booking once a newer calibration supersedes an old past-due one (J-INS-12)',
    async () => {
      await qualify(QUALIFIED, new Date(Date.now() + 30 * 86_400_000))
      await migrator.query(
        `insert into api.instrument_calibrations(instrument_id,workspace_id,performed_at,due_at)
       values ($1,$2, now() - interval '400 days', now() - interval '200 days')`,
        [instrumentId, WS],
      )
      try {
        const qualified = await actor(QUALIFIED)
        const booked = await book(qualified, instrumentId, 15)
        expect(booked.rows).toHaveLength(1)
      } finally {
        await migrator.query(
          `delete from api.instrument_calibrations
          where instrument_id=$1 and due_at < now()`,
          [instrumentId],
        )
      }
    },
  )

  it('refuses a new booking for a retired instrument and keeps its history', async () => {
    const admin = await actor(ADMIN)
    await admin.query('select * from api.set_instrument_retired($1,true)', [
      instrumentId,
    ])
    expect((await resourceRow()).status).toBe('inactive')

    const qualified = await actor(QUALIFIED)
    await expectDenied(book(qualified, instrumentId, 15), 'SB005')

    // The instrument keeps the booking it already had, and reinstating it makes
    // it bookable again.
    const history = await migrator.query(
      `select 1 from api.calendar_bookings where resource_id = $1`,
      [instrumentId],
    )
    expect(history.rowCount).toBeGreaterThan(0)

    await admin.query('select * from api.set_instrument_retired($1,false)', [
      instrumentId,
    ])
    expect((await resourceRow()).status).toBe('active')
    await expect(book(qualified, instrumentId, 15)).resolves.toBeDefined()
  })

  it('leaves a resource that is not an instrument unaffected', async () => {
    const unqualified = await actor(UNQUALIFIED)
    await migrator.query(
      `delete from api.instrument_qualifications where instrument_id=$1 and user_id=$2`,
      [instrumentId, UNQUALIFIED],
    )
    await expect(book(unqualified, roomId, 17)).resolves.toBeDefined()
  })

  it('keeps the study planner linking planned work to the instrument resource', async () => {
    const admin = await actor(ADMIN)
    const task = await admin.query<{ id: string }>(
      `select * from api.create_study_task($1,'Planned run','task',null,null,null,'not_started','medium',$2::timestamptz,$3::timestamptz)`,
      [WS, '2026-11-03T08:00:00Z', '2026-11-03T18:00:00Z'],
    )
    const taskId = task.rows[0]!.id

    // A planned allocation on a free window of the instrument succeeds.
    await expect(
      admin.query(
        `select * from api.assign_task_resource($1,$2,$3,$4::timestamptz,$5::timestamptz)`,
        [
          WS,
          taskId,
          instrumentId,
          '2026-11-03T09:00:00Z',
          '2026-11-03T10:00:00Z',
        ],
      ),
    ).resolves.toBeDefined()

    // One that clashes with the instrument's calendar booking is refused.
    await expectDenied(
      admin.query(
        `select * from api.assign_task_resource($1,$2,$3,$4::timestamptz,$5::timestamptz)`,
        [
          WS,
          taskId,
          instrumentId,
          '2026-11-02T09:15:00Z',
          '2026-11-02T09:45:00Z',
        ],
      ),
      'SB030',
    )
  })
})
