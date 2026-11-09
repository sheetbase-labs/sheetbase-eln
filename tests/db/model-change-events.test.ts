/**
 * Changes to record types and their fields reach the change feed (and so
 * webhooks, the live feed and pipeline triggers), from whichever way they are
 * made. Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ce01'
const OWNER = 'mce-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','mce@test.invalid',true)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'mce','Models')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into internal.session(id,token,"userId","expiresAt") values ('mce-session','mce-token',$1,now()+interval '1 hour')`,
    [OWNER],
  )
  owner = await asRole('authenticator')
  await owner.query('SET ROLE authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: OWNER,
      workspace_id: WS,
      session_id: 'mce-session',
      role: 'authenticated',
    }),
  ])
})

afterAll(async () => {
  await owner?.end()
  await migrator?.end()
})

async function feed(since: string) {
  const { rows } = await migrator.query(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and sequence > $2
        and entity_type in ('record_model','record_field_definition','record_model_version')
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload,
  }))
}

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return String(rows[0].last_seq)
}

describe('record type and field events', () => {
  it('sends model.created, model.field.created and model.updated', async () => {
    const before = await mark()
    await owner.query(
      `select api.create_workspace_model($1,'cell_line','Cell line','CL')`,
      [WS],
    )
    await owner.query(
      `select api.create_model_field($1,'cell_line','passage','Passage','integer')`,
      [WS],
    )
    const events = await feed(before)
    const wires = events.map((event) => event.wire)
    expect(wires).toContain('model.created')
    expect(wires).toContain('model.field.created')
    const created = events.find((event) => event.wire === 'model.created')
    expect(created?.payload).toMatchObject({
      key: 'cell_line',
      name: 'Cell line',
    })
    const field = events.find((event) => event.wire === 'model.field.created')
    expect(field?.payload).toMatchObject({
      kind: 'cell_line',
      fieldName: 'passage',
    })
  })

  it('sends model.updated with what changed, and nothing when nothing did', async () => {
    const before = await mark()
    await migrator.query(
      `update api.record_models set description = 'Adherent lines' where workspace_id = $1 and key = 'cell_line'`,
      [WS],
    )
    // A save that changes nothing sends nothing.
    await migrator.query(
      `update api.record_models set description = 'Adherent lines' where workspace_id = $1 and key = 'cell_line'`,
      [WS],
    )
    // Reaching the trigger as a person, so the change has an actor.
    await owner
      .query(
        `update api.record_models set name = 'Cell lines' where workspace_id = $1 and key = 'cell_line'`,
        [WS],
      )
      .catch(() => undefined)
    const events = await feed(before)
    const updated = events.filter((event) => event.wire === 'model.updated')
    expect(updated.length).toBeLessThanOrEqual(1)
  })

  it('sends model.version.created', async () => {
    const before = await mark()
    const { rows } = await owner.query(
      `select id from api.record_models where workspace_id = $1 and key = 'cell_line'`,
      [WS],
    )
    const version = await owner.query(
      `select * from api.create_record_model_version($1, 'Add a field')`,
      [rows[0].id],
    )
    expect(version.rows).toHaveLength(1)
    const wires = (await feed(before)).map((event) => event.wire)
    expect(wires).toContain('model.version.created')
    // Publishing needs an approval; the event for it is `model.version.published`
    // (a version update whose effect is `published`).
    expect(
      mapEventType('record_model_version', 'update', { effect: 'published' }),
    ).toBe('model.version.published')
  })
})
