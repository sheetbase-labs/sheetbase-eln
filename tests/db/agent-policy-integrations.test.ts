/**
 * Agent permissions away from the app (migration 20261109171939).
 *
 * Proves, against a freshly migrated database:
 *  - away from the app (a personal token, a pipeline run) what agents may do
 *    can only be tightened: an action set to Never, an agent switched off, an
 *    AI feature switched off, an operation policy turned off;
 *  - widening is refused there, and a person in the app still can;
 *  - changes to what agents may do can be asked for but never set to Auto, and
 *    only someone who manages the AI settings approves them, in the app;
 *  - agents switched on or off and workflows land on the change feed;
 *  - service credentials read the agent lists of their own workspace, and the
 *    steward views are built.
 *
 * NOTE: requires a real PostgreSQL database; run via `pnpm test:db`.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000a7101'
const OWNER = 'agentpol-owner'
const MEMBER = 'agentpol-member'
const CREDENTIAL = '00000000-0000-4000-8000-0000000a7103'
const PERSONAL = '00000000-0000-4000-8000-0000000a7104'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let definitionId: string

async function connect(
  role: 'authenticated' | 'api_client',
  claims: Record<string, unknown>,
  userId = '',
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query(`SET ROLE ${role}`)
  await setActorJwt(client, userId, WS, claims)
  return client
}

/** A person signed in to the app. */
const inApp = (userId: string) =>
  connect('authenticated', { session_id: `session-${userId}` }, userId)
/** The same person's personal token: their `sub`, a credential, no session. */
const personalToken = (userId: string) =>
  connect(
    'authenticated',
    { kind: 'personal', credential_id: PERSONAL, scopes: ['lab:write'] },
    userId,
  )
/** A pipeline run: its actor's `sub`, no session and no credential. */
const pipelineRun = (userId: string) => connect('authenticated', {}, userId)
const serviceToken = () =>
  connect('api_client', {
    role: 'api_client',
    sub: null,
    credential_id: CREDENTIAL,
    scopes: ['lab:read', 'lab:write'],
  })

async function setLevel(
  client: Client,
  action: string,
  level: string,
  subject: 'everyone' | 'role' = 'everyone',
  role: string | null = null,
) {
  return client.query(
    `SELECT * FROM api.set_agent_action_policy($1::uuid, $2, $3, $4, $5)`,
    [WS, action, level, subject, role],
  )
}

