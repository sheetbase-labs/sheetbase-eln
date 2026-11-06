/**
 * Webhook events for the lab features (migration 0096).
 *
 * Each state change lands on the change feed with the payload the catalogue
 * expects, and `mapEventType` turns it into the wire name a webhook receives.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f901'
const PROJECT = '00000000-0000-4000-8000-00000000f911'
const OWNER = 'lwe-owner'
const COLLEAGUE = 'lwe-colleague'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

interface FeedRow {
  entity_type: string
  operation: string
  entity_uuid: string
  record_id: string | null
  payload: Record<string, unknown>
}

/** The wire names delivered for every change event of one entity type. */
async function wire(entityType: string, since: bigint): Promise<string[]> {
  const { rows } = await migrator.query<FeedRow>(
    `select entity_type, operation, entity_uuid, record_id, payload
       from api.change_events
      where workspace_id = $1 and entity_type = $2 and sequence > $3
      order by sequence`,
    [WS, entityType, since.toString()],
  )
  return rows.map(
    (row) => mapEventType(row.entity_type, row.operation, row.payload) ?? '-',
  )
}

async function mark(): Promise<bigint> {
  const { rows } = await migrator.query<{ last_seq: string }>(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return BigInt(rows[0]!.last_seq)
}

async function lastPayload(
  entityType: string,
  since: bigint,
): Promise<Record<string, unknown>> {
  const { rows } = await migrator.query<FeedRow>(
    `select payload from api.change_events
      where workspace_id = $1 and entity_type = $2 and sequence > $3
      order by sequence desc limit 1`,
    [WS, entityType, since.toString()],
  )
  return rows[0]!.payload
}

/** Run SQL as the owner, so triggers on raw table writes see an actor. */
async function asOwner(sql: string, params: unknown[] = []) {
  return migrator.query(sql, params)
}

async function material(title: string): Promise<string> {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'material',$2,'available',ARRAY[]::text[],$3::jsonb)`,
    [PROJECT, title, JSON.stringify({ quantity: 2, unit: 'mL', lot: 'L1' })],
  )
  return rows[0].id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, COLLEAGUE]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'lwe','Lab webhook events')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, COLLEAGUE],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'lwe','Lab',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await actor(OWNER)
  await owner.query(
    `select api.create_starter_model('trial','Trial','TRL',null,'[]'::jsonb)`,
  )
  await owner.query(
    `select api.create_starter_model('incident','Incident','INC',null,'[]'::jsonb)`,
  )
  // Raw table writes by the migrator carry the owner's identity too.
  await migrator.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('reagent orders', () => {
  it('says when an order is requested, placed, received and cancelled', async () => {
    const since = await mark()
    const id = await material('Tris buffer')
    const first = (
      await owner.query(
        `select id from api.request_reagent_order($1,5,'mL',null)`,
        [id],
      )
    ).rows[0].id
    await owner.query(`select api.mark_reagent_ordered($1,'PO-1',null,null)`, [
      first,
    ])
    await owner.query(
      `select api.receive_reagent_order($1,'LOT-9','2030-01-01',null)`,
      [first],
    )
    const second = (
      await owner.query(
        `select id from api.request_reagent_order($1,1,'mL',null)`,
        [id],
      )
    ).rows[0].id
    await owner.query(`select api.cancel_reagent_order($1,'changed mind')`, [
      second,
    ])
    const names = (await wire('material', since)).filter((name) =>
      name.startsWith('reagent.'),
    )
    expect(names).toEqual([
      'reagent.order.requested',
      'reagent.order.placed',
      'reagent.order.received',
      'reagent.order.requested',
      'reagent.order.cancelled',
    ])
  })
})

describe('stocktakes', () => {
  it('says when a count is finished, and only then', async () => {
    const since = await mark()
    const scope = '00000000-0000-4000-8000-00000000f921'
    const { rows } = await asOwner(
      `insert into api.stocktakes(workspace_id,number,scope_level,scope_id,scope_name,scope_path)
       values ($1,1,'box',$2,'Box 1','Freezer / Box 1') returning id`,
      [WS, scope],
    )
    await asOwner(
      `update api.stocktakes set status='completed', completed_by=$2, completed_at=now() where id=$1`,
      [rows[0].id, OWNER],
    )
    expect(await wire('stocktake', since)).toEqual(['stocktake.completed'])
    expect(await lastPayload('stocktake', since)).toMatchObject({
      status: 'completed',
      scopeName: 'Box 1',
      number: 1,
    })
  })
})

describe('shipments', () => {
  it('says sent, in transit, received and cancelled by direction', async () => {
    const since = await mark()
    const make = async (direction: string) =>
      (
        await asOwner(
          `insert into api.shipments(workspace_id,number,direction,counterparty,created_by)
           values ($1,(select coalesce(max(number),0)+1 from api.shipments where workspace_id=$1),$2,'Partner lab',$3)
           returning id`,
          [WS, direction, OWNER],
        )
      ).rows[0].id as string
    const setStatus = (id: string, status: string) =>
      asOwner(`update api.shipments set status=$2 where id=$1`, [id, status])
    const out = await make('outbound')
    await setStatus(out, 'in_transit')
    await setStatus(out, 'received')
    const incoming = await make('inbound')
    await setStatus(incoming, 'in_transit')
    await setStatus(incoming, 'cancelled')
    expect(await wire('shipment', since)).toEqual([
      'shipment.sent',
      'shipment.received',
      'shipment.in_transit',
      'shipment.cancelled',
    ])
  })
})

describe('requests', () => {
  it('says when a request is sent and when it is decided', async () => {
    await owner.query(
      `select api.set_request_form('trial', true, null, ARRAY[$1]::text[])`,
      [OWNER],
    )
    const since = await mark()
    const colleague = await actor(COLLEAGUE)
    const request = (
      await colleague.query(
        `select id from api.submit_request('trial','Run a gel',$1::jsonb,null,'please')`,
        ['{}'],
      )
    ).rows[0].id
    await owner.query(`select api.decide_request($1,'accepted',null)`, [
      request,
    ])
    await owner.query(`select api.decide_request($1,'completed','done')`, [
      request,
    ])
    expect(await wire('request', since)).toEqual([
      'request.submitted',
      'request.decided',
      'request.decided',
    ])
    expect(await lastPayload('request', since)).toMatchObject({
      decision: 'completed',
      model: 'trial',
    })
  })
})

describe('legal holds and retention', () => {
  it('says when a hold is placed and released', async () => {
    const since = await mark()
    const hold = (
      await owner.query(
        `select id from api.create_legal_hold('Case 12','Dispute',$1,null,'{}')`,
        [PROJECT],
      )
    ).rows[0].id
    await owner.query(`select api.release_legal_hold($1,'closed')`, [hold])
    const names = await wire('workspace_settings', since)
    expect(names).toContain('legal_hold.created')
    expect(names).toContain('legal_hold.released')
  })

  it('says once how many records retention archived', async () => {
    await owner.query(`select api.set_retention_enabled($1,true)`, [WS])
    await owner.query(`select api.set_retention_rule('trial',1,null)`)
    await owner.query(
      `select api.create_record($1::uuid,'trial','Old run','draft',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT],
    )
    await asOwner(`alter table api.records disable trigger set_updated_at`)
    await asOwner(
      `update api.records set updated_at = now() - interval '3 years' where title = 'Old run'`,
    )
    await asOwner(`alter table api.records enable trigger set_updated_at`)
    const since = await mark()
    const archived = (await owner.query(`select api.apply_retention(null) n`))
      .rows[0].n
    expect(archived).toBeGreaterThan(0)
    const names = await wire('workspace_settings', since)
    expect(names).toEqual(['retention.applied'])
    expect(await lastPayload('workspace_settings', since)).toMatchObject({
      effect: 'retention_applied',
      archived,
    })
  })
})

