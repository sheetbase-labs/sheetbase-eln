import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  migratorUrl,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000f601'
const OTHER_WS = '00000000-0000-4000-8000-00000000f602'
const P1 = '00000000-0000-4000-8000-00000000f611'
const P2 = '00000000-0000-4000-8000-00000000f612'
const OTHER_P = '00000000-0000-4000-8000-00000000f613'
const STEWARD = 'data-access-steward'
const MEMBER = 'data-access-member'
const OWNER = 'data-access-owner'
const QA = 'data-access-qa'
const OTHER_OWNER = 'data-access-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
/** SQL login connections; a login allows only a few, so each test closes its own. */
let loginClients: Client[] = []

interface Version {
  id: string
  revision: number
}

interface Login {
  id: string
  username: string
  password: string
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Steward','da-steward@test.invalid',true),
       ($2,'Member','da-member@test.invalid',true),
       ($3,'Owner','da-owner@test.invalid',true),
       ($4,'QA','da-qa@test.invalid',true),
       ($5,'Other owner','da-other@test.invalid',true)`,
    [STEWARD, MEMBER, OWNER, QA, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'data-access','Data access')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'data-access-other','Other')`,
    [OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'member'),($1,$4,'owner'),($1,$5,'reviewer'),($6,$7,'owner')`,
    [WS, STEWARD, MEMBER, OWNER, QA, OTHER_WS, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
       ($1,$3,'visible','Visible project'),($2,$3,'hidden','Hidden project'),
       ($4,$5,'elsewhere','Other workspace project')`,
    [P1, P2, WS, OTHER_P, OTHER_WS],
  )
  for (const userId of [STEWARD, MEMBER, OWNER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: P1,
      userId,
      canManage: userId === OWNER,
    })
  }
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: P2,
    userId: OWNER,
    canManage: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: OTHER_WS,
    projectId: OTHER_P,
    userId: OTHER_OWNER,
    canManage: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => {})))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

function loginUrl(login: { username: string; password: string }): string {
  const url = new URL(migratorUrl())
  url.username = login.username
  url.password = login.password
  return url.toString()
}

async function connectAs(login: {
  username: string
  password: string
}): Promise<Client> {
  const client = new Client({ connectionString: loginUrl(login) })
  loginClients.push(client)
  await client.connect()
  return client
}

async function mint(client: Client, name = 'Laptop', expires: string | null = null) {
  return (
    await client.query<Login>(
      'SELECT id, username, password FROM api.create_sql_login($1,$2,$3)',
      [WS, name, expires],
    )
  ).rows[0]!
}

async function setDataAccessRoles(roles: string[]) {
  const owner = await actor(OWNER)
  await owner.query('SELECT api.update_workspace_data_access_roles($1,$2)', [
    WS,
    roles,
  ])
}

function textField(name: string, label = name, type = 'text') {
  return {
    id: randomUUID(),
    field_name: name,
    label,
    logical_type: type,
    nullable: true,
    display_order: 0,
    lifecycle: 'active',
    validation: {},
    default_value: null,
    cardinality: 'one',
    options: [],
  }
}

async function publishSubtype(
  author: Client,
  parent: string,
  key: string,
  prefix: string,
  fields: unknown[],
) {
  const model = (
    await author.query<{ id: string }>(
      'SELECT * FROM api.create_model_subtype($1,$2,$3,$3,$4,null)',
      [WS, parent, key, prefix],
    )
  ).rows[0]!
  const initial = (
    await author.query<Version>(
      'SELECT * FROM api.create_record_model_version($1,$2)',
      [model.id, 'Define fields'],
    )
  ).rows[0]!
  const saved = (
    await author.query<Version>(
      'SELECT * FROM api.replace_record_model_version_definition($1,$2,$3,$4)',
      [
        initial.id,
        initial.revision,
        JSON.stringify({ fields, migrationScope: 'new-records-only' }),
        'Define fields',
      ],
    )
  ).rows[0]!
  const request = (
    await author.query<{ id: string }>(
      `SELECT id FROM api.submit_approval_request($1,'record_model_version',$2,
        ARRAY['owner','reviewer'],'Review subtype',true,2,$3)`,
      [WS, saved.id, saved.revision],
    )
  ).rows[0]!
  for (const reviewer of [QA, OWNER]) {
    const client = await actor(reviewer)
    await client.query('SELECT api.approve_approval_request($1)', [request.id])
  }
  await author.query('SELECT api.publish_record_model_version($1)', [saved.id])
  return model
}

