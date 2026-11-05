/**
 * Biological registry: numbered constructs, cell lines and antibodies, a
 * duplicate check before an entry is added, lineage without loops, and links
 * to the records that use an entry. Runs against a freshly migrated
 * sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e701'
const OTHER_WS = '00000000-0000-4000-8000-00000000e702'
const PROJECT = '00000000-0000-4000-8000-00000000e711'
const OWNER = 'reg-owner'
const VIEWER = 'reg-viewer'
const STRANGER = 'reg-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client
let stranger: Client

async function actor(userId: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function create(
  kind: string,
  name: string,
  opts: {
    fingerprint?: string | null
    parents?: { id: string; role: string }[]
    allow?: boolean
    details?: Record<string, string>
    client?: Client
  } = {},
) {
  const { rows } = await (opts.client ?? owner).query(
    `select * from api.create_registry_entry($1,$2,null,$3::jsonb,$4,$5::jsonb,$6)`,
    [
      kind,
      name,
      JSON.stringify(opts.details ?? {}),
      opts.fingerprint ?? null,
      JSON.stringify(opts.parents ?? []),
      opts.allow ?? false,
    ],
  )
  return rows[0] as { id: string; registry_id: string; number: number }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','reg-owner@test.invalid',true),
      ('${VIEWER}','Viewer','reg-viewer@test.invalid',true),
      ('${STRANGER}','Stranger','reg-stranger@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','registry','Registry'),
      ('${OTHER_WS}','registry-other','Registry other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer'),
      ('${OTHER_WS}','${STRANGER}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id)
      values ('${PROJECT}','${WS}','reg','Registry','${OWNER}')`)
  owner = await actor(OWNER)
  viewer = await actor(VIEWER)
  stranger = await actor(STRANGER, OTHER_WS)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('numbering', () => {
  it('gives each kind its own prefix and never reuses a number', async () => {
    const a = await create('construct', 'pUC19')
    const b = await create('construct', 'pUC57')
    const line = await create('cell_line', 'HeLa')
    const ab = await create('antibody', 'Anti-actin')
    expect(a.registry_id).toBe('CON-0001')
    expect(b.registry_id).toBe('CON-0002')
    expect(line.registry_id).toBe('CL-0001')
    expect(ab.registry_id).toBe('AB-0001')

    await owner.query(
      `select api.set_registry_entry_status($1,'retired','lost')`,
      [b.id],
    )
    const c = await create('construct', 'pUC118')
    expect(c.registry_id).toBe('CON-0003')
  })

  it('numbers separately in each workspace', async () => {
    const other = await create('construct', 'pUC19', { client: stranger })
    expect(other.registry_id).toBe('CON-0001')
  })
})

describe('duplicate check', () => {
  it('refuses the same sequence fingerprint and the same name', async () => {
    await create('construct', 'pGEX', { fingerprint: 'seq:abc' })
    await expect(
      create('construct', 'Another name', { fingerprint: 'seq:abc' }),
    ).rejects.toMatchObject({ code: 'SB012' })
    await expect(create('construct', '  pgex ')).rejects.toMatchObject({
      code: 'SB012',
    })
  })

  it('reports matches, exact ones first, and lets a repeat through on purpose', async () => {
    const { rows } = await owner.query(
      `select * from api.registry_find_duplicates('construct','pgex','seq:abc')`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].match).toBe('exact')
    const again = await create('construct', 'pGEX', {
      fingerprint: 'seq:abc',
      allow: true,
    })
    expect(again.registry_id).toMatch(/^CON-/)
  })

  it('does not compare across kinds or workspaces', async () => {
    await create('cell_line', 'pGEX')
    const mine = await owner.query(
      `select * from api.registry_find_duplicates('antibody','pGEX',null)`,
    )
    expect(mine.rows).toHaveLength(0)
    const theirs = await stranger.query(
      `select * from api.registry_find_duplicates('construct','pGEX','seq:abc')`,
    )
    expect(theirs.rows).toHaveLength(0)
  })
})

describe('lineage', () => {
  it('records parents with their part and refuses a loop', async () => {
    const vector = await create('construct', 'Backbone')
    const insert = await create('construct', 'Gene X')
    const child = await create('construct', 'Backbone-GeneX', {
      parents: [
        { id: vector.id, role: 'vector' },
        { id: insert.id, role: 'insert' },
      ],
    })
    const { rows } = await migrator.query(
      `select parent_id, role from api.registry_parents where entry_id = $1 order by role`,
      [child.id],
    )
    expect(rows.map((r) => r.role)).toEqual(['insert', 'vector'])

    const line = await create('cell_line', 'HEK-GeneX', {
      parents: [{ id: child.id, role: 'transfected_with' }],
    })
    await expect(
      owner.query(`select api.add_registry_parent($1,$2,'parent')`, [
        vector.id,
        line.id,
      ]),
    ).rejects.toThrow(/descendant/)
    await expect(
      owner.query(`select api.add_registry_parent($1,$1,'parent')`, [
        vector.id,
      ]),
    ).rejects.toThrow(/itself/)

    await owner.query(`select api.remove_registry_parent($1,$2)`, [
      child.id,
      insert.id,
    ])
    const left = await migrator.query(
      `select count(*)::int as n from api.registry_parents where entry_id = $1`,
      [child.id],
    )
    expect(left.rows[0].n).toBe(1)
  })

  it('will not link to an entry in another workspace', async () => {
    const mine = await create('construct', 'Mine')
    const theirs = await create('construct', 'Theirs', { client: stranger })
    await expect(
      owner.query(`select api.add_registry_parent($1,$2,'parent')`, [
        mine.id,
        theirs.id,
      ]),
    ).rejects.toThrow(/not found/)
  })
})

describe('changing and retiring', () => {
  it('edits details but keeps the number and kind', async () => {
    const e = await create('antibody', 'Anti-tubulin')
    const { rows } = await owner.query(
      `select * from api.update_registry_entry($1,'Anti-tubulin (DM1A)','Mouse mAb','{"clone":"DM1A"}'::jsonb,'cat:sigma:t9026')`,
      [e.id],
    )
    expect(rows[0].registry_id).toBe(e.registry_id)
    expect(rows[0].kind).toBe('antibody')
    expect(rows[0].details).toEqual({ clone: 'DM1A' })
    await expect(
      create('antibody', 'Other', { fingerprint: 'cat:sigma:t9026' }),
    ).rejects.toMatchObject({ code: 'SB012' })
  })

  it('retires with a reason and brings an entry back', async () => {
    const e = await create('cell_line', 'To retire')
    const retired = await owner.query(
      `select * from api.set_registry_entry_status($1,'retired','Contaminated')`,
      [e.id],
    )
    expect(retired.rows[0].status).toBe('retired')
    expect(retired.rows[0].retired_reason).toBe('Contaminated')
    const back = await owner.query(
      `select * from api.set_registry_entry_status($1,'active',null)`,
      [e.id],
    )
    expect(back.rows[0].status).toBe('active')
    expect(back.rows[0].retired_reason).toBeNull()
  })
})

describe('uses', () => {
  it('links and unlinks a record', async () => {
    const e = await create('construct', 'Used plasmid')
    const { rows } = await owner.query(
      `select id from api.create_record($1::uuid,'sample','Miniprep','available',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT],
    )
    const sample = rows[0].id as string
    await owner.query(`select api.set_registry_use($1,$2,true)`, [e.id, sample])
    await owner.query(`select api.set_registry_use($1,$2,true)`, [e.id, sample])
    const n = async () =>
      (
        await owner.query(
          `select count(*)::int as n from api.registry_uses where entry_id = $1`,
          [e.id],
        )
      ).rows[0].n
    expect(await n()).toBe(1)
    await owner.query(`select api.set_registry_use($1,$2,false)`, [
      e.id,
      sample,
    ])
    expect(await n()).toBe(0)
  })
})

describe('access', () => {
  it('lets a viewer read but not write, and hides other workspaces', async () => {
    const e = await create('construct', 'Visible')
    const seen = await viewer.query(
      `select registry_id from api.registry_entries where id = $1`,
      [e.id],
    )
    expect(seen.rows).toHaveLength(1)
    await expectDenied(create('construct', 'Nope', { client: viewer }), '42501')
    await expectDenied(
      viewer.query(`select api.set_registry_entry_status($1,'retired',null)`, [
        e.id,
      ]),
      '42501',
    )
    await expect(
      viewer.query(
        `insert into api.registry_entries(workspace_id,kind,number,registry_id,name) values ($1,'construct',999,'CON-0999','x')`,
        [WS],
      ),
    ).rejects.toThrow()
    const hidden = await stranger.query(
      `select 1 from api.registry_entries where id = $1`,
      [e.id],
    )
    expect(hidden.rows).toHaveLength(0)
  })
})
