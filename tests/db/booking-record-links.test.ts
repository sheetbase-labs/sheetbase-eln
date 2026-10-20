/**
 * LINK-03 — a booking is a link on its experiment.
 *
 * `calendar_bookings.linked_experiment_record_id` names the experiment on the
 * booking row alone; the trigger writes the experiment -> booking
 * `record_links` row everything that shows related work reads, and keeps it in
 * step as the booking is moved, cancelled or deleted.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000014a0'
const PROJECT = '00000000-0000-4000-8000-0000000014a1'
const INSTRUMENT = '00000000-0000-4000-8000-0000000014a2'
const EXP_A = '00000000-0000-4000-8000-0000000014a3'
const EXP_B = '00000000-0000-4000-8000-0000000014a4'
const EXP_LOCKED = '00000000-0000-4000-8000-0000000014a5'
const USER = 'link03-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [USER, `${USER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'link03','LINK-03')`,
    [WS],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title) values($1,$2,'L3','Bookings')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type) values($1,$2,'Plate reader PR-01','qpcr')`,
    [INSTRUMENT, WS],
  )
  for (const [id, identifier] of [
    [EXP_A, 'EXP-L3A'],
    [EXP_B, 'EXP-L3B'],
    [EXP_LOCKED, 'EXP-L3L'],
  ]) {
    await migrator.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
       values($1,$2,$3,'experiment',$4,'Booked experiment','in_progress',$5)`,
      [id, WS, PROJECT, identifier, USER],
    )
  }
  const revision = await migrator.query<{ id: string }>(
    `insert into api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,
                               block_snapshot,reason,created_by_user_id)
     values($1,$2,1,1,'{}'::jsonb,'[]'::jsonb,'manual',$3) returning id`,
    [EXP_LOCKED, WS, USER],
  )
  await migrator.query(
    `update api.records set locked_at = now(), locked_by_revision_id = $2 where id = $1`,
    [EXP_LOCKED, revision.rows[0]!.id],
  )
})

afterAll(async () => {
  await migrator?.end()
})

async function book(experimentId: string | null): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.calendar_bookings(workspace_id,resource_id,title,starts_at,ends_at,
                                       linked_experiment_record_id,created_by_user_id)
     values($1,$2,'Read plate',now(),now()+interval '1 hour',$3,$4) returning id`,
    [WS, INSTRUMENT, experimentId, USER],
  )
  return rows[0]!.id
}

async function links(experimentId: string) {
  const { rows } = await migrator.query<{
    target_identifier: string
    target_kind: string
    link_metadata: { bookingId: string }
  }>(
    `select target_identifier, target_kind, link_metadata from api.record_links
      where source_record_id = $1 and link_type = 'booking' order by target_identifier`,
    [experimentId],
  )
  return rows
}

describe('LINK-03 booking record links', () => {
  it('links a booking to its experiment, addressed by the booking display id', async () => {
    const bookingId = await book(EXP_A)
    const rows = await links(EXP_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      target_kind: 'booking',
      target_identifier: expect.stringMatching(/^CAL-\d{4}$/),
    })
    expect(rows[0]!.link_metadata.bookingId).toBe(bookingId)
  })

  it('writes no link for a booking that names no experiment', async () => {
    const before = await links(EXP_B)
    await book(null)
    expect(await links(EXP_B)).toEqual(before)
  })

  it('moves the link when the booking is moved to another experiment', async () => {
    const bookingId = await book(EXP_A)
    expect(
      (await links(EXP_A)).some((l) => l.link_metadata.bookingId === bookingId),
    ).toBe(true)

    await migrator.query(
      `update api.calendar_bookings set linked_experiment_record_id = $2 where id = $1`,
      [bookingId, EXP_B],
    )
    expect(
      (await links(EXP_A)).some((l) => l.link_metadata.bookingId === bookingId),
    ).toBe(false)
    expect(
      (await links(EXP_B)).some((l) => l.link_metadata.bookingId === bookingId),
    ).toBe(true)
  })

  it('removes the link when the booking is cancelled, and when it is deleted', async () => {
    const cancelled = await book(EXP_B)
    await migrator.query(
      `update api.calendar_bookings set status = 'cancelled', cancelled_at = now() where id = $1`,
      [cancelled],
    )
    expect(
      (await links(EXP_B)).some((l) => l.link_metadata.bookingId === cancelled),
    ).toBe(false)

    const deleted = await book(EXP_B)
    expect(
      (await links(EXP_B)).some((l) => l.link_metadata.bookingId === deleted),
    ).toBe(true)
    await migrator.query(`delete from api.calendar_bookings where id = $1`, [
      deleted,
    ])
    expect(
      (await links(EXP_B)).some((l) => l.link_metadata.bookingId === deleted),
    ).toBe(false)
  })

  it('refreshes the link metadata when the booking is rescheduled, without a second link', async () => {
    const bookingId = await book(EXP_A)
    const before = (await links(EXP_A)).length
    await migrator.query(
      `update api.calendar_bookings set starts_at = starts_at + interval '1 day',
                                        ends_at = ends_at + interval '1 day' where id = $1`,
      [bookingId],
    )
    expect((await links(EXP_A)).length).toBe(before)
  })

  it('leaves a locked experiment alone, but keeps the booking', async () => {
    const bookingId = await book(EXP_LOCKED)
    expect(await links(EXP_LOCKED)).toEqual([])
    const { rows } = await migrator.query(
      `select 1 from api.calendar_bookings where id = $1`,
      [bookingId],
    )
    expect(rows).toHaveLength(1)
  })
})
