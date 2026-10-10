/**
 * WORK-03.2 — material_expiring, the last of the eight design event types.
 *
 * Nothing emitted an event for a lot approaching expiry, so
 * internal.emit_reagent_expiry_events supplies the producer: one event per reagent lot
 * inside the warning window, idempotent per lot, which the notification trigger turns
 * into the design's "Material lot expiring in 7 days" for the lot's creator.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000080000'
const PROJECT = '00000000-0000-4000-8000-000000080001'
const SOON = '00000000-0000-4000-8000-000000080002'
const LATER = '00000000-0000-4000-8000-000000080003'
const OWNER = 'work032-expiry'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(`insert into api.workspaces(id,slug,name) values($1,'work032e','WORK-03.2')`, [
    WS,
  ])
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'W32','Expiry',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,properties,created_by_user_id)
     values
       ($1,$3,$4,'material','MAT-SOON','Expiring lot','available',
        jsonb_build_object('supplier','Supplier A','lot','L-1',
          'expiry', to_char(current_date + 3, 'YYYY-MM-DD')), $5),
       ($2,$3,$4,'material','MAT-LATER','Distant lot','available',
        jsonb_build_object('supplier','Supplier A','lot','L-2',
          'expiry', to_char(current_date + 400, 'YYYY-MM-DD')), $5)`,
    [SOON, LATER, WS, PROJECT, OWNER],
  )
  // The sweep writes a system event with no actor, exactly as the scheduler does -
  // no claims are set here on purpose.
})

afterAll(async () => {
  await migrator?.end()
})

async function sweep(): Promise<number> {
  const { rows } = await migrator.query<{ result: number }>(
    'select internal.emit_reagent_expiry_events(7) as result',
  )
  return rows[0]!.result
}

describe('WORK-03.2 material expiring notifications', () => {
  it('emits one event for the lot inside the window and notifies its creator', async () => {
    expect(await sweep()).toBe(1)

    const events = await migrator.query<{ entity_uuid: string; payload: Record<string, unknown> }>(
      `select entity_uuid, payload from api.change_events where entity_type='material'`,
    )
    expect(events.rows.map((row) => row.entity_uuid)).toEqual([SOON])
    expect(events.rows[0]!.payload.action).toBe('expiring')

    const notes = await migrator.query<{ user_id: string; event_type: string }>(
      `select user_id, event_type from internal.notifications where event_type='material_expiring'`,
    )
    expect(notes.rows).toEqual([{ user_id: OWNER, event_type: 'material_expiring' }])
  })

  it('does not repeat itself for a lot already warned about', async () => {
    expect(await sweep()).toBe(0)
    const notes = await migrator.query(
      `select id from internal.notifications where event_type='material_expiring'`,
    )
    expect(notes.rows).toHaveLength(1)
  })
})
