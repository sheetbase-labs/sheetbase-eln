/**
 * Same-thing rules from plugins (migration registry_sameness_rules): the app
 * works out a key, the database keeps it, warns about repeats, and forgets a
 * key when the entry's fields change.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ff01'
const PROJECT = '00000000-0000-4000-8000-00000000ff11'
const OWNER = 'rs-owner'
const ITEM = 'plugin.chem-keys.parent'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client

async function entry(title: string): Promise<string> {
  const { rows } = await owner.query(
    `select id from api.create_registry_entry($1,'compound',$2,'{}'::jsonb,true)`,
    [PROJECT, title],
  )
  return rows[0].id as string
}

async function matches(value: string, exclude: string | null = null) {
  const { rows } = await owner.query(
    `select identifier, match from api.registry_sameness_matches('compound',$1,$2)`,
    [value, exclude],
  )
  return rows as Array<{ identifier: string; match: string }>
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'rs','Same things')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'rs','Registry',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await asRole('authenticator')
  await owner.query('SET ROLE authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
  await owner.query(
    `select * from api.create_registry_model('compound','compound','CMP',null,$1::jsonb,'{}',null)`,
    [JSON.stringify([{ field_name: 'smiles', label: 'SMILES' }])],
  )
})

afterAll(async () => {
  await owner?.end()
  await migrator?.end()
})

describe('same-thing rules', () => {
  it('needs a registry model and a plugin item name', async () => {
    await expect(
      owner.query(`select api.set_registry_sameness_rule('nothing',$1)`, [
        ITEM,
      ]),
    ).rejects.toBeTruthy()
    await expect(
      owner.query(`select api.set_registry_sameness_rule('compound','nope')`),
    ).rejects.toBeTruthy()
    await owner.query(`select api.set_registry_sameness_rule('compound',$1)`, [
      ITEM,
    ])
    const { rows } = await owner.query(
      `select plugin_item from api.registry_sameness_rules`,
    )
    expect(rows).toEqual([{ plugin_item: ITEM }])
  })

  it('keeps a key, finds the repeat and refuses it unless allowed', async () => {
    const first = await entry('Aspirin')
    await owner.query(`select api.set_registry_sameness_value($1,'K1')`, [
      first,
    ])
    const second = await entry('Acetylsalicylic acid')
    const found = await matches('K1')
    expect(found).toHaveLength(1)
    expect(found[0]!.match).toBe('exact')
    expect(await matches('K1', first)).toEqual([])
    await expect(
      owner.query(`select api.set_registry_sameness_value($1,'K1')`, [second]),
    ).rejects.toMatchObject({ code: 'SB012' })
    await owner.query(`select api.set_registry_sameness_value($1,'K1',true)`, [
      second,
    ])
    expect(await matches('K1')).toHaveLength(2)
  })

  it('forgets a key when the entry changes, so it never matches the wrong thing', async () => {
    const id = await entry('Caffeine')
    await owner.query(`select api.set_registry_sameness_value($1,'K2')`, [id])
    expect(await matches('K2')).toHaveLength(1)
    await owner.query(
      `update api.records set title='Caffeine (renamed)' where id=$1`,
      [id],
    )
    expect(await matches('K2')).toEqual([])
  })

  it('does not let another workspace see or set keys', async () => {
    const id = await entry('Private thing')
    const other = await asRole('authenticator')
    await other.query('SET ROLE authenticated')
    await other.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        sub: 'rs-nobody',
        workspace_id: '00000000-0000-4000-8000-00000000ff02',
        role: 'authenticated',
      }),
    ])
    await expect(
      other.query(
        `select * from api.registry_sameness_matches('compound','K1')`,
      ),
    ).rejects.toBeTruthy()
    await expect(
      other.query(`select api.set_registry_sameness_value($1,'K9')`, [id]),
    ).rejects.toBeTruthy()
    await other.end()
  })

  it('drops every key when the rule is cleared', async () => {
    await owner.query(`select api.set_registry_sameness_rule('compound',null)`)
    const { rows } = await migrator.query(
      `select count(*)::int as n from api.registry_sameness_values`,
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('entries are added with the key', () => {
  beforeAll(async () => {
    await owner.query(`select api.set_registry_sameness_rule('compound',$1)`, [
      ITEM,
    ])
  })

  it('refuses an entry that comes without the rule’s key', async () => {
    await expect(
      owner.query(
        `select api.create_registry_entry($1,'compound','No key','{}'::jsonb,false)`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB013' })
    await expect(
      owner.query(
        `select api.create_model_record($1,'compound','Raw','draft','{}'::text[],'{}'::jsonb,'{}'::jsonb)`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB013' })
  })

  it('keeps the key it came with and refuses a repeat of it', async () => {
    const { rows } = await owner.query(
      `select id from api.create_registry_entry($1,'compound','With key','{}'::jsonb,false,'K7')`,
      [PROJECT],
    )
    expect(await matches('K7')).toHaveLength(1)
    expect(rows).toHaveLength(1)
    await expect(
      owner.query(
        `select api.create_registry_entry($1,'compound','Same again','{}'::jsonb,false,'K7')`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB012' })
    await owner.query(
      `select api.create_registry_entry($1,'compound','Same, on purpose','{}'::jsonb,true,'K7')`,
      [PROJECT],
    )
    expect(await matches('K7')).toHaveLength(2)
  })
})