describe('sample workflows', () => {
  it('says when a sample is enrolled, advanced and taken out', async () => {
    const wf = (
      await asOwner(
        `insert into api.sample_workflows(workspace_id,name,created_by_user_id) values ($1,'Intake',$2) returning id`,
        [WS, OWNER],
      )
    ).rows[0].id
    const stage = (
      await asOwner(
        `insert into api.sample_workflow_stages(workflow_id,workspace_id,position,name) values ($1,$2,1,'Received') returning id`,
        [wf, WS],
      )
    ).rows[0].id
    const sample = (
      await owner.query(
        `select id from api.create_record($1::uuid,'sample','S-1','available',ARRAY[]::text[],'{}'::jsonb)`,
        [PROJECT],
      )
    ).rows[0].id
    const run = (
      await asOwner(
        `insert into api.sample_workflow_runs(workspace_id,workflow_id,record_id,stage_id) values ($1,$2,$3,$4) returning id`,
        [WS, wf, sample, stage],
      )
    ).rows[0].id
    const since = await mark()
    const event = (from: string | null, to: string | null) =>
      asOwner(
        `insert into api.sample_workflow_events(workspace_id,run_id,record_id,from_stage_name,to_stage_name,actor_user_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [WS, run, sample, from, to, OWNER],
      )
    await event(null, 'Received')
    await event('Received', 'Stored')
    await event('Stored', null)
    expect(await wire('sample_workflow_run', since)).toEqual([
      'sample.workflow.enrolled',
      'sample.workflow.advanced',
      'sample.workflow.left',
    ])
    expect(await lastPayload('sample_workflow_run', since)).toMatchObject({
      workflow: 'Intake',
      change: 'left',
    })
  })
})

describe('incidents and registry entries', () => {
  it('says when an incident is reported', async () => {
    await owner.query(`select api.set_model_incident_log('incident', true)`)
    const since = await mark()
    await owner.query(
      `select api.create_record($1::uuid,'incident','Spill in bay 2','draft',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT],
    )
    expect(await wire('incident', since)).toEqual(['incident.reported'])
    expect(await lastPayload('incident', since)).toMatchObject({
      title: 'Spill in bay 2',
      model: 'incident',
    })
  })

  it('says when an entry is added to a registry', async () => {
    await owner.query(
      `select * from api.create_registry_model('strain','Strain','STR',null,$1::jsonb,ARRAY['genotype'],null)`,
      [JSON.stringify([{ field_name: 'genotype', label: 'Genotype' }])],
    )
    const since = await mark()
    await owner.query(
      `select * from api.create_registry_entry($1,'strain','BL21',$2::jsonb,false)`,
      [PROJECT, JSON.stringify({ genotype: 'F- ompT' })],
    )
    expect(await wire('registry_entry', since)).toEqual([
      'registry.entry.created',
    ])
  })
})

