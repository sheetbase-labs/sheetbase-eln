/**
 * What plugin hooks leave behind, against real Postgres: flags and sign-offs
 * (roles, independence, counts, reopening), summaries, search entries ranked by
 * words or vectors, the plugin_flag gate condition, and who can see what.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prepareTestDatabase } from './helpers'

const WS = '0e050000-0000-4000-8000-0000000000f1'
const OTHER_WS = '0e050000-0000-4000-8000-0000000000f2'
const PROJECT = '0e050000-0000-4000-8000-0000000000f3'
const RECORD = '0e050000-0000-4000-8000-0000000000f4'
const RECORD_B = '0e050000-0000-4000-8000-0000000000f5'
const OWNER = 'rh-owner'
const MEMBER = 'rh-member'
const REVIEWER = 'rh-reviewer'
const REVIEWER_2 = 'rh-reviewer-2'
const STRANGER = 'rh-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: userId, workspace_id: workspace }),
  ])
  return client
}

async function raise(
  key: string,
  kind: 'flag' | 'sign_off',
  extra: { roles?: string[]; approvals?: number; independent?: boolean; by?: string; record?: string } = {},
) {
  const { rows } = await migrator.query(
    `select * from internal.plugin_raise_flag($1,'lab-rules','Lab rules',$2,$3,$4,'why',$5,$6,$7,$8)`,
    [
      extra.record ?? RECORD,
      key,
      kind,
      `Title ${key}`,
      extra.roles ?? [],
      extra.approvals ?? 1,
      extra.independent ?? true,
      extra.by ?? OWNER,
    ],
  )
  return rows[0] as { id: string; state: string; kind: string }
}

const conditions = (c: unknown) => JSON.stringify([c])

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const [id, role] of [
    [OWNER, 'owner'],
    [MEMBER, 'member'],
    [REVIEWER, 'reviewer'],
    [REVIEWER_2, 'reviewer'],
  ] as const) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true) on conflict (id) do nothing`,
      [id, `${id}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true) on conflict (id) do nothing`,
    [STRANGER, `${STRANGER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values ($1,'rh1','RH1','active'),($2,'rh2','RH2','active')`,
    [WS, OTHER_WS],
  )
  for (const [id, role] of [
    [OWNER, 'owner'],
    [MEMBER, 'member'],
    [REVIEWER, 'reviewer'],
    [REVIEWER_2, 'reviewer'],
  ] as const) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)`,
      [WS, id, role],
    )
  }
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [OTHER_WS, STRANGER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'RH1','Hooks',$3)`,
    [PROJECT, WS, OWNER],
  )
  for (const user of [MEMBER, REVIEWER, REVIEWER_2]) {
    await migrator.query(
      `insert into api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
       values($1,$2,$3,true,true,true,false,$4)`,
      [WS, PROJECT, user, OWNER],
    )
  }
  for (const [id, identifier] of [
    [RECORD, 'EXP-RH1'],
    [RECORD_B, 'EXP-RH2'],
  ]) {
    await migrator.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,$3,'experiment',$4,'Hooked',$5)`,
      [id, WS, PROJECT, identifier, OWNER],
    )
  }
})

afterAll(async () => {
  for (const c of clients) await c.end().catch(() => {})
  await migrator.end().catch(() => {})
})

describe('flags', () => {
  it('raises, changes the words, clears and reopens one', async () => {
    const first = await raise('hold', 'flag')
    expect(first.state).toBe('open')
    await migrator.query(
      `select internal.plugin_raise_flag($1,'lab-rules','Lab rules','hold','flag','New title','new words','{}',1,true,$2)`,
      [RECORD, OWNER],
    )
    let row = (
      await migrator.query(`select * from api.plugin_flags where id=$1`, [first.id])
    ).rows[0]
    expect(row.title).toBe('New title')
    expect(row.state).toBe('open')

    const cleared = await migrator.query(
      `select internal.plugin_clear_flag($1,'lab-rules','hold') as done`,
      [RECORD],
    )
    expect(cleared.rows[0].done).toBe(true)
    row = (await migrator.query(`select * from api.plugin_flags where id=$1`, [first.id])).rows[0]
    expect(row.state).toBe('cleared')
    expect(row.cleared_at).not.toBeNull()

    const again = await raise('hold', 'flag')
    expect(again.id).toBe(first.id)
    expect(again.state).toBe('open')
  })

  it('refuses an odd key or a sign-off with nobody to press it', async () => {
    await expect(raise('Bad Key', 'flag')).rejects.toMatchObject({ code: '23514' })
    await expect(raise('nobody', 'sign_off', { roles: [] })).rejects.toMatchObject({ code: '23514' })
    await expect(raise('role', 'sign_off', { roles: ['janitor'] })).rejects.toMatchObject({ code: '23514' })
  })
})

describe('sign-offs', () => {
  it('needs a permitted role and someone other than the person who made the change', async () => {
    const step = await raise('check', 'sign_off', { roles: ['reviewer'], by: REVIEWER })
    const member = await actor(MEMBER)
    await expect(
      member.query(`select * from api.sign_off_plugin_step($1)`, [step.id]),
    ).rejects.toMatchObject({ code: '42501' })
    const maker = await actor(REVIEWER)
    await expect(
      maker.query(`select * from api.sign_off_plugin_step($1)`, [step.id]),
    ).rejects.toMatchObject({ code: '42501' })
    const other = await actor(REVIEWER_2)
    const done = await other.query(
      `select * from api.sign_off_plugin_step($1,'looks right')`,
      [step.id],
    )
    expect(done.rows[0].state).toBe('cleared')
    await expect(
      other.query(`select * from api.sign_off_plugin_step($1)`, [step.id]),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('counts approvals and lets the maker press it when independence is off', async () => {
    const step = await raise('two', 'sign_off', {
      roles: ['reviewer', 'owner'],
      approvals: 2,
      independent: false,
      by: OWNER,
    })
    const owner = await actor(OWNER)
    const first = await owner.query(`select * from api.sign_off_plugin_step($1)`, [step.id])
    expect(first.rows[0].state).toBe('open')
    // Pressing twice is still one approval.
    const again = await owner.query(`select * from api.sign_off_plugin_step($1)`, [step.id])
    expect(again.rows[0].state).toBe('open')
    const reviewer = await actor(REVIEWER)
    const last = await reviewer.query(`select * from api.sign_off_plugin_step($1)`, [step.id])
    expect(last.rows[0].state).toBe('cleared')
  })

  it('starts over when the plugin asks again', async () => {
    const step = await raise('again', 'sign_off', { roles: ['reviewer'], by: OWNER })
    const reviewer = await actor(REVIEWER)
    await reviewer.query(`select * from api.sign_off_plugin_step($1)`, [step.id])
    await new Promise((resolve) => setTimeout(resolve, 20))
    const reopened = await raise('again', 'sign_off', { roles: ['reviewer'], by: OWNER })
    expect(reopened.state).toBe('open')
    const left = await migrator.query(
      `select count(*)::int as n from api.plugin_flag_sign_offs where flag_id=$1`,
      [step.id],
    )
    expect(left.rows[0].n).toBe(0)
  })

  it('cannot be written to directly', async () => {
    const owner = await actor(OWNER)
    await expect(
      owner.query(`update api.plugin_flags set state='cleared', cleared_at=now()`),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`select internal.plugin_clear_flag($1,'lab-rules','hold')`, [RECORD]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('summaries', () => {
  it('keeps one per hook, replaces it and removes it when empty', async () => {
    const store = (text: string) =>
      migrator.query(
        `select internal.plugin_store_summary($1,'lab-rules','Lab rules','sum',$2)`,
        [RECORD, text],
      )
    await store('First')
    await store('Second')
    let rows = (await migrator.query(`select summary from api.plugin_record_outputs where record_id=$1`, [RECORD])).rows
    expect(rows).toEqual([{ summary: 'Second' }])
    await store('')
    rows = (await migrator.query(`select summary from api.plugin_record_outputs where record_id=$1`, [RECORD])).rows
    expect(rows).toEqual([])
  })
})

describe('search entries', () => {
  async function store(record: string, index: string, entries: unknown[]) {
    await migrator.query(
      `select internal.plugin_store_index($1,'lab-rules',$2,$3::jsonb)`,
      [record, index, JSON.stringify(entries)],
    )
  }

  it('ranks by words, replaces what the record had and drops stale entries', async () => {
    await store(RECORD, 'words', [
      { entry: 'a', body: 'sodium chloride titration' },
      { entry: 'b', body: 'unrelated' },
    ])
    await store(RECORD_B, 'words', [{ body: 'titration of acids' }])
    const member = await actor(MEMBER)
    let hits = (await member.query(`select * from api.search_plugin_index('lab-rules','words','titration')`)).rows
    expect(hits.map((h) => h.record_id).sort()).toEqual([RECORD, RECORD_B].sort())
    await store(RECORD, 'words', [{ entry: 'b', body: 'unrelated' }])
    hits = (await member.query(`select * from api.search_plugin_index('lab-rules','words','titration')`)).rows
    expect(hits.map((h) => h.record_id)).toEqual([RECORD_B])
  })

  it('ranks by vector closeness and ignores entries of another width', async () => {
    await store(RECORD, 'vec', [{ entry: 'm', body: 'near', vector: [1, 0, 0] }])
    await store(RECORD_B, 'vec', [
      { entry: 'm', body: 'far', vector: [0, 1, 0] },
      { entry: 'wide', body: 'other width', vector: [1, 0, 0, 0] },
    ])
    const member = await actor(MEMBER)
    const hits = (
      await member.query(
        `select * from api.search_plugin_index('lab-rules','vec',null,array[1,0.1,0]::float8[],10)`,
      )
    ).rows
    expect(hits.map((h) => `${h.record_id}:${h.entry_key}`)).toEqual([`${RECORD}:m`, `${RECORD_B}:m`])
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('shows nothing from another workspace', async () => {
    const stranger = await actor(STRANGER, OTHER_WS)
    const hits = (await stranger.query(`select * from api.search_plugin_index('lab-rules','vec',null,array[1,0,0]::float8[])`)).rows
    expect(hits).toEqual([])
    const direct = (await stranger.query(`select * from api.plugin_search_entries`)).rows
    expect(direct).toEqual([])
  })
})

describe('visibility', () => {
  it('keeps flags and summaries inside their workspace', async () => {
    await raise('visible', 'flag')
    const member = await actor(MEMBER)
    expect((await member.query(`select 1 from api.plugin_flags where flag_key='visible'`)).rowCount).toBe(1)
    const stranger = await actor(STRANGER, OTHER_WS)
    expect((await stranger.query(`select 1 from api.plugin_flags`)).rowCount).toBe(0)
    expect((await stranger.query(`select 1 from api.plugin_record_outputs`)).rowCount).toBe(0)
  })
})

describe('the plugin_flag gate condition', () => {
  const evaluate = async (condition: unknown) =>
    (
      await migrator.query(`select internal.eval_gate_conditions($1,$2::jsonb) as r`, [
        RECORD_B,
        conditions(condition),
      ])
    ).rows[0].r as Array<{ met: boolean; text?: string }>

  it('is valid with a plugin key and an optional flag key only', async () => {
    const valid = async (c: unknown) =>
      (await migrator.query(`select internal.gate_conditions_valid($1::jsonb) as ok`, [conditions(c)])).rows[0].ok
    expect(await valid({ kind: 'plugin_flag', extensionKey: 'lab-rules' })).toBe(true)
    expect(await valid({ kind: 'plugin_flag', extensionKey: 'lab-rules', flagKey: 'hold' })).toBe(true)
    expect(await valid({ kind: 'plugin_flag' })).toBe(false)
    expect(await valid({ kind: 'plugin_flag', extensionKey: 'Lab Rules' })).toBe(false)
    expect(await valid({ kind: 'plugin_flag', extensionKey: 'lab-rules', flagKey: 'No Good' })).toBe(false)
  })

  it('is met while the plugin has nothing open and says what is open otherwise', async () => {
    const any = { kind: 'plugin_flag', extensionKey: 'lab-rules', label: 'Lab rules' }
    expect((await evaluate(any))[0].met).toBe(true)
    await raise('gate-a', 'flag', { record: RECORD_B })
    const open = (await evaluate(any))[0]
    expect(open.met).toBe(false)
    expect(open.text).toContain('Lab rules has this open')
    expect((await evaluate({ ...any, flagKey: 'other-key' }))[0].met).toBe(true)
    expect((await evaluate({ ...any, flagKey: 'gate-a' }))[0].met).toBe(false)
    await migrator.query(`select internal.plugin_clear_flag($1,'lab-rules','gate-a')`, [RECORD_B])
    expect((await evaluate(any))[0].met).toBe(true)
  })
})