async function level(client: Client, action: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT api.resolve_agent_action_level($1::uuid, $2) AS level`,
    [WS, action],
  )
  return rows[0].level
}

async function events(entityType: string) {
  const { rows } = await migrator.query(
    `SELECT operation, payload FROM api.change_events
      WHERE workspace_id = $1 AND entity_type = $2 ORDER BY sequence`,
    [WS, entityType],
  )
  return rows as { operation: string; payload: Record<string, unknown> }[]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'agentpol-owner@sheetbase.test', true),
      ('${MEMBER}', 'Member', 'agentpol-member@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'agentpol7101', 'Agent policies');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${MEMBER}', 'member');
     INSERT INTO internal.api_credentials (id, workspace_id, display_prefix, secret_hash, name, scopes, created_by_user_id, kind)
      VALUES ('${CREDENTIAL}', '${WS}', 'agentpol', 'hash', 'Lab agent', ARRAY['lab:write'], '${OWNER}', 'service'),
             ('${PERSONAL}', '${WS}', 'agentpo2', 'hash2', 'My script', ARRAY['lab:write'], '${OWNER}', 'personal');
     INSERT INTO api.workspace_settings (workspace_id, created_by_user_id) VALUES ('${WS}', '${OWNER}') ON CONFLICT DO NOTHING`,
  )
  const { rows } = await migrator.query(
    `INSERT INTO api.agent_definitions (workspace_id, name, trigger_label, owner_user_id)
     VALUES ($1, 'Range checker', 'Any new snapshot', $2) RETURNING id`,
    [WS, OWNER],
  )
  definitionId = rows[0].id
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('what agents may do, away from the app', () => {
  it('tightens from a token or a pipeline, and widens only in the app', async () => {
    const owner = await inApp(OWNER)
    const token = await personalToken(OWNER)
    const pipeline = await pipelineRun(OWNER)

    await setLevel(owner, 'start_stocktake', 'auto')
    expect(await level(owner, 'start_stocktake')).toBe('auto')

    // Down to Ask, then Never: both tighten.
    await setLevel(token, 'start_stocktake', 'ask', 'role', 'member')
    await setLevel(pipeline, 'start_stocktake', 'never')
    expect(await level(owner, 'start_stocktake')).toBe('never')

    // Back up is refused away from the app, including by removing the Never.
    for (const client of [token, pipeline]) {
      await expectDenied(setLevel(client, 'start_stocktake', 'auto'), '42501')
      await expectDenied(setLevel(client, 'start_stocktake', 'ask'), '42501')
      await expectDenied(
        setLevel(client, 'start_stocktake', 'default'),
        '42501',
      )
    }
    // A role with no setting of its own follows everyone: Never. Giving it
    // Ask would widen it.
    await expectDenied(
      setLevel(token, 'start_stocktake', 'ask', 'role', 'scientist'),
      '42501',
    )

    // The person in the app can.
    await setLevel(owner, 'start_stocktake', 'default')
    expect(await level(owner, 'start_stocktake')).toBe('ask')
  })

  it('never lets a change to agent permissions run on its own', async () => {
    const owner = await inApp(OWNER)
    for (const action of [
      'set_agent_action_policy',
      'set_agent_definition_enabled',
      'update_workspace_ai_feature_flags',
    ]) {
      await expectDenied(setLevel(owner, action, 'auto'), '22023')
      expect(await level(owner, action)).toBe('ask')
    }
    // Never is allowed: it only closes the door.
    await setLevel(owner, 'update_workspace_ai_settings', 'never')
    expect(await level(owner, 'update_workspace_ai_settings')).toBe('never')
    await setLevel(owner, 'update_workspace_ai_settings', 'default')
  })

  it('holds a request to widen for someone who manages the AI settings', async () => {
    const member = await inApp(MEMBER)
    const memberToken = await personalToken(MEMBER)
    const owner = await inApp(OWNER)
    const pipeline = await pipelineRun(OWNER)

    const asked = (
      await memberToken.query(
        `SELECT * FROM api.request_agent_action($1::uuid, 'set_agent_action_policy',
           $2::jsonb, 'Let agents start stocktakes', '{"agentId":"t"}'::jsonb, 'widen-1')`,
        [
          WS,
          JSON.stringify({
            p_workspace_id: WS,
            p_action_key: 'start_stocktake',
            p_level: 'auto',
          }),
        ],
      )
    ).rows[0]
    expect(asked.status).toBe('pending')
    expect(asked.level).toBe('ask')

    // The requester cannot approve a change to agent permissions, nor can a
    // token or a pipeline.
    await expectDenied(
      member.query(`SELECT api.decide_agent_action($1::uuid, 'approve')`, [
        asked.id,
      ]),
      '42501',
    )
    await expectDenied(
      pipeline.query(`SELECT api.decide_agent_action($1::uuid, 'approve')`, [
        asked.id,
      ]),
      '42501',
    )
    const approved = (
      await owner.query(
        `SELECT * FROM api.decide_agent_action($1::uuid, 'approve')`,
        [asked.id],
      )
    ).rows[0]
    expect(approved.status).toBe('approved')
  })
})

describe('agents switched on and off', () => {
  it('switches an agent off from a token, and on only in the app', async () => {
    const token = await personalToken(OWNER)
    const owner = await inApp(OWNER)

    const off = (
      await token.query(
        `SELECT * FROM api.set_agent_definition_enabled($1::uuid, false)`,
        [definitionId],
      )
    ).rows[0]
    expect(off.enabled).toBe(false)
    await expectDenied(
      token.query(`SELECT api.set_agent_definition_enabled($1::uuid, true)`, [
        definitionId,
      ]),
      '42501',
    )
    const on = (
      await owner.query(
        `SELECT * FROM api.set_agent_definition_enabled($1::uuid, true)`,
        [definitionId],
      )
    ).rows[0]
    expect(on.enabled).toBe(true)

    const feed = await events('agent_definition')
    expect(feed.map((e) => e.payload.event)).toEqual(['disabled', 'enabled'])
    expect(feed[0].payload).toMatchObject({
      agentId: definitionId,
      displayId: 'AG-0001',
      enabled: false,
    })
  })

  it('turns an operation policy off from a token', async () => {
    const { rows } = await migrator.query(
      `INSERT INTO api.agent_operation_policies
         (workspace_id, name, operation_kind, target_type, credential_id, created_by_user_id, updated_by_user_id)
       VALUES ($1, 'Rows into DS-1', 'dataset_rows.commit', 'workspace', $2, $3, $3) RETURNING id`,
      [WS, CREDENTIAL, OWNER],
    )
    const token = await personalToken(OWNER)
    const off = (
      await token.query(
        `SELECT * FROM api.disable_agent_operation_policy($1::uuid, $2::uuid)`,
        [WS, rows[0].id],
      )
    ).rows[0]
    expect(off.enabled).toBe(false)
    const feed = await events('agent_operation_policy')
    expect(feed.at(-1)?.payload).toMatchObject({
      event: 'disabled',
      operationKind: 'dataset_rows.commit',
    })
    // A member who does not manage agents cannot.
    const member = await personalToken(MEMBER)
    await expectDenied(
      member.query(
        `SELECT api.disable_agent_operation_policy($1::uuid, $2::uuid)`,
        [WS, rows[0].id],
      ),
      '42501',
    )
  })
})