describe('instrument limits', () => {
  it('says once when a feed goes out of limits and again when it recovers', async () => {
    const instrument = (
      await owner.query(
        `select id from api.create_instrument($1,'Freezer F-01','other',null,null,null,'Cold room',$2,'{}'::jsonb,0,'none')`,
        [WS, OWNER],
      )
    ).rows[0].id
    const send = (value: number) =>
      owner.query(`select api.record_instrument_readings($1,$2::jsonb)`, [
        instrument,
        JSON.stringify([{ feed: 'Temperature', value, at: new Date() }]),
      ])
    await send(-80)
    const feed = (
      await migrator.query(
        `select id from api.instrument_feeds where instrument_id = $1`,
        [instrument],
      )
    ).rows[0].id
    await owner.query(`select api.set_instrument_feed_limits($1,-90,-70)`, [
      feed,
    ])
    const since = await mark()
    await send(-60)
    await send(-55)
    await send(-82)
    expect(await wire('instrument_feed', since)).toEqual([
      'instrument.reading.out_of_limits',
      'instrument.reading.back_in_range',
    ])
    const events = await migrator.query<FeedRow>(
      `select payload from api.change_events where workspace_id=$1 and entity_type='instrument_feed' and sequence > $2 order by sequence`,
      [WS, since.toString()],
    )
    expect(events.rows[0]!.payload).toMatchObject({
      limitState: 'high',
      instrument: 'Freezer F-01',
      feed: 'Temperature',
    })
  })
})

describe('record assignment', () => {
  it('says when a record is given to someone and taken back', async () => {
    const record = (
      await owner.query(
        `select * from api.create_record($1::uuid,'trial','Assign me','draft',ARRAY[]::text[],'{}'::jsonb)`,
        [PROJECT],
      )
    ).rows[0]
    const since = await mark()
    const assigned = (
      await owner.query(`select * from api.assign_record($1,$2,$3)`, [
        record.id,
        record.metadata_version,
        COLLEAGUE,
      ])
    ).rows[0]
    await owner.query(`select * from api.assign_record($1,$2,null)`, [
      record.id,
      assigned.metadata_version,
    ])
    expect(await wire('record_assignment', since)).toEqual([
      'record.assigned',
      'record.assigned',
    ])
    expect(await lastPayload('record_assignment', since)).toMatchObject({
      assigneeUserId: null,
      previousAssigneeUserId: COLLEAGUE,
    })
  })
})
