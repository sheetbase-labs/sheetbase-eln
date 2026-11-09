import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'
import { PROJECTS_EVENTS } from '../../src/features/projects/events'
import { PROJECTS_OPERATIONS } from '../../src/features/projects/operations'
import { pipelineActionsFrom } from '../../src/lib/operations/descriptor'
import { PIPELINE_TRIGGER_EVENTS } from '../../src/lib/pipeline-schedule'

const WS = '00000000-0000-4000-8000-00000000f801'
const P1 = '00000000-0000-4000-8000-00000000f811'
const P2 = '00000000-0000-4000-8000-00000000f812'
const R1 = '00000000-0000-4000-8000-00000000f821'
const OWNER = 'projects-owner'
const SCIENTIST = 'projects-scientist'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Owner','pi-owner@test.invalid',true),
       ($2,'Scientist','pi-sci@test.invalid',true)`,
    [OWNER, SCIENTIST],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'projects-int','Projects')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'scientist')`,
    [WS, OWNER, SCIENTIST],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
       ($1,$3,'pi-1','First'),($2,$3,'pi-2','Second')`,
    [P1, P2, WS],
  )
  await migrator.query(
    `INSERT INTO api.project_access(workspace_id,project_id,user_id,access_level,granted_by_user_id,can_view,can_edit,can_review,can_manage)
     VALUES ($1,$2,$4,'owner',$4,true,true,true,true),($1,$3,$4,'owner',$4,true,true,true,true)`,
    [WS, P1, P2, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES ($1,$2,$3,'experiment','PI-1','A note',$4)`,
    [R1, WS, P1, OWNER],
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

async function events(entityType: string) {
  return (
    await migrator.query<{
      operation: string
      payload: Record<string, unknown>
    }>(
      `SELECT operation, payload FROM api.change_events
        WHERE workspace_id=$1 AND entity_type=$2 ORDER BY sequence`,
      [WS, entityType],
    )
  ).rows
}

describe('records that move', () => {
  it('says move when a record goes into a folder', async () => {
    const owner = await token(OWNER)
    const folder = (
      await owner.query<{ id: string }>(
        'SELECT id FROM api.create_project_folder($1,$2,null)',
        [P1, 'Assays'],
      )
    ).rows[0]!
    const moved = await owner.query<{ n: number }>(
      'SELECT api.move_records_to_folder($1,$2,$3) AS n',
      [P1, [R1], folder.id],
    )
    expect(moved.rows[0]!.n).toBe(1)
    const recordEvents = await events('record')
    expect(recordEvents.at(-1)!.operation).toBe('move')
    expect((await events('folder')).map((e) => e.operation)).toContain('create')
  })

  it('says move, with where it came from, when a record changes project', async () => {
    const owner = await token(OWNER)
    const version = (
      await migrator.query<{ v: number }>(
        'SELECT metadata_version AS v FROM api.records WHERE id=$1',
        [R1],
      )
    ).rows[0]!.v
    await owner.query('SELECT api.move_record_to_project($1,$2,$3)', [
      R1,
      P2,
      version,
    ])
    const moves = (await events('record')).filter((e) => e.operation === 'move')
    expect(moves.at(-1)!.payload.fromProjectId).toBe(P1)
  })

  it('still says archive when a record is archived', async () => {
    const owner = await token(OWNER)
    const version = (
      await migrator.query<{ v: number }>(
        'SELECT metadata_version AS v FROM api.records WHERE id=$1',
        [R1],
      )
    ).rows[0]!.v
    await owner.query('SELECT api.archive_record($1,$2)', [R1, version])
    const ops = (await events('record')).map((e) => e.operation)
    expect(ops).toContain('archive')
    expect(ops.at(-1)).not.toBe('move')
  })
})

