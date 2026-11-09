import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f801'
const OTHER_WS = '00000000-0000-4000-8000-00000000f802'
const P1 = '00000000-0000-4000-8000-00000000f811'
const P2 = '00000000-0000-4000-8000-00000000f812'
const STEWARD = 'planviews-steward'
const OTHER = 'planviews-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Steward','plv-steward@test.invalid',true),
       ($2,'Other','plv-other@test.invalid',true)`,
    [STEWARD, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'plan-views','Plan'),($2,'plan-views-2','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'steward'),($3,$4,'owner')`,
    [WS, STEWARD, OTHER_WS, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'pl','Plan'),($3,$4,'po','Other plan')`,
    [P1, WS, P2, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.project_access(workspace_id,project_id,user_id,access_level,project_role,can_view,can_edit,can_review,can_manage,granted_by_user_id) VALUES ($1,$2,$3,'viewer',null,true,false,false,false,$3)`,
    [WS, P1, STEWARD],
  )
  await migrator.query(
    `INSERT INTO api.plate_designs(workspace_id,project_id,name,format,rows,cols) VALUES
       ($1,$2,'Mine','96_well',8,12),($3,$4,'Theirs','96_well',8,12)`,
    [WS, P1, OTHER_WS, P2],
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

describe('planning and reporting views', () => {
  it('registers each view and leaves the rendered report out', async () => {
    if (!(await ready())) return
    const names = await migrator.query<{ view_key: string; view_name: string }>(
      `SELECT view_key, view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1`,
      [WS],
    )
    expect(names.rows.map((r) => r.view_key)).toEqual(
      expect.arrayContaining([
        'studies',
        'study_tasks',
        'study_deliverables',
        'reports',
        'report_generations',
        'plate_designs',
        'analysis_views',
      ]),
    )
    const generations = names.rows.find(
      (r) => r.view_key === 'report_generations',
    )!
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='data' AND table_name=$1`,
      [generations.view_name],
    )
    expect(columns.rows.map((c) => c.column_name)).not.toContain('output_html')
  })

  it('shows a steward login only its own workspace', async () => {
    if (!(await ready())) return
    const steward = await asRole('authenticator')
    clients.push(steward)
    await steward.query('SET ROLE authenticated')
    await steward.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: STEWARD,
        workspace_id: WS,
        role: 'authenticated',
      }),
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
    const name = (
      await migrator.query<{ view_name: string }>(
        `SELECT view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1 AND view_key='plate_designs'`,
        [WS],
      )
    ).rows[0]!.view_name
    const rows = await sql.query<{ name: string }>(
      `SELECT name FROM data.${name}`,
    )
    expect(rows.rows.map((r) => r.name)).toEqual(['Mine'])
  })
})
