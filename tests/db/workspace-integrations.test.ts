/**
 * Workspace set-up, join domains, the regulated-lab switch and the other
 * workspace leftovers (migration 20261109170714): the database knows every
 * pipeline action, trigger and webhook name the feature declares, and the
 * switches answer a personal token and emit the change pipelines start on.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'
import { WORKSPACE_EVENTS } from '../../src/features/workspace/events'
import { WORKSPACE_OPERATIONS } from '../../src/features/workspace/operations'
import { pipelineActionsFrom } from '../../src/lib/operations/descriptor'
import { mapEventType } from '../../src/lib/webhook-events'

const WS = '00000000-0000-4000-8000-00000000f901'
const OWNER = 'workspace-int-owner'
const SCIENTIST = 'workspace-int-scientist'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Owner','owner@wsint.example.com',true),
       ($2,'Scientist','sci@wsint.example.com',true)`,
    [OWNER, SCIENTIST],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'ws-int','Workspace')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'scientist')`,
    [WS, OWNER, SCIENTIST],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})))
  await migrator?.end()
})

/** Like a personal token: the person's sub and no browser session. */
async function token(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
      kind: 'personal',
    }),
  ])
  return client
}

async function lastSettingsEvent() {
  const { rows } = await migrator.query<{
    entity_type: string
    operation: string
    payload: Record<string, unknown>
  }>(
    `SELECT entity_type, operation, payload FROM api.change_events
      WHERE workspace_id=$1 AND entity_type='workspace_settings'
      ORDER BY sequence DESC LIMIT 1`,
    [WS],
  )
  const row = rows[0]!
  return mapEventType(row.entity_type, row.operation, row.payload)
}

describe('the database knows what the feature declares', () => {
  it('accepts every workspace pipeline action', async () => {
    for (const action of pipelineActionsFrom(WORKSPACE_OPERATIONS)) {
      const args = Object.fromEntries(
        action.arguments
          .filter((field) => field.required && !field.server)
          .map((field) => [field.name, 'x']),
      )
      const { rows } = await migrator.query<{ errors: unknown[] }>(
        'SELECT internal.pipeline_action_errors($1::jsonb) AS errors',
        [
          JSON.stringify([
            { name: 'step', operation: action.operation, arguments: args },
          ]),
        ],
      )
      expect(rows[0]!.errors, action.operation).toEqual([])
    }
  })

  it('accepts every workspace event as a trigger and a webhook', async () => {
    const { rows } = await migrator.query<{ name: string }>(
      'SELECT name FROM internal.webhook_event_names',
    )
    const known = new Set(rows.map((row) => row.name))
    for (const entry of WORKSPACE_EVENTS) {
      expect(known.has(entry.name), entry.name).toBe(true)
      const normalized = await migrator.query<{ name: string | null }>(
        'SELECT api.normalize_pipeline_event_type($1) AS name',
        [entry.name],
      )
      expect(normalized.rows[0]!.name, entry.name).toBe(entry.name)
    }
  })
})

describe('the workspace switches', () => {
  it('switches the regulated-lab rules for an owner’s token and says so', async () => {
    const owner = await token(OWNER)
    await owner.query('SELECT api.set_regulated_lab($1,true)', [WS])
    expect(await lastSettingsEvent()).toBe('workspace.regulated_lab.changed')
  })

  it('sets join domains for an owner’s token and says so', async () => {
    const owner = await token(OWNER)
    await owner.query(`SELECT api.set_join_domains($1,$2,'viewer')`, [
      WS,
      ['wsint.example.com'],
    ])
    expect(await lastSettingsEvent()).toBe('workspace.join_domains.changed')
    const { rows } = await owner.query<{ domain: string; role: string }>(
      'SELECT domain, role FROM api.workspace_join_domains',
    )
    expect(rows).toEqual([{ domain: 'wsint.example.com', role: 'viewer' }])
  })

  it('keeps the switches for the people who manage them', async () => {
    const scientist = await token(SCIENTIST)
    await expect(
      scientist.query('SELECT api.set_regulated_lab($1,false)', [WS]),
    ).rejects.toThrow()
    await expect(
      scientist.query('SELECT api.set_join_domains($1,$2)', [WS, []]),
    ).rejects.toThrow()
  })

  it('tells a token what its person may do', async () => {
    const owner = await token(OWNER)
    const { rows } = await owner.query<{ caps: string[] }>(
      'SELECT api.list_capabilities($1) AS caps',
      [WS],
    )
    expect(rows[0]!.caps).toContain('workspace.admin')
  })
})
