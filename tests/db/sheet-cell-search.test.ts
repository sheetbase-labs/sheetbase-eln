/**
 * SRCH-01.2 — sheet row values are searchable with their column label.
 *
 * The sheet's values live in the Instance state, so a trigger rebuilds the
 * instance's index rows whenever that state changes. `api.search_sheet_cells`
 * is SECURITY INVOKER, so RLS scopes the hits to the workspace and the
 * instance's own read authority decides what a member can see.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAdHocTextField } from '#/lib/sheet-local-data'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c700'
const OTHER_WS = '00000000-0000-4000-8000-00000000c701'
const PROJECT = '00000000-0000-4000-8000-00000000c702'
const FIELD = '00000000-0000-4000-8000-00000000c703'
const ROW = '00000000-0000-4000-8000-00000000c704'
const OWNER = 'srch01-owner'
const VIEWER = 'srch01-viewer'
const NOBODY = 'srch01-nobody'
const OUTSIDER = 'srch01-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, VIEWER, NOBODY, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'srch01','SRCH-01'),($2,'srch01-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'viewer'),($1,$4,'member'),($5,$6,'owner')`,
    [WS, OWNER, VIEWER, NOBODY, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id)
     values($1,$2,'SRCH01','Searchable sheet',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,granted_by_user_id)
     values($1,$2,$3,true,$4)`,
    [WS, PROJECT, VIEWER, OWNER],
  )
  // Sheet Instances are created through their controlled RPC.
  await setActorJwt(migrator, OWNER, WS)
  await migrator.query(
    `select api.create_sheet_instance($1,'Stability readings',null,null,$2,null,$3::jsonb)`,
    [
      WS,
      PROJECT,
      JSON.stringify({
        bindings: [],
        localFields: [{ ...createAdHocTextField('Passage'), fieldId: FIELD }],
        localValues: { [ROW]: { [FIELD]: 'p24 titre 4.2e6' } },
        calculationOverrides: {},
        presentation: {
          columnOrder: [FIELD],
          hiddenColumnIds: [],
          columnWidths: {},
          frozenColumnCount: 0,
          density: 'standard',
          filters: [],
          sorts: [],
        },
        provenance: { createdFrom: 'ad_hoc' },
      }),
    ],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

async function hits(client: Client, query: string) {
  return (
    await client.query<{
      instance_name: string
      field_label: string
      row_key: string
      value_text: string
    }>(
      'select instance_name,field_label,row_key,value_text from api.search_sheet_cells($1)',
      [query],
    )
  ).rows
}

async function setCell(value: string) {
  const owner = await actor(OWNER)
  const instance = (
    await migrator.query<{ id: string; revision: string }>(
      `select id, revision from api.sheet_instances where name='Stability readings'`,
    )
  ).rows[0]!
  await owner.query(
    `select api.mutate_sheet_instance_local_state($1,$2,$3,'[]'::jsonb,$4::jsonb,$5::jsonb)`,
    [
      instance.id,
      instance.revision,
      crypto.randomUUID(),
      JSON.stringify([{ kind: 'local', rowKey: ROW }]),
      JSON.stringify([{ rowKey: ROW, fieldId: FIELD, value }]),
    ],
  )
}

describe('SRCH-01.2 sheet cell search', () => {
  it('finds a sheet value and reports the matched column', async () => {
    const owner = await actor(OWNER)
    expect(await hits(owner, 'p24 titre')).toEqual([
      {
        instance_name: 'Stability readings',
        field_label: 'Passage',
        row_key: ROW,
        value_text: 'p24 titre 4.2e6',
      },
    ])
    // A value that is not present is not a hit.
    expect(await hits(owner, 'absent-value')).toEqual([])
  })

  it('follows the instance state: edits are re-indexed and cleared values drop out', async () => {
    const owner = await actor(OWNER)
    await setCell('p24 titre 9.9e6')
    expect((await hits(owner, 'p24 titre'))[0]?.value_text).toBe(
      'p24 titre 9.9e6',
    )
    await setCell('')
    expect(await hits(owner, 'p24 titre')).toEqual([])
    await setCell('p24 titre 4.2e6')
    expect(await hits(owner, 'p24 titre')).toHaveLength(1)
  })

  it('scopes hits to the workspace and to the instance read authority', async () => {
    const viewer = await actor(VIEWER)
    expect(await hits(viewer, 'p24 titre')).toHaveLength(1)
    // A member with no project authority does not reach the instance.
    const nobody = await actor(NOBODY)
    expect(await hits(nobody, 'p24 titre')).toEqual([])
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(await hits(outsider, 'p24 titre')).toEqual([])
  })

  it('never writes the index from a request role', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        `insert into api.sheet_cell_search(instance_id,row_key,field_id,workspace_id,field_label,value_text)
         values(gen_random_uuid(),'r','f',$1,'label','value')`,
        [WS],
      ),
      '42501',
    )
  })
})
