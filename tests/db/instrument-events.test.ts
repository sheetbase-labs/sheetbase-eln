/**
 * Instruments, connectors and parsers on the change feed: each change a
 * webhook, plugin or pipeline can subscribe to leaves a change event that the
 * catalogue maps to its name.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e910'
const OWNER = 'ievt-owner'
const ANALYST = 'ievt-analyst'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client
let analyst: Client
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

/** The wire names of the events an entity left, oldest first. */
async function eventsFor(entityUuid: string, entityType?: string) {
  const { rows } = await migrator.query<{
    entity_type: string
    operation: string
    payload: Record<string, unknown>
  }>(
    `select entity_type, operation, payload from api.change_events
      where entity_uuid = $1 and ($2::text is null or entity_type = $2)
      order by sequence`,
    [entityUuid, entityType ?? null],
  )
  return rows.map((row) =>
    mapEventType(row.entity_type, row.operation, row.payload),
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, ANALYST]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'ievt','Ievt')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'analyst')`,
    [WS, OWNER, ANALYST],
  )
  owner = await actor(OWNER)
  analyst = await actor(ANALYST)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('instrument events', () => {
  it('announces an instrument being added, retired, brought back and taken out of service', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `select id from api.create_instrument($1, 'Events PCR')`,
      [WS],
    )
    const id = rows[0]!.id
    await owner.query(`select api.set_instrument_retired($1, true)`, [id])
    await owner.query(`select api.set_instrument_retired($1, false)`, [id])
    await owner.query(
      `select api.set_instrument_out_of_service($1, true, 'Lamp failed')`,
      [id],
    )
    await owner.query(
      `select api.set_instrument_out_of_service($1, false, null)`,
      [id],
    )
    const names = (await eventsFor(id)).filter((name) =>
      name?.startsWith('instrument.'),
    )
    expect(names).toEqual([
      'instrument.created',
      'instrument.retired',
      'instrument.reinstated',
      'instrument.out_of_service',
      'instrument.back_in_service',
    ])
  })

  it('announces a calibration and leaves the certificate and notes out', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `select id from api.create_instrument($1, 'Calibrated')`,
      [WS],
    )
    const calibration = await owner.query<{ id: string }>(
      `select id from api.record_instrument_calibration($1, now(), now() + interval '6 months', null, 'secret note')`,
      [rows[0]!.id],
    )
    const { rows: events } = await migrator.query(
      `select payload from api.change_events where entity_uuid = $1`,
      [calibration.rows[0]!.id],
    )
    expect(await eventsFor(calibration.rows[0]!.id)).toEqual([
      'instrument.calibrated',
    ])
    expect(JSON.stringify(events[0]!.payload)).not.toContain('secret note')
    expect(events[0]!.payload.instrumentId).toBe(rows[0]!.id)
  })

  it('announces qualifying, a request and a revoked qualification', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `select id from api.create_instrument($1, 'Qualified')`,
      [WS],
    )
    const id = rows[0]!.id
    const request = await analyst.query<{ id: string }>(
      `select id from api.request_instrument_qualification($1, 'please')`,
      [id],
    )
    const granted = await owner.query<{ id: string }>(
      `select id from api.set_instrument_qualification($1, $2, now() + interval '1 year')`,
      [id, ANALYST],
    )
    await owner.query(`select api.revoke_instrument_qualification($1, $2)`, [
      id,
      ANALYST,
    ])
    expect(await eventsFor(request.rows[0]!.id)).toContain(
      'instrument.qualification_requested',
    )
    expect(await eventsFor(granted.rows[0]!.id)).toEqual([
      'instrument.qualification_set',
      'instrument.qualification_revoked',
    ])
  })
})

describe('connector and parser events', () => {
  it('announces a connector and its runs', async () => {
    const connector = await owner.query<{ id: string }>(
      `select id from api.register_connector($1, 'evt-conn', 'Evt connector', 'custom', 'inbound', '{}'::jsonb, null)`,
      [WS],
    )
    const id = connector.rows[0]!.id
    await owner.query(
      `select api.update_connector($1, $2, null, 'paused', null, null, false)`,
      [WS, id],
    )
    await owner.query(
      `select api.update_connector($1, $2, null, 'active', null, null, false)`,
      [WS, id],
    )
    const run = await owner.query<{ id: string }>(
      `select id from api.start_connector_run($1, $2)`,
      [WS, id],
    )
    await owner.query(`select api.complete_connector_run($1, $2)`, [
      WS,
      run.rows[0]!.id,
    ])
    expect(await eventsFor(id, 'connector')).toEqual([
      'connector.created',
      'connector.updated',
      'connector.updated',
    ])
    expect(await eventsFor(run.rows[0]!.id, 'connector_run')).toEqual([
      'connector.run.started',
      'connector.run.completed',
    ])
  })

  it('announces a parser and its versions', async () => {
    await owner.query(
      `select api.create_parser_version($1, 'evt-parser', 'Evt parser', 'csv', 1, '{"headers":["a"]}'::jsonb)`,
      [WS],
    )
    const { rows } = await migrator.query<{ id: string }>(
      `select id from api.parsers where key = 'evt-parser'`,
    )
    const parserId = rows[0]!.id
    expect(await eventsFor(parserId, 'parser')).toEqual(['parser.created'])
    const versions = await migrator.query<{ id: string }>(
      `select id from api.parser_versions where parser_id = $1`,
      [parserId],
    )
    expect(await eventsFor(versions.rows[0]!.id, 'parser_version')).toEqual([
      'parser.version.created',
    ])
  })
})