describe('AI switches', () => {
  it('switches a feature off from a token, and on only in the app', async () => {
    const owner = await inApp(OWNER)
    const token = await personalToken(OWNER)
    const service = await serviceToken()
    const flags = async () =>
      (
        await migrator.query(
          `SELECT ai_feature_flags FROM api.workspace_settings WHERE workspace_id = $1`,
          [WS],
        )
      ).rows[0].ai_feature_flags as Record<string, boolean>
    const set = (client: Client, next: Record<string, boolean>) =>
      client.query(
        `SELECT api.update_workspace_ai_feature_flags($1::uuid, $2::jsonb)`,
        [WS, JSON.stringify(next)],
      )

    await set(owner, { ...(await flags()), mcp_lab: true })
    await set(token, { ...(await flags()), mcp_lab: false })
    expect((await flags()).mcp_lab).toBe(false)
    await expectDenied(
      set(token, { ...(await flags()), mcp_lab: true }),
      '42501',
    )
    await expectDenied(
      set(service, { ...(await flags()), mcp_lab: false }),
      '42501',
    )
  })
})

describe('workflows on the change feed', () => {
  it('records a workflow being made and moving on', async () => {
    // Made by a person, as the workflow functions do.
    await migrator.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
    ])
    const { rows } = await migrator.query(
      `INSERT INTO api.agent_workflows
         (workspace_id, goal, plan, plan_digest, provenance, idempotency_key,
          max_operations, max_tokens, max_cost_microusd, created_by_user_id)
       VALUES ($1, 'Tidy the reagent list', '[]'::jsonb, repeat('b', 64), '{}'::jsonb, 'wf-1', 3, 0, 0, $2)
       RETURNING id`,
      [WS, OWNER],
    )
    await migrator.query(
      `UPDATE api.agent_workflows SET status = 'paused' WHERE id = $1`,
      [rows[0].id],
    )
    // A change that leaves the status alone is not news.
    await migrator.query(
      `UPDATE api.agent_workflows SET used_tokens = 10 WHERE id = $1`,
      [rows[0].id],
    )
    const feed = await events('agent_workflow')
    expect(feed.map((e) => [e.operation, e.payload.status])).toEqual([
      ['create', 'waiting_approval'],
      ['update', 'paused'],
    ])
    expect(feed[1].payload.previousStatus).toBe('waiting_approval')
  })
})

describe('reading the agent lists', () => {
  it('lets a service credential read its own workspace’s agents', async () => {
    const service = await serviceToken()
    for (const table of [
      'agent_definitions',
      'agent_runs',
      'agent_policy_revisions',
      'agent_operation_policies',
    ]) {
      await service.query(`SELECT * FROM api.${table}`)
    }
    const { rows } = await service.query(
      `SELECT name FROM api.agent_definitions`,
    )
    expect(rows.map((r) => r.name)).toEqual(['Range checker'])
  })

  it('builds the steward views', async () => {
    await migrator.query(
      `SELECT internal.regenerate_fixed_reporting_views($1::uuid)`,
      [WS],
    )
    const { rows } = await migrator.query(
      `SELECT view_key FROM internal.reporting_fixed_view_names WHERE workspace_id = $1`,
      [WS],
    )
    const keys = rows.map((r) => r.view_key)
    for (const key of [
      'agent_action_policies',
      'agent_action_requests',
      'agents',
      'agent_runs',
      'agent_policy_revisions',
      'agent_operation_policies',
      'agent_proposals',
      'agent_workflows',
      'ai_checks',
    ]) {
      expect(keys).toContain(key)
    }
  })
})
