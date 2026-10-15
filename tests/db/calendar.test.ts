/**
 * OPS-004 integration proof for calendar resources, bookings, participants,
 * required samples, transactional overlap detection, DST transitions,
 * duplicate/cancel workflows, RLS and change events.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000404a'
const WS_B = '00000000-0000-4000-8000-00000000404b'
const PROJ_A = '00000000-0000-4000-8000-00000000414a'
const OWNER_A = 'ops004-owner-a'
const MEMBER_A = 'ops004-member-a'
const OWNER_B = 'ops004-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createResource(
  client: Client,
  code: string,
  name = code,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_calendar_resource($1, $2, $3, 'room', 'Lab A')`,
    [WS_A, name, code],
  )
  return rows[0]
}

async function createBooking(
  client: Client,
  resourceId: string,
  title: string,
  startsAt: string,
  endsAt: string,
  status = 'tentative',
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_booking($1, $2, $3, $4::timestamptz, $5::timestamptz, 'UTC', $6)`,
    [WS_A, resourceId, title, startsAt, endsAt, status],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'OPS004 Owner A', 'ops004-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'OPS004 Member A', 'ops004-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'OPS004 Owner B', 'ops004-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ops004-a', 'OPS004 A'),
      ('${WS_B}', 'ops004-b', 'OPS004 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'ops4-a', 'OPS004 A', '${OWNER_A}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('OPS-004 create_calendar_resource', () => {
  it('creates a resource of an explicit non-instrument type', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.create_calendar_resource($1, $2, $3, 'room')`,
      [WS_A, 'qPCR-01', 'qpcr-01'],
    )
    expect(rows[0]).toMatchObject({
      workspace_id: WS_A,
      name: 'qPCR-01',
      code: 'qpcr-01',
      resource_type: 'room',
      status: 'active',
      capacity: 1,
      timezone: 'UTC',
    })
  })

  it('refuses a hand-authored instrument resource', async () => {
    // ADR-0054: an instrument's resource is derived from the registry (id =
    // instrument id), so it is not written here — the default type included.
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.create_calendar_resource($1, $2, $3)`, [
        WS_A,
        'Invented instrument',
        'invented-instrument',
      ]),
      'SB021',
    )
  })

  it('enforces unique code per workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createResource(owner, 'dup-code')
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_calendar_resource($1, $2, $3, 'room')`,
        [WS_A, 'Dup again', 'dup-code'],
      ),
      '23505',
    )
  })

  it('rejects a non-member', async () => {
    const nonMember = await asAuthenticated(MEMBER_A, WS_B)
    await expectDenied(
      nonMember.query(
        `SELECT * FROM api.create_calendar_resource($1, $2, $3)`,
        [WS_B, 'Forbidden', 'forbidden'],
      ),
      '42501',
    )
  })
})

describe('OPS-004 create_booking overlap detection', () => {
  it('creates a non-overlapping booking', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'overlap-r1')
    const booking = await createBooking(
      owner,
      resource.id,
      'Morning run',
      '2025-07-14 08:00+00',
      '2025-07-14 10:00+00',
      'confirmed',
    )
    expect(booking).toMatchObject({
      status: 'confirmed',
      workspace_id: WS_A,
      metadata_version: 1,
    })
  })

  it('rejects an overlapping booking with SB020', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'overlap-r2')
    await createBooking(
      owner,
      resource.id,
      'First',
      '2025-07-14 08:00+00',
      '2025-07-14 10:00+00',
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_booking($1, $2, $3, $4::timestamptz, $5::timestamptz, 'UTC', 'tentative')`,
        [
          WS_A,
          resource.id,
          'Overlap',
          '2025-07-14 09:00+00',
          '2025-07-14 11:00+00',
        ],
      ),
      'SB020',
    )
  })

  it('allows back-to-back bookings (touching but not overlapping)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'overlap-r3')
    await createBooking(
      owner,
      resource.id,
      'First',
      '2025-07-14 08:00+00',
      '2025-07-14 10:00+00',
    )
    const second = await createBooking(
      owner,
      resource.id,
      'Second',
      '2025-07-14 10:00+00',
      '2025-07-14 12:00+00',
    )
    expect(second.title).toBe('Second')
  })

  it('allows overlapping bookings on different resources', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const r1 = await createResource(owner, 'overlap-r4a')
    const r2 = await createResource(owner, 'overlap-r4b')
    await createBooking(
      owner,
      r1.id,
      'On r1',
      '2025-07-14 08:00+00',
      '2025-07-14 10:00+00',
    )
    const onR2 = await createBooking(
      owner,
      r2.id,
      'On r2',
      '2025-07-14 08:00+00',
      '2025-07-14 10:00+00',
    )
    expect(onR2.title).toBe('On r2')
  })

  it('rejects an invalid time range with SB023', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'overlap-r5')
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_booking($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [
          WS_A,
          resource.id,
          'Bad range',
          '2025-07-14 10:00+00',
          '2025-07-14 08:00+00',
        ],
      ),
      'SB023',
    )
  })
})

describe('OPS-004 DST transitions', () => {
  it('stores and compares booking times as absolute instants across a spring-forward boundary', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'dst-spring')
    // Europe/London spring-forward 2025-03-30 01:00 UTC → 02:00 BST.
    // A booking 00:30–02:30 UTC spans the gap; instants are unambiguous.
    const booking = await createBooking(
      owner,
      resource.id,
      'Spring-forward run',
      '2025-03-30 00:30+00',
      '2025-03-30 02:30+00',
    )
    expect(booking.starts_at.toISOString()).toBe('2025-03-30T00:30:00.000Z')
    // An overlapping booking in UTC instants must be rejected.
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_booking($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [
          WS_A,
          resource.id,
          'DST overlap',
          '2025-03-30 01:30+00',
          '2025-03-30 03:00+00',
        ],
      ),
      'SB020',
    )
  })

  it('stores and compares booking times across an autumn-fallback boundary', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'dst-autumn')
    // Europe/London fall-back 2025-10-26 01:00 BST → 00:00 GMT (02:00 UTC).
    const booking = await createBooking(
      owner,
      resource.id,
      'Autumn run',
      '2025-10-26 00:30+00',
      '2025-10-26 02:30+00',
    )
    expect(booking.ends_at.toISOString()).toBe('2025-10-26T02:30:00.000Z')
    // A non-overlapping booking after the boundary should succeed.
    const after = await createBooking(
      owner,
      resource.id,
      'After fallback',
      '2025-10-26 02:30+00',
      '2025-10-26 04:00+00',
    )
    expect(after.title).toBe('After fallback')
  })
})

describe('OPS-004 edit_booking', () => {
  it('updates the title and bumps metadata_version', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'edit-r1')
    const booking = await createBooking(
      owner,
      resource.id,
      'Original',
      '2025-07-15 08:00+00',
      '2025-07-15 09:00+00',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.edit_booking($1, $2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $3)`,
      [booking.id, 'Renamed', booking.metadata_version],
    )
    expect(rows[0].title).toBe('Renamed')
    expect(rows[0].metadata_version).toBe(booking.metadata_version + 1)
  })

  it('rejects a move into an overlapping slot with SB020', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'edit-r2')
    const first = await createBooking(
      owner,
      resource.id,
      'First',
      '2025-07-16 08:00+00',
      '2025-07-16 10:00+00',
    )
    const second = await createBooking(
      owner,
      resource.id,
      'Second',
      '2025-07-16 10:00+00',
      '2025-07-16 12:00+00',
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.edit_booking($1, NULL, $2::timestamptz, $3::timestamptz)`,
        [second.id, '2025-07-16 09:00+00', '2025-07-16 11:00+00'],
      ),
      'SB020',
    )
    void first
  })

  it('rejects a stale metadata version with SB001', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'edit-r3')
    const booking = await createBooking(
      owner,
      resource.id,
      'Stale',
      '2025-07-17 08:00+00',
      '2025-07-17 09:00+00',
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.edit_booking($1, $2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $3)`,
        [booking.id, 'New name', booking.metadata_version + 5],
      ),
      'SB001',
    )
  })
})

describe('OPS-004 duplicate_booking', () => {
  it('creates a copy at a new time range with participants and samples', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'dup-r1')
    const { rows: bookingRows } = await owner.query(
      `SELECT * FROM api.create_booking(
        $1, $2, 'Original', '2025-07-18 08:00+00'::timestamptz,
        '2025-07-18 09:00+00'::timestamptz, 'UTC', 'confirmed',
        false, NULL, 'blue', 'notes',
        NULL, NULL,
        '[{"userId":null,"displayName":"Alice","role":"owner"}]'::jsonb,
        '[]'::jsonb)`,
      [WS_A, resource.id],
    )
    const original = bookingRows[0]
    const { rows: dupRows } = await owner.query(
      `SELECT * FROM api.duplicate_booking($1, $2::timestamptz, $3::timestamptz, $4)`,
      [
        original.id,
        '2025-07-25 08:00+00',
        '2025-07-25 09:00+00',
        'Duplicated run',
      ],
    )
    expect(dupRows[0].title).toBe('Duplicated run')
    expect(dupRows[0].status).toBe('confirmed')

    const { rows: participants } = await owner.query(
      `SELECT display_name, role FROM api.calendar_booking_participants WHERE booking_id = $1`,
      [dupRows[0].id],
    )
    expect(participants.some((p: any) => p.display_name === 'Alice')).toBe(true)
  })

  it('rejects a duplicate whose new range overlaps the original', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'dup-r2')
    const { rows: bookingRows } = await owner.query(
      `SELECT * FROM api.create_booking(
        $1, $2, 'Original', '2025-07-19 08:00+00'::timestamptz,
        '2025-07-19 10:00+00'::timestamptz, 'UTC', 'confirmed')`,
      [WS_A, resource.id],
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.duplicate_booking($1, $2::timestamptz, $3::timestamptz)`,
        [bookingRows[0].id, '2025-07-19 09:00+00', '2025-07-19 11:00+00'],
      ),
      'SB020',
    )
  })
})

describe('OPS-004 cancel_booking', () => {
  it('soft-cancels a booking and frees the slot', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'cancel-r1')
    const booking = await createBooking(
      owner,
      resource.id,
      'To cancel',
      '2025-07-20 08:00+00',
      '2025-07-20 10:00+00',
    )
    const { rows: cancelled } = await owner.query(
      `SELECT * FROM api.cancel_booking($1, $2)`,
      [booking.id, booking.metadata_version],
    )
    expect(cancelled[0].status).toBe('cancelled')
    expect(cancelled[0].cancelled_at).not.toBeNull()

    // The slot is now free: a previously-overlapping booking succeeds.
    const rebook = await createBooking(
      owner,
      resource.id,
      'Rebooked',
      '2025-07-20 09:00+00',
      '2025-07-20 11:00+00',
    )
    expect(rebook.title).toBe('Rebooked')
  })

  it('rejects cancelling an already-cancelled booking with SB024', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'cancel-r2')
    const booking = await createBooking(
      owner,
      resource.id,
      'Cancel twice',
      '2025-07-21 08:00+00',
      '2025-07-21 09:00+00',
    )
    await owner.query(`SELECT * FROM api.cancel_booking($1, $2)`, [
      booking.id,
      booking.metadata_version,
    ])
    await expectDenied(
      owner.query(`SELECT * FROM api.cancel_booking($1, NULL)`, [booking.id]),
      'SB024',
    )
  })

  it('rejects editing a cancelled booking with SB024', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'cancel-r3')
    const booking = await createBooking(
      owner,
      resource.id,
      'Cancel then edit',
      '2025-07-22 08:00+00',
      '2025-07-22 09:00+00',
    )
    await owner.query(`SELECT * FROM api.cancel_booking($1, $2)`, [
      booking.id,
      booking.metadata_version,
    ])
    await expectDenied(
      owner.query(`SELECT * FROM api.edit_booking($1, $2)`, [
        booking.id,
        'New name',
      ]),
      'SB024',
    )
  })
})

describe('OPS-004 participants and samples', () => {
  it('inserts the caller as owner when no owner is supplied', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'part-r1')
    const { rows } = await owner.query(
      `SELECT * FROM api.create_booking(
        $1, $2, 'With participants', '2025-07-23 08:00+00'::timestamptz,
        '2025-07-23 09:00+00'::timestamptz, 'UTC', 'confirmed',
        false, NULL, NULL, NULL, NULL, NULL,
        '[{"userId":null,"displayName":"Bob","role":"participant"}]'::jsonb,
        '[]'::jsonb)`,
      [WS_A, resource.id],
    )
    const { rows: participants } = await owner.query(
      `SELECT user_id, display_name, role FROM api.calendar_booking_participants WHERE booking_id = $1 ORDER BY role`,
      [rows[0].id],
    )
    expect(participants).toHaveLength(2)
    expect(participants.find((p: any) => p.role === 'owner').user_id).toBe(
      OWNER_A,
    )
  })

  it('rejects a non-sample record linked as a required sample with SB009', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'part-r2')
    // Create an experiment record to misuse as a sample.
    const { rows: expRows } = await owner.query(
      `SELECT * FROM api.create_record($1, 'experiment', 'Exp for sample test', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
      [PROJ_A],
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_booking(
          $1, $2, 'Bad sample', '2025-07-24 08:00+00'::timestamptz,
          '2025-07-24 09:00+00'::timestamptz, 'UTC', 'tentative',
          false, NULL, NULL, NULL, NULL, NULL, '[]'::jsonb,
          $3::jsonb)`,
        [
          WS_A,
          resource.id,
          JSON.stringify([
            { sampleRecordId: expRows[0].id, sampleIdentifier: 'X' },
          ]),
        ],
      ),
      'SB009',
    )
  })
})

describe('OPS-004 RLS isolation', () => {
  it('does not leak bookings across workspaces', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const resourceA = await createResource(ownerA, 'rls-r1')
    await createBooking(
      ownerA,
      resourceA.id,
      'Private to A',
      '2025-07-25 08:00+00',
      '2025-07-25 09:00+00',
    )
    const { rows } = await ownerB.query(
      `SELECT * FROM api.calendar_bookings WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(rows).toHaveLength(0)
  })

  it('rejects a booking referencing another workspace resource', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows: bResource } = await ownerB.query(
      `SELECT * FROM api.create_calendar_resource($1, $2, $3, 'room')`,
      [WS_B, 'B resource', 'b-res'],
    )
    await expectDenied(
      ownerA.query(
        `SELECT * FROM api.create_booking($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [
          WS_A,
          bResource[0].id,
          'Cross-ws',
          '2025-07-26 08:00+00',
          '2025-07-26 09:00+00',
        ],
      ),
      'SB021',
    )
  })
})

describe('OPS-004 change events', () => {
  it('emits a change event for a created booking', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const resource = await createResource(owner, 'event-r1')
    await createBooking(
      owner,
      resource.id,
      'Eventful',
      '2025-07-27 08:00+00',
      '2025-07-27 09:00+00',
    )
    const { rows } = await owner.query(
      `SELECT entity_type, operation FROM api.change_events
       WHERE entity_type = 'calendar_booking' AND workspace_id = $1
       ORDER BY sequence DESC LIMIT 1`,
      [WS_A],
    )
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].operation).toBe('create')
  })
})
