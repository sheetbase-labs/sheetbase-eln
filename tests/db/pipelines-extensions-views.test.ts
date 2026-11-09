import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f901'
const OTHER_WS = '00000000-0000-4000-8000-00000000f902'
const STEWARD = 'pipeviews-steward'
const OTHER = 'pipeviews-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Steward','pv-steward@test.invalid',true),
       ($2,'Other','pv-other@test.invalid',true)`,
    [STEWARD, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'pipe-views','Pipes'),($2,'pipe-views-2','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'steward'),($3,$4,'owner')`,
    [WS, STEWARD, OTHER_WS, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.pipeline_definitions(workspace_id,key,name,created_by_user_id) VALUES
       ($1,'mine','Mine',$2),($3,'theirs','Theirs',$4)`,
    [WS, STEWARD, OTHER_WS, OTHER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})))
  await migrator?.end()
})

async function ready() {
  return (
    await migrator.query<{ ok: boolean }>(
      `SELECT internal.reporting_ready() AS ok`,
    )
  ).rows[0]!.ok
}

async function viewName(key: string): Promise<string> {
  return (
    await migrator.query<{ view_name: string }>(
      `SELECT view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1 AND view_key=$2`,
      [WS, key],
    )
  ).rows[0]!.view_name
}

describe('pipeline and plugin views', () => {
  it('registers each view, leaving the scheduler’s cursors out', async () => {
    if (!(await ready())) return
    const names = await migrator.query<{ view_key: string }>(
      `SELECT view_key FROM internal.reporting_fixed_view_names WHERE workspace_id=$1`,
      [WS],
    )
    expect(names.rows.map((r) => r.view_key)).toEqual(
      expect.arrayContaining([
        'pipelines',
        'pipeline_versions',
        'pipeline_runs',
        'pipeline_schedules',
        'pipeline_schedule_activity',
        'pipeline_trigger_failures',
        'plugins',
      ]),
    )
    // pg_attribute, not information_schema: the migrator holds no grant on
    // the view, and information_schema hides what it cannot read.
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT attname AS column_name FROM pg_catalog.pg_attribute
        WHERE attrelid = format('data.%I', $1::text)::regclass AND attnum > 0 AND NOT attisdropped`,
      [await viewName('pipeline_schedules')],
    )
    const listed = columns.rows.map((c) => c.column_name)
    expect(listed).toContain('next_run_at')
    expect(listed).not.toContain('input_watermarks')
    expect(listed).not.toContain('last_evaluated_sequence')
  })

  it('shows a steward login only its own workspace', async () => {
    if (!(await ready())) return
    const steward = await asRole('authenticator')
    clients.push(steward)
    await steward.query('SET ROLE authenticated')
    await steward.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: STEWARD, workspace_id: WS, role: 'authenticated' }),
    ])
    const login = (
      await steward.query<{ username: string; password: string }>(
        'SELECT username, password FROM api.create_sql_login($1,$2,null)',
        [WS, 'Laptop'],
      )
    ).rows[0]!
    const url = new URL(migratorUrl())
    url.username = login.username
    url.password = login.password
    const sql = new Client({ connectionString: url.toString() })
    clients.push(sql)
    await sql.connect()
    const rows = await sql.query<{ name: string }>(
      `SELECT name FROM data.${await viewName('pipelines')}`,
    )
    expect(rows.rows.map((r) => r.name)).toEqual(['Mine'])
  })
})