async function experiment(client: Client, project: string, title: string) {
  return (
    await client.query<{ id: string }>(
      `SELECT * FROM api.create_model_record($1,'experiment',$2,'draft','{}','{}','{}')`,
      [project, title],
    )
  ).rows[0]!
}

describe('data access setting', () => {
  it('gives stewards data access by default, and nobody else', async () => {
    const results: Record<string, boolean> = {}
    for (const user of [STEWARD, MEMBER, OWNER, QA]) {
      const client = await actor(user)
      results[user] = (
        await client.query<{ ok: boolean }>('SELECT api.has_data_access() AS ok')
      ).rows[0]!.ok
    }
    expect(results).toEqual({
      [STEWARD]: true,
      [MEMBER]: false,
      [OWNER]: false,
      [QA]: false,
    })
  })

  it('lets an owner choose the roles, and nobody else', async () => {
    const steward = await actor(STEWARD)
    await expectDenied(
      steward.query('SELECT api.update_workspace_data_access_roles($1,$2)', [
        WS,
        ['steward', 'member'],
      ]),
      '42501',
    )
    const owner = await actor(OWNER)
    for (const roles of [['client_viewer'], ['steward', 'janitor'], [null]]) {
      await expect(
        owner.query('SELECT api.update_workspace_data_access_roles($1,$2)', [
          WS,
          roles,
        ]),
      ).rejects.toMatchObject({ code: '22023' })
    }
    const updated = await owner.query<{ data_access_roles: string[] }>(
      'SELECT data_access_roles FROM api.update_workspace_data_access_roles($1,$2)',
      [WS, ['steward', 'member', 'steward']],
    )
    expect(updated.rows[0]!.data_access_roles).toEqual(['member', 'steward'])
    const member = await actor(MEMBER)
    expect(
      (await member.query('SELECT api.has_data_access() AS ok')).rows[0].ok,
    ).toBe(true)
    await setDataAccessRoles(['steward'])
    expect(
      (await member.query('SELECT api.has_data_access() AS ok')).rows[0].ok,
    ).toBe(false)
  })

  it('refuses a client_viewer outright at the table', async () => {
    await expect(
      migrator.query(
        `UPDATE api.workspace_settings SET data_access_roles = ARRAY['client_viewer'] WHERE workspace_id = $1`,
        [WS],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('reporting views', () => {
  it('names a view and typed columns for every model, only for data-access members', async () => {
    const owner = await actor(OWNER)
    await owner.query(
      `SELECT api.create_and_activate_model_field($1,'experiment','harvest_day','Harvest day','integer',true,null,'{}')`,
      [WS],
    )
    const author = await actor(STEWARD)
    await publishSubtype(author, 'experiment', 'cell_culture', 'CCX', [
      textField('cell_line', 'Cell line'),
      textField('seeding_density', 'Seeding density', 'decimal'),
    ])
    await publishSubtype(author, 'cell_culture', 'perfusion_culture', 'PFX', [
      textField('perfusion_rate', 'Perfusion rate'),
    ])

    const models = await author.query<{
      model_key: string
      view_name: string
      kind: string
      parent_key: string | null
    }>('SELECT * FROM api.reporting_models()')
    const byKey = Object.fromEntries(models.rows.map((m) => [m.model_key, m]))
    expect(byKey.experiment).toMatchObject({
      view_name: 'experiments',
      kind: 'built_in',
    })
    expect(byKey.project?.view_name).toBe('projects')
    expect(byKey.cell_culture).toMatchObject({
      view_name: 'cell_culture',
      kind: 'record_type',
      parent_key: 'experiment',
    })
    expect(byKey.perfusion_culture?.parent_key).toBe('cell_culture')

    const columns = await author.query<{
      model_key: string
      field_key: string
      column_name: string
      sql_type: string
    }>('SELECT * FROM api.reporting_columns()')
    const cols = (model: string) =>
      Object.fromEntries(
        columns.rows
          .filter((c) => c.model_key === model)
          .map((c) => [c.field_key, `${c.column_name}:${c.sql_type}`]),
      )
    expect(cols('experiment')).toEqual({ harvest_day: 'harvest_day:bigint' })
    expect(cols('cell_culture')).toEqual({
      harvest_day: 'harvest_day:bigint',
      cell_line: 'cell_line:text',
      seeding_density: 'seeding_density:numeric',
    })
    expect(Object.keys(cols('perfusion_culture')).sort()).toEqual([
      'cell_line',
      'harvest_day',
      'perfusion_rate',
      'seeding_density',
    ])

    const member = await actor(MEMBER)
    expect((await member.query('SELECT * FROM api.reporting_models()')).rows).toEqual([])
    expect((await member.query('SELECT * FROM api.reporting_columns()')).rows).toEqual([])
  })

  it('rebuilds a view when a field is added, and keeps names stable', async () => {
    const before = await migrator.query(
      `SELECT view_name FROM internal.reporting_views WHERE workspace_id=$1 AND model_key='experiment'`,
      [WS],
    )
    const owner = await actor(OWNER)
    await owner.query(
      `SELECT api.create_and_activate_model_field($1,'experiment','run_note','Run note','text',true,null,'{}')`,
      [WS],
    )
    const after = await migrator.query(
      `SELECT view_name FROM internal.reporting_views WHERE workspace_id=$1 AND model_key='experiment'`,
      [WS],
    )
    expect(after.rows).toEqual(before.rows)
    const column = await migrator.query(
      `SELECT 1 FROM pg_attribute
        WHERE attrelid = 'reporting.experiments'::regclass AND attname = 'run_note'`,
    )
    expect(column.rowCount).toBe(1)
  })

  it('gives a second workspace its own, suffixed names', async () => {
    const rows = await migrator.query<{ view_name: string }>(
      `SELECT view_name FROM internal.reporting_views WHERE workspace_id=$1 AND model_key='experiment'`,
      [OTHER_WS],
    )
    expect(rows.rows[0]!.view_name).toMatch(/^experiments_[0-9a-f]{6}$/)
  })
})

describe('SQL logins', () => {
  afterEach(async () => {
    await Promise.all(loginClients.map((c) => c.end().catch(() => {})))
    loginClients = []
  })

  let mine: Login
  let expectedIds: string[]
  let hiddenId: string

  beforeAll(async () => {
    const steward = await actor(STEWARD)
    const owner = await actor(OWNER)
    const author = await actor(STEWARD)
    const rows = []
    for (const title of ['One', 'Two']) rows.push(await experiment(author, P1, title))
    expectedIds = rows.map((r) => r.id).sort()
    hiddenId = (await experiment(owner, P2, 'Hidden')).id
    await experiment(await actor(OTHER_OWNER, OTHER_WS), OTHER_P, 'Elsewhere')
    const typed = await experiment(author, P1, 'Typed')
    await author.query(
      `SELECT api.set_model_type('records',$1,'cell_culture',$2)`,
      [typed.id, JSON.stringify({ harvest_day: 6, cell_line: 'CHO-K1' })],
    )
    mine = await mint(steward)
  })

  it('reads exactly what the member reads through the API', async () => {
    const login = await connectAs(mine)
    const seen = await login.query<{ id: string }>(
      'SELECT id FROM reporting.experiments ORDER BY id',
    )
    const steward = await actor(STEWARD)
    const viaApi = await steward.query<{ id: string }>(
      `SELECT id FROM api.records WHERE kind='experiment' AND deleted_at IS NULL ORDER BY id`,
    )
    expect(seen.rows.map((r) => r.id)).toEqual(viaApi.rows.map((r) => r.id))
    expect(seen.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining(expectedIds),
    )
    expect(seen.rows.map((r) => r.id)).not.toContain(hiddenId)
    const projects = await login.query<{ project_key: string }>(
      'SELECT DISTINCT project_key FROM reporting.experiments',
    )
    expect(projects.rows.map((r) => r.project_key)).toEqual(['visible'])
  })

  it('types the columns and narrows subtype views', async () => {
    const login = await connectAs(mine)
    const typed = await login.query<{
      title: string
      harvest_day: string
      cell_line: string
    }>('SELECT title, harvest_day, cell_line FROM reporting.cell_culture')
    expect(typed.rows).toEqual([
      { title: 'Typed', harvest_day: '6', cell_line: 'CHO-K1' },
    ])
    const perfusion = await login.query('SELECT 1 FROM reporting.perfusion_culture')
    expect(perfusion.rowCount).toBe(0)
    const type = await login.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='reporting' AND table_name='cell_culture' AND column_name='seeding_density'`,
    )
    expect(type.rows[0]!.data_type).toBe('numeric')
  })

  it('cannot write, create, or read any other schema', async () => {
    const login = await connectAs(mine)
    await expect(
      login.query('INSERT INTO reporting.experiments(id) VALUES (gen_random_uuid())'),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      login.query(`UPDATE reporting.experiments SET title = 'x'`),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(login.query('SELECT * FROM api.records')).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      login.query('SELECT * FROM internal.sql_logins'),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(login.query('SELECT api.claim_probe()')).rejects.toMatchObject({
      code: '42501',
    })
    await expect(login.query('SET ROLE authenticated')).rejects.toMatchObject({
      code: '42501',
    })
    await expect(login.query('SET ROLE reporting_owner')).rejects.toMatchObject({
      code: '42501',
    })
    await login.query('SET default_transaction_read_only = off')
    await expect(
      login.query('CREATE TABLE public.sneaky(a int)'),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      login.query('CREATE TABLE reporting.sneaky(a int)'),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      login.query('CREATE FUNCTION public.sneaky() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('cannot claim to be someone else', async () => {
    const login = await connectAs(mine)
    const before = await login.query('SELECT id FROM reporting.experiments')
    await login.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
    ])
    const after = await login.query('SELECT id FROM reporting.experiments')
    expect(after.rows.map((r) => r.id).sort()).toEqual(
      before.rows.map((r) => r.id).sort(),
    )
    expect(after.rows.map((r) => r.id)).not.toContain(hiddenId)
    await login.query(`RESET request.jwt.claims`)
  })

  it('never sees another workspace', async () => {
    const login = await connectAs(mine)
    const names = await login.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views
        WHERE table_schema='reporting' AND table_name ~ '^experiments_[0-9a-f]{6}$'`,
    )
    for (const { table_name } of names.rows) {
      const rows = await login.query(`SELECT 1 FROM reporting.${table_name}`)
      expect(rows.rowCount).toBe(0)
    }
  })

  it('is limited to members with data access', async () => {
    const member = await actor(MEMBER)
    await expectDenied(
      member.query('SELECT * FROM api.create_sql_login($1,$2,null)', [WS, 'Nope']),
      '42501',
    )
    const steward = await actor(STEWARD)
    await expectDenied(
      steward.query('SELECT * FROM api.create_sql_login($1,$2,null)', [WS, '  ']),
      '22023',
    )
    await expectDenied(
      steward.query(
        `SELECT * FROM api.create_sql_login($1,$2,now() + interval '2 years')`,
        [WS, 'Too long'],
      ),
      '22023',
    )
    await expectDenied(
      steward.query(
        `SELECT * FROM api.create_sql_login($1,$2,now() - interval '1 day')`,
        [WS, 'Past'],
      ),
      '22023',
    )
  })

  it('lists a member their own logins and an owner everyone\'s, without secrets', async () => {
    const steward = await actor(STEWARD)
    const own = await steward.query<Record<string, unknown>>(
      'SELECT * FROM api.list_sql_logins($1)',
      [WS],
    )
    expect(own.rows.length).toBeGreaterThan(0)
    expect(own.rows.every((r) => r.user_id === STEWARD)).toBe(true)
    expect(Object.keys(own.rows[0]!)).not.toContain('password')
    const owner = await actor(OWNER)
    const all = await owner.query('SELECT * FROM api.list_sql_logins($1)', [WS])
    expect(all.rows.length).toBe(own.rows.length)
    const member = await actor(MEMBER)
    expect((await member.query('SELECT * FROM api.list_sql_logins($1)', [WS])).rows).toEqual([])
  })

  it('records creation and revocation in the activity stream', async () => {
    const events = await migrator.query<{ operation: string; payload: Record<string, unknown> }>(
      `SELECT operation, payload FROM api.change_events
        WHERE workspace_id=$1 AND entity_type='api_credential' AND payload->>'kind'='sql_login'
        ORDER BY sequence`,
      [WS],
    )
    expect(events.rows.some((e) => e.operation === 'create')).toBe(true)
    expect(JSON.stringify(events.rows)).not.toContain(mine.password)
  })

  it('rotates the password, and the old one stops working', async () => {
    const steward = await actor(STEWARD)
    const login = await mint(steward, 'To rotate')
    const rotated = (
      await steward.query<Login>(
        'SELECT id, username, password FROM api.rotate_sql_login($1,$2)',
        [WS, login.id],
      )
    ).rows[0]!
    expect(rotated.username).toBe(login.username)
    expect(rotated.password).not.toBe(login.password)
    await expect(connectAs(login)).rejects.toMatchObject({ code: '28P01' })
    const client = await connectAs(rotated)
    expect((await client.query('SELECT 1 AS ok')).rows[0].ok).toBe(1)
    const member = await actor(MEMBER)
    await expectDenied(
      member.query('SELECT * FROM api.rotate_sql_login($1,$2)', [WS, login.id]),
      '42501',
    )
  })

  it('fails once revoked, including a connection that is already open', async () => {
    const steward = await actor(STEWARD)
    const login = await mint(steward, 'To revoke')
    const open = await connectAs(login)
    expect((await open.query('SELECT count(*) FROM reporting.experiments')).rowCount).toBe(1)
    await steward.query('SELECT api.revoke_sql_login($1,$2)', [WS, login.id])
    await expect(open.query('SELECT count(*) FROM reporting.experiments')).rejects.toBeDefined()
    await expect(connectAs(login)).rejects.toBeDefined()
    const status = await steward.query<{ status: string }>(
      'SELECT status FROM api.list_sql_logins($1) WHERE id=$2',
      [WS, login.id],
    )
    expect(status.rows[0]!.status).toBe('revoked')
  })

  it('lets an owner revoke someone else\'s login, but not a member', async () => {
    const steward = await actor(STEWARD)
    const login = await mint(steward, 'Owner revokes')
    const member = await actor(MEMBER)
    await expectDenied(
      member.query('SELECT api.revoke_sql_login($1,$2)', [WS, login.id]),
      'SB127',
    )
    const owner = await actor(OWNER)
    await owner.query('SELECT api.revoke_sql_login($1,$2)', [WS, login.id])
    await expect(connectAs(login)).rejects.toBeDefined()
  })

  it('fails once the login expires', async () => {
    const steward = await actor(STEWARD)
    const login = await mint(steward, 'Expires', new Date(Date.now() + 3_600_000).toISOString())
    const open = await connectAs(login)
    await open.query('SELECT 1')
    await migrator.query(
      `UPDATE internal.sql_logins SET expires_at = now() - interval '1 second' WHERE id=$1`,
      [login.id],
    )
    await expect(open.query('SELECT count(*) FROM reporting.experiments')).rejects.toMatchObject({
      code: '28000',
    })
  })

  it('fails when its member\'s role loses data access, and works again when it returns', async () => {
    const login = await connectAs(mine)
    await login.query('SELECT count(*) FROM reporting.experiments')
    await setDataAccessRoles(['member'])
    await expect(login.query('SELECT count(*) FROM reporting.experiments')).rejects.toMatchObject({
      code: '28000',
    })
    const steward = await actor(STEWARD)
    expect(
      (await steward.query('SELECT api.has_data_access() AS ok')).rows[0].ok,
    ).toBe(false)
    await expectDenied(
      steward.query('SELECT * FROM api.create_sql_login($1,$2,null)', [WS, 'Again']),
      '42501',
    )
    await setDataAccessRoles(['steward'])
    const again = await connectAs(mine)
    await again.query('SELECT count(*) FROM reporting.experiments')
  })

  it('fails when its member is suspended', async () => {
    const login = await connectAs(mine)
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at = now() WHERE workspace_id=$1 AND user_id=$2`,
      [WS, STEWARD],
    )
    await expect(login.query('SELECT count(*) FROM reporting.experiments')).rejects.toMatchObject({
      code: '28000',
    })
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at = NULL WHERE workspace_id=$1 AND user_id=$2`,
      [WS, STEWARD],
    )
  })

  it('caps active logins per member and removes the Postgres role with its record', async () => {
    const steward = await actor(STEWARD)
    const minted: Login[] = []
    for (let i = 0; i < 10; i += 1) {
      try {
        minted.push(await mint(steward, `Cap ${i}`))
      } catch (error) {
        expect(error).toMatchObject({ code: 'SB126' })
        break
      }
    }
    expect(minted.length).toBeLessThan(10)
    const target = minted[0]!
    await migrator.query('DELETE FROM internal.sql_logins WHERE id=$1', [target.id])
    const role = await migrator.query(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [
      target.username,
    ])
    expect(role.rowCount).toBe(0)
  })
})
