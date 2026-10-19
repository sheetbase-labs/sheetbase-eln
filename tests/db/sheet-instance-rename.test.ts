/**
 * A sheet can be renamed on its own: only the name changes, the revision moves
 * on so an open editor sees it, and viewers, outsiders, archived sheets and
 * stale revisions are refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '13000000-0000-4000-8000-0000000000a1'
const OTHER_WS = '13000000-0000-4000-8000-0000000000a2'
const OWNER = 'sheet-rename-owner'
const VIEWER = 'sheet-rename-viewer'
const OUTSIDER = 'sheet-rename-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const state = () => ({
  bindings: [],
  localFields: [],
  localValues: {},
  calculationOverrides: {},
  presentation: {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  },
  provenance: { createdFrom: 'ad_hoc' },
})

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function create(client: Client, name = 'Working sheet') {
  return (
    await client.query<{
      result: { id: string; revision: number; name: string }
    }>(
      `select to_jsonb(api.create_sheet_instance($1,$2,null,null,null,null,$3::jsonb)) result`,
      [WS, name, JSON.stringify(state())],
    )
  ).rows[0]!.result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
     ($1,'Owner','sr-owner@test.invalid',true),($2,'Viewer','sr-viewer@test.invalid',true),($3,'Outsider','sr-outsider@test.invalid',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'sr-a','SR A'),($2,'sr-b','SR B')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$3,'owner'),($1,$4,'viewer'),($2,$5,'owner')`,
    [WS, OTHER_WS, OWNER, VIEWER, OUTSIDER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('rename_sheet_instance', () => {
  it('changes only the name and moves the revision on', async () => {
    const owner = await actor(OWNER, WS)
    const sheet = await create(owner)
    const { rows } = await owner.query<{
      result: { name: string; revision: number; state: unknown }
    }>(
      `select to_jsonb(api.rename_sheet_instance($1,$2,'  Cell count 14 Oct  ')) result`,
      [sheet.id, sheet.revision],
    )
    expect(rows[0]!.result.name).toBe('Cell count 14 Oct')
    expect(rows[0]!.result.revision).toBe(Number(sheet.revision) + 1)
    expect(rows[0]!.result.state).toMatchObject(state())
  })

  it('treats the same name as no change', async () => {
    const owner = await actor(OWNER, WS)
    const sheet = await create(owner, 'Same name')
    const { rows } = await owner.query<{ result: { revision: number } }>(
      `select to_jsonb(api.rename_sheet_instance($1,$2,'Same name')) result`,
      [sheet.id, sheet.revision],
    )
    expect(Number(rows[0]!.result.revision)).toBe(Number(sheet.revision))
  })

  it('refuses a stale revision, an empty name and a name over 200 characters', async () => {
    const owner = await actor(OWNER, WS)
    const sheet = await create(owner)
    await owner.query(`select api.rename_sheet_instance($1,$2,'First')`, [
      sheet.id,
      sheet.revision,
    ])
    await expect(
      owner.query(`select api.rename_sheet_instance($1,$2,'Second')`, [
        sheet.id,
        sheet.revision,
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    const fresh = await create(owner)
    await expect(
      owner.query(`select api.rename_sheet_instance($1,$2,'   ')`, [
        fresh.id,
        fresh.revision,
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query(`select api.rename_sheet_instance($1,$2,$3)`, [
        fresh.id,
        fresh.revision,
        'x'.repeat(201),
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('refuses a viewer and a member of another workspace', async () => {
    const owner = await actor(OWNER, WS)
    const sheet = await create(owner)
    const viewer = await actor(VIEWER, WS)
    await expect(
      viewer.query(`select api.rename_sheet_instance($1,$2,'Mine now')`, [
        sheet.id,
        sheet.revision,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expect(
      outsider.query(`select api.rename_sheet_instance($1,$2,'Mine now')`, [
        sheet.id,
        sheet.revision,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses an archived sheet', async () => {
    const owner = await actor(OWNER, WS)
    const sheet = await create(owner)
    await owner.query(`select api.archive_sheet_instance($1,$2)`, [
      sheet.id,
      sheet.revision,
    ])
    await expect(
      owner.query(`select api.rename_sheet_instance($1,$2,'Too late')`, [
        sheet.id,
        Number(sheet.revision) + 1,
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })
})
