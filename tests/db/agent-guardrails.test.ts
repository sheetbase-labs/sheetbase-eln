/**
 * Agent action permissions, checks and lab watchers.
 *
 * Proves, against a freshly migrated sheetbase_test database:
 *  - an action is Ask by default, and an admin can set Auto or Never for
 *    everyone, one role or one service credential (most specific wins);
 *  - signing, submitting for review, amending, locking and deleting are Never
 *    and cannot be changed;
 *  - a request is refused, left waiting or ready to run depending on the level,
 *    only a signed-in person decides it, and only the one who decided finishes it;
 *  - watchers find low stock and lots about to expire, close findings that stop
 *    being true, and a finding can be dismissed or snoozed.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000a7001'
const PROJ = '00000000-0000-4000-8000-0000000a7002'
const OWNER = 'guard-owner'
const MEMBER = 'guard-member'
const CREDENTIAL = '00000000-0000-4000-8000-0000000a7003'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asUser(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function asCredential(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await setActorJwt(client, '', WS, {
    role: 'api_client',
    sub: null,
    credential_id: CREDENTIAL,
    scopes: ['lab:write'],
  })
  return client
}

const provenance = { agentId: 'test-agent' }

async function request(client: Client, action: string, key: string) {
  const { rows } = await client.query(
    `SELECT * FROM api.request_agent_action($1::uuid, $2, '{"p_quantity":1}'::jsonb, 'Order more', $3::jsonb, $4)`,
    [WS, action, JSON.stringify(provenance), key],
  )
  return rows[0] as Record<string, any>
}

async function level(client: Client, action: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT api.resolve_agent_action_level($1::uuid, $2) AS level`,
    [WS, action],
  )
  return rows[0].level
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'guard-owner@sheetbase.test', true),
      ('${MEMBER}', 'Member', 'guard-member@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'guard7001', 'Guard 7001');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${MEMBER}', 'member');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ}', '${WS}', 'guard7001', 'Guard 7001', '${OWNER}');
     INSERT INTO internal.api_credentials (id, workspace_id, display_prefix, secret_hash, name, scopes, created_by_user_id, kind)
      VALUES ('${CREDENTIAL}', '${WS}', 'guard', 'hash', 'Test agent', ARRAY['lab:write'], '${OWNER}', 'service')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('agent action permissions', () => {
  it('is Ask until an admin says otherwise, and the most specific setting wins', async () => {
    const owner = await asUser(OWNER)
    const member = await asUser(MEMBER)
    expect(await level(member, 'request_reagent_order')).toBe('ask')

    await owner.query(
      `SELECT api.set_agent_action_policy($1::uuid, 'request_reagent_order', 'auto')`,
      [WS],
    )
    expect(await level(member, 'request_reagent_order')).toBe('auto')

    await owner.query(
      `SELECT api.set_agent_action_policy($1::uuid, 'request_reagent_order', 'never', 'role', 'member')`,
      [WS],
    )
    expect(await level(member, 'request_reagent_order')).toBe('never')
    expect(await level(owner, 'request_reagent_order')).toBe('auto')

    const credential = await asCredential()
    expect(await level(credential, 'request_reagent_order')).toBe('auto')
    await owner.query(
      `SELECT api.set_agent_action_policy($1::uuid, 'request_reagent_order', 'ask', 'credential', NULL, $2::uuid)`,
      [WS, CREDENTIAL],
    )
    expect(await level(credential, 'request_reagent_order')).toBe('ask')

    // Back to the default removes the setting.
    await owner.query(
      `SELECT api.set_agent_action_policy($1::uuid, 'request_reagent_order', 'default', 'role', 'member')`,
      [WS],
    )
    await owner.query(
      `SELECT api.set_agent_action_policy($1::uuid, 'request_reagent_order', 'default')`,
      [WS],
    )
    expect(await level(member, 'request_reagent_order')).toBe('ask')
  })

  it('keeps signing, submitting, amending, locking and deleting off', async () => {
    const owner = await asUser(OWNER)
    for (const action of [
      'sign_record',
      'submit_experiment_for_review',
      'amend_record',
      'lock_record',
      'delete_record',
    ]) {
      expect(await level(owner, action)).toBe('never')
      await expectDenied(
        owner.query(
          `SELECT api.set_agent_action_policy($1::uuid, $2, 'auto')`,
          [WS, action],
        ),
        '22023',
      )
    }
    // An ordinary request to send work to the lab is not a review submission.
    expect(await level(owner, 'submit_request')).toBe('ask')
  })

  it('lets only someone who manages the AI settings change them', async () => {
    const member = await asUser(MEMBER)
    await expectDenied(
      member.query(
        `SELECT api.set_agent_action_policy($1::uuid, 'start_stocktake', 'auto')`,
        [WS],
      ),
      '42501',
    )
  })

  it('refuses, holds or readies a request by level; only a person decides it', async () => {
    const owner = await asUser(OWNER)
    const credential = await asCredential()

    const waiting = await request(credential, 'start_stocktake', 'req-ask-1')
    expect(waiting.status).toBe('pending')
    expect(waiting.requested_by_credential_id).toBe(CREDENTIAL)
    // The same key gives back the same request.
    expect((await request(credential, 'start_stocktake', 'req-ask-1')).id).toBe(
      waiting.id,
    )

    const refused = await request(credential, 'delete_record', 'req-never-1')
    expect(refused.status).toBe('refused')

    await expectDenied(
      credential.query(`SELECT api.decide_agent_action($1::uuid, 'approve')`, [
        waiting.id,
      ]),
      '42501',
    )
    const decided = (
      await owner.query(
        `SELECT * FROM api.decide_agent_action($1::uuid, 'approve', 'looks right')`,
        [waiting.id],
      )
    ).rows[0]
    expect(decided.status).toBe('approved')
    expect(decided.decided_by_user_id).toBe(OWNER)

    const member = await asUser(MEMBER)
    await expectDenied(
      member.query(
        `SELECT api.finish_agent_action($1::uuid, true, '{}'::jsonb)`,
        [waiting.id],
      ),
      '42501',
    )
    const done = (
      await owner.query(
        `SELECT * FROM api.finish_agent_action($1::uuid, true, '{"ok":1}'::jsonb)`,
        [waiting.id],
      )
    ).rows[0]
    expect(done.status).toBe('succeeded')

    await owner.query(
      `SELECT api.set_agent_action_policy($1::uuid, 'create_shipment', 'auto', 'credential', NULL, $2::uuid)`,
      [WS, CREDENTIAL],
    )
    const ready = await request(credential, 'create_shipment', 'req-auto-1')
    expect(ready.status).toBe('approved')
    expect(ready.level).toBe('auto')
    const finished = (
      await credential.query(
        `SELECT * FROM api.finish_agent_action($1::uuid, false, NULL, 'nope')`,
        [ready.id],
      )
    ).rows[0]
    expect(finished.status).toBe('failed')
    expect(finished.error).toBe('nope')
  })
})

describe('lab watchers', () => {
  async function material(
    identifier: string,
    properties: Record<string, unknown>,
  ): Promise<string> {
    const { rows } = await migrator.query(
      `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, status, created_by_user_id, properties)
       VALUES ($1, $2, 'material', $3, $3, 'available', $4, $5::jsonb) RETURNING id`,
      [WS, PROJ, identifier, OWNER, JSON.stringify(properties)],
    )
    return rows[0].id
  }

  it('finds low stock and lots about to expire, then closes what is no longer true', async () => {
    const owner = await asUser(OWNER)
    const soon = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const low = await material('MAT-LOW', {
      quantity: 1,
      low_stock_threshold: 3,
      unit: 'units',
    })
    await material('MAT-FULL', { quantity: 10, low_stock_threshold: 3 })
    const expiring = await material('MAT-EXP', { lot: 'L9', expiry: soon })

    const stock = (
      await owner.query(
        `SELECT * FROM api.set_lab_watcher($1::uuid, 'stock_low', true, 'daily')`,
        [WS],
      )
    ).rows[0]
    const expiry = (
      await owner.query(
        `SELECT * FROM api.set_lab_watcher($1::uuid, 'stock_expiring', true, 'daily', NULL, '{"days": 14}'::jsonb)`,
        [WS],
      )
    ).rows[0]
    expect(stock.owner_user_id).toBe(OWNER)

    expect(
      (
        await owner.query(`SELECT api.run_lab_watcher($1::uuid) AS n`, [
          stock.id,
        ])
      ).rows[0].n,
    ).toBe(1)
    expect(
      (
        await owner.query(`SELECT api.run_lab_watcher($1::uuid) AS n`, [
          expiry.id,
        ])
      ).rows[0].n,
    ).toBe(1)
    // Running again finds nothing new.
    expect(
      (
        await owner.query(`SELECT api.run_lab_watcher($1::uuid) AS n`, [
          stock.id,
        ])
      ).rows[0].n,
    ).toBe(0)

    const findings = (
      await owner.query(
        `SELECT * FROM api.lab_watcher_findings WHERE status = 'open' ORDER BY kind`,
      )
    ).rows
    expect(findings.map((f: any) => f.object_id).sort()).toEqual(
      [low, expiring].sort(),
    )
    expect(findings[0].suggested_action.action).toBe('request_reagent_order')

    // They reach the owner's Inbox.
    const inbox = await owner.query(
      `SELECT kind, source_id FROM api.my_work_items WHERE kind = 'watcher_finding'`,
    )
    expect(inbox.rows).toHaveLength(2)

    // Stock arrives: the low-stock finding closes by itself.
    await migrator.query(
      `UPDATE api.records SET properties = properties || '{"quantity": 20}' WHERE id = $1`,
      [low],
    )
    await owner.query(`SELECT api.run_lab_watcher($1::uuid)`, [stock.id])
    const closed = await owner.query(
      `SELECT status FROM api.lab_watcher_findings WHERE object_id = $1`,
      [low],
    )
    expect(closed.rows[0].status).toBe('resolved')
  })

  it('lets the owner dismiss or snooze a finding, and not anyone else', async () => {
    const owner = await asUser(OWNER)
    const member = await asUser(MEMBER)
    const { rows } = await owner.query(
      `SELECT id FROM api.lab_watcher_findings WHERE status = 'open' LIMIT 1`,
    )
    const id = rows[0].id
    await expectDenied(
      member.query(
        `SELECT api.set_watcher_finding_status($1::uuid, 'dismiss')`,
        [id],
      ),
      '42501',
    )
    const snoozed = (
      await owner.query(
        `SELECT * FROM api.set_watcher_finding_status($1::uuid, 'snooze', now() + interval '2 days')`,
        [id],
      )
    ).rows[0]
    expect(snoozed.status).toBe('snoozed')
    const inbox = await owner.query(
      `SELECT 1 FROM api.my_work_items WHERE source_id = $1`,
      [id],
    )
    expect(inbox.rows).toHaveLength(0)
    const dismissed = (
      await owner.query(
        `SELECT * FROM api.set_watcher_finding_status($1::uuid, 'dismiss')`,
        [id],
      )
    ).rows[0]
    expect(dismissed.status).toBe('dismissed')
  })

  it('runs every due watcher from the scheduler', async () => {
    const { rows } = await migrator.query(
      `SELECT internal.run_due_lab_watchers() AS n`,
    )
    expect(rows[0].n).toBeGreaterThanOrEqual(0)
  })
})
