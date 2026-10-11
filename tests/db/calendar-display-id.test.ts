/**
 * WORK-04 — calendar bookings get a stable per-workspace CAL-nnnn id.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000130a'
const RESOURCE = '00000000-0000-4000-8000-00000000130b'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'calid-ws', 'CAL id WS')`,
  )
  // ADR-0054: the resource is derived from the registered instrument, so its id
  // IS the instrument id and bookings name the instrument.
  await migrator.query(
    `INSERT INTO api.instruments (id, workspace_id, name, instrument_type) VALUES ('${RESOURCE}', '${WS}', 'Plate reader PR-01', 'qpcr')`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function insertBooking(displayId: string | null) {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.calendar_bookings (workspace_id, resource_id, title, starts_at, ends_at, display_id)
     VALUES ($1, $2, 'Booking', now(), now() + interval '1 hour', $3) RETURNING display_id`,
    [WS, RESOURCE, displayId],
  )
  return rows[0]!.display_id
}

describe('calendar booking display id', () => {
  it('assigns sequential CAL-nnnn ids and keeps an explicit one', async () => {
    expect(await insertBooking(null)).toBe('CAL-0001')
    expect(await insertBooking(null)).toBe('CAL-0002')
    expect(await insertBooking('CAL-0913')).toBe('CAL-0913')
  })
})
