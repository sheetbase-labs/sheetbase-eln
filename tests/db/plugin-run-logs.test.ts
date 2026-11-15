/**
 * The plugin Logs view's table (migration plugin_run_logs): the app keeps each
 * run, administrators read them, nobody else can, nobody can write them from
 * the API, and each plugin keeps only its newest 200 runs from the last 14 days.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ff01'
const EXT = '00000000-0000-4000-8000-00000000ff11'
const ADMIN = 'prl-admin'
const MEMBER = 'prl-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let admin: Client
let member: Client

async function as(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: WS, role: 'authenticated' }),
  ])

  return client
}

async function keep(
  ok = true,
  output: string[] = [],
  error: string | null = null,
) {
  await migrator.query(
    `select internal.record_extension_run($1,$2,'ontology-lookup','operation','search',$3,12,$4,$5::text[])`,
    [WS, EXT, ok, error, output],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const [id, role] of [
    [ADMIN, 'admin'],
    [MEMBER, 'member'],
  ]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [id, `${id}@test.invalid`],
    )

    if (id === ADMIN)
      await migrator.query(
        `insert into api.workspaces(id,slug,name) values ($1,'prl','Run logs')`,
        [WS],
      )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,$3)`,
      [WS, id, role],
    )
  }

  await migrator.query(
    `insert into api.extensions(id,workspace_id,key,name,version,source)
     values ($1,$2,'ontology-lookup','Ontology lookup','1.0.0','test')`,
    [EXT, WS],
  )
  admin = await as(ADMIN)
  member = await as(MEMBER)
})

afterAll(async () => {
  await admin?.end()
  await member?.end()
  await migrator?.end()
})

describe('plugin run logs', () => {
  it('keeps a run with its output and error for administrators only', async () => {
    await keep(false, ['looking up', 'got 0 hits'], 'PluginError: no hits')

    const seen = await admin.query(
      `select ok, error, output, duration_ms from api.extension_run_logs where extension_id=$1`,
      [EXT],
    )

    expect(seen.rows).toEqual([
      {
        ok: false,
        error: 'PluginError: no hits',
        output: ['looking up', 'got 0 hits'],
        duration_ms: 12,
      },
    ])
    const hidden = await member.query(`select 1 from api.extension_run_logs`)
    expect(hidden.rowCount).toBe(0)
  })

  it('cannot be written or called from the API', async () => {
    await expect(
      admin.query(
        `insert into api.extension_run_logs(workspace_id,extension_id,extension_key,kind,entry,ok,duration_ms)
         values ($1,$2,'x','operation','e',true,1)`,
        [WS, EXT],
      ),
    ).rejects.toThrow()
    await expect(
      admin.query(
        `select internal.record_extension_run($1,$2,'x','operation','e',true,1,null,'{}')`,
        [WS, EXT],
      ),
    ).rejects.toThrow()
  })

  it('keeps the newest 200 runs per plugin and drops those older than 14 days', async () => {
    for (let i = 0; i < 205; i++) await keep()

    const { rows } = await migrator.query(
      `select count(*)::int as n from api.extension_run_logs where extension_id=$1`,
      [EXT],
    )

    expect(rows[0].n).toBe(200)

    await migrator.query(
      `update api.extension_run_logs set created_at = now() - interval '15 days'
       where id in (select id from api.extension_run_logs where extension_id=$1 limit 5)`,
      [EXT],
    )
    await keep()

    const after = await migrator.query(
      `select count(*)::int as n from api.extension_run_logs where extension_id=$1`,
      [EXT],
    )

    expect(after.rows[0].n).toBe(196)
  })
})
