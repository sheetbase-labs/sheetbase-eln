/**
 * Webhook event names and approvals on the change feed (migration 0036).
 *
 * A subscription may only list names the catalogue emits, and an approval
 * request announces itself and each decision.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  EVENT_CATALOGUE,
  PIPELINE_DELIVERED_EVENTS,
} from '../../src/lib/event-catalogue'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000b351'
const SUBMITTER = 'webhook-names-submitter'
const APPROVER = 'webhook-names-approver'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Submitter','webhook-names-submitter@test.invalid',true),
       ($2,'Approver','webhook-names-approver@test.invalid',true)`,
    [SUBMITTER, APPROVER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'webhook-names','Webhook names')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),
       ($1,$3,'reviewer')`,
    [WS, SUBMITTER, APPROVER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

/** A pending approval the reviewer role is asked to decide. */
async function requestApproval(key: string): Promise<string> {
  const submitter = await actor(SUBMITTER)
  const { rows } = await submitter.query<{
    result: { schema_version_id: string }
  }>(
    `SELECT api.create_dataset_schema_definition($1,$2,'Webhook schema',null,'[]'::jsonb) result`,
    [WS, key],
  )
  const request = await submitter.query<{ id: string }>(
    `SELECT id FROM api.submit_approval_request($1,'dataset_schema_version',$2,ARRAY['reviewer'],'Please approve')`,
    [WS, rows[0]!.result.schema_version_id],
  )
  return request.rows[0]!.id
}

describe('webhook event names', () => {
  const subscribe = (name: string, eventTypes: string[]) =>
    migrator.query(
      `INSERT INTO api.webhook_subscriptions(workspace_id,key,url,event_types,status)
       VALUES ($1,$2,'https://example.com/hook',$3::jsonb,'active')`,
      [WS, name, JSON.stringify(eventTypes)],
    )

  it('accepts every name the catalogue emits, canonical or wire', async () => {
    const names = new Set<string>(PIPELINE_DELIVERED_EVENTS)
    for (const entry of EVENT_CATALOGUE) {
      names.add(entry.name)
      if (entry.wireName) names.add(entry.wireName)
    }
    const { rows } = await migrator.query<{ name: string }>(
      'SELECT name FROM internal.webhook_event_names',
    )
    expect(rows.map((row) => row.name).sort()).toEqual([...names].sort())
  })

  it('takes record.signed and refuses a name nobody emits', async () => {
    await subscribe('signed-copies', ['record.signed', 'sample.received'])
    await expectDenied(subscribe('typo', ['record.signd']), 'SB034')
    await expectDenied(
      migrator.query(
        `UPDATE api.webhook_subscriptions SET event_types = '["nope.never"]'::jsonb WHERE key = 'signed-copies'`,
      ),
      'SB034',
    )
  })
})

describe('approvals on the change feed', () => {
  it('announces a request and each decision', async () => {
    const id = await requestApproval('notify_feed')
    const approver = await actor(APPROVER)
    await approver.query('SELECT api.approve_approval_request($1)', [id])
    const { rows } = await migrator.query<{
      operation: string
      payload: { state: string }
    }>(
      `SELECT operation, payload FROM api.change_events
        WHERE entity_type = 'approval_request' AND entity_uuid = $1
        ORDER BY sequence`,
      [id],
    )
    expect(rows.map((row) => [row.operation, row.payload.state])).toEqual([
      ['create', 'pending'],
      ['update', 'approved'],
    ])
  })
})
