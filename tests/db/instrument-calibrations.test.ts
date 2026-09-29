/**
 * LAB-06 — instrument calibration: a workspace writer records when an
 * instrument was calibrated and when it is next due; members read it; viewers
 * and other workspaces cannot write.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000140a'
const WS_B = '00000000-0000-4000-8000-00000000140b'
const OWNER = 'cal-owner'
const VIEWER = 'cal-viewer'
const INSTRUMENT_A = '00000000-0000-4000-8000-00000000141a'
const INSTRUMENT_B = '00000000-0000-4000-8000-00000000141b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','cal-owner@test.invalid',true),($2,'Viewer','cal-viewer@test.invalid',true)`,
    [OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'cal-a','Cal A'),($2,'cal-b','Cal B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($1,$4,'viewer'),($2,$3,'owner')`,
    [WS_A, WS_B, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type) values ($1,$3,'PCR A','qpcr'),($2,$4,'PCR B','qpcr')`,
    [INSTRUMENT_A, INSTRUMENT_B, WS_A, WS_B],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

const recordCalibration = (
  client: Client,
  instrumentId: string,
  performedAt = '2026-09-01T00:00:00Z',
  dueAt = '2027-03-01T00:00:00Z',
) =>
  client.query(
    `select (api.record_instrument_calibration($1,$2::timestamptz,$3::timestamptz)).*`,
    [instrumentId, performedAt, dueAt],
  )

describe('instrument calibrations', () => {
  it('lets a writer record a calibration and members read it', async () => {
    const owner = await actor(OWNER, WS_A)
    const { rows } = await recordCalibration(owner, INSTRUMENT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.instrument_id).toBe(INSTRUMENT_A)
    expect(rows[0]!.performed_by_user_id).toBe(OWNER)
    const read = await owner.query(
      `select 1 from api.instrument_calibrations where id = $1`,
      [rows[0]!.id],
    )
    expect(read.rows).toHaveLength(1)
  })

  it('refuses a due date before the performed date', async () => {
    const owner = await actor(OWNER, WS_A)
    await expect(
      recordCalibration(
        owner,
        INSTRUMENT_A,
        '2026-09-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('denies a viewer', async () => {
    const viewer = await actor(VIEWER, WS_A)
    await expect(recordCalibration(viewer, INSTRUMENT_A)).rejects.toMatchObject(
      { code: '42501' },
    )
  })

  it('denies an instrument in another workspace', async () => {
    const owner = await actor(OWNER, WS_A)
    await expect(recordCalibration(owner, INSTRUMENT_B)).rejects.toMatchObject({
      code: '42501',
    })
  })
})