describe('the audit log for personal tokens', () => {
  it('answers a personal token, which has no browser session', async () => {
    const owner = await token(OWNER)
    const page = (
      await owner.query<{ page: { events: unknown[]; hasMore: boolean } }>(
        'SELECT api.audit_events(p_limit => 5) AS page',
      )
    ).rows[0]!.page
    expect(page.events.length).toBeGreaterThan(0)
  })

  it('still refuses a service credential', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE api_client')
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        workspace_id: WS,
        role: 'api_client',
        credential_id: '00000000-0000-4000-8000-00000000f8fe',
      }),
    ])
    await expect(client.query('SELECT api.audit_events()')).rejects.toThrow()
  })

  it('records an audit check as an entry other people can react to', async () => {
    const owner = await token(OWNER)
    const result = (
      await owner.query<{ r: { ok: boolean } }>(
        'SELECT api.run_audit_verification($1) AS r',
        [WS],
      )
    ).rows[0]!.r
    expect(result.ok).toBe(true)
    const system = await events('system')
    expect(system.at(-1)!.payload).toMatchObject({ ok: true })
  })

  it('keeps the audit check for people who manage audit settings', async () => {
    const scientist = await token(SCIENTIST)
    await expect(
      scientist.query('SELECT api.run_audit_verification($1)', [WS]),
    ).rejects.toThrow()
  })
})

describe('agents and folders', () => {
  it('lets agents delete a folder, but still not a record', async () => {
    const rows = await migrator.query<{ f: boolean; g: boolean; r: boolean }>(
      `SELECT internal.agent_action_always_never('delete_project_folder') AS f,
              internal.agent_action_always_never('delete_workspace_group') AS g,
              internal.agent_action_always_never('delete_record') AS r`,
    )
    expect(rows.rows[0]).toEqual({ f: false, g: false, r: true })
  })
})

describe('steward views', () => {
  it('registers the folder, follow, trail and audit log views', async () => {
    const ready = (
      await migrator.query<{ ok: boolean }>(
        'SELECT internal.reporting_ready() AS ok',
      )
    ).rows[0]!.ok
    if (!ready) return
    const names = await migrator.query<{ view_key: string; view_name: string }>(
      `SELECT view_key, view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1`,
      [WS],
    )
    const keys = names.rows.map((row) => row.view_key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'folders',
        'folder_items',
        'project_follows',
        'trail_evidence',
        'audit_log',
      ]),
    )
    const audit = names.rows.find((row) => row.view_key === 'audit_log')!
    const columns = await migrator.query<{ column_name: string }>(
      // information_schema hides columns the reader has no rights on.
      `SELECT attname AS column_name FROM pg_attribute
        WHERE attrelid = format('data.%I', $1::text)::regclass AND attnum > 0 AND NOT attisdropped`,
      [audit.view_name],
    )
    const list = columns.rows.map((row) => row.column_name)
    expect(list).toContain('entry_hash')
    expect(list).not.toContain('payload')
  })
})

describe('the database knows what the feature declares', () => {
  it('accepts every projects pipeline action', async () => {
    for (const action of pipelineActionsFrom(PROJECTS_OPERATIONS)) {
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

  it('accepts every projects event pipelines may start on', async () => {
    const names = [
      ...PROJECTS_EVENTS.map((entry) => entry.name),
      'project.created',
      'project.archived',
    ].filter((name) => PIPELINE_TRIGGER_EVENTS.includes(name))
    expect(names.length).toBeGreaterThan(5)
    for (const name of names) {
      const { rows } = await migrator.query<{ name: string | null }>(
        'SELECT api.normalize_pipeline_event_type($1) AS name',
        [name],
      )
      expect(rows[0]!.name, name).toBe(name)
    }
  })

  it('has a webhook name for each projects event', async () => {
    const { rows } = await migrator.query<{ name: string }>(
      'SELECT name FROM internal.webhook_event_names',
    )
    const known = new Set(rows.map((row) => row.name))
    for (const entry of PROJECTS_EVENTS)
      expect(known.has(entry.name), entry.name).toBe(true)
  })
})
