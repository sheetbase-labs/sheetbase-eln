/**
 * PROJ-04.1 — folder placement for every object kind.
 *
 * Records keep `records.folder_id`; sheets, datasets, analyses and pipelines are
 * placed in `api.folder_items`, one folder per object. A move refuses a
 * cross-project home for an object that has a project, and refuses another
 * workspace's folder or object.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cd00'
const OTHER_WS = '00000000-0000-4000-8000-00000000cd01'
const PROJECT_A = '00000000-0000-4000-8000-00000000cd02'
const PROJECT_B = '00000000-0000-4000-8000-00000000cd03'
const FOLDER_A = '00000000-0000-4000-8000-00000000cd04'
const FOLDER_B = '00000000-0000-4000-8000-00000000cd05'
const DATASET = '00000000-0000-4000-8000-00000000cd07'
const OWNER = 'proj041-owner'
const OUTSIDER = 'proj041-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let sheetId = ''

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'proj041','PROJ-04.1'),($2,'proj041-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($3,$4,'owner')`,
    [WS, OWNER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ($1,$3,'P41A','Alpha',$4),($2,$3,'P41B','Beta',$4)`,
    [PROJECT_A, PROJECT_B, WS, OWNER],
  )
  await migrator.query(
    `insert into api.folders(id,workspace_id,project_id,identifier,name) values
      ($1,$3,$4,'F-A','Alpha folder'),($2,$3,$5,'F-B','Beta folder')`,
    [FOLDER_A, FOLDER_B, WS, PROJECT_A, PROJECT_B],
  )
  // A sheet in project A and a dataset in project B.
  await setActorJwt(migrator, OWNER, WS)
  sheetId = (
    await migrator.query<{ id: string }>(
      `select (api.create_sheet_instance($1,'Alpha sheet',null,null,$2,null,$3::jsonb)).id as id`,
      [
        WS,
        PROJECT_A,
        JSON.stringify({
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
            filters: [],
            sorts: [],
          },
          provenance: { createdFrom: 'ad_hoc' },
        }),
      ],
    )
  ).rows[0]!.id
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name)
     values('00000000-0000-4000-8000-00000000cd08',$1,'p41','P41 schema')`,
    [WS],
  )
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,published_at)
     values('00000000-0000-4000-8000-00000000cd09','00000000-0000-4000-8000-00000000cd08',1,'active',now())`,
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,primary_project_id,schema_version_id,name)
     values($1,$2,$3,'00000000-0000-4000-8000-00000000cd09','Beta dataset')`,
    [DATASET, WS, PROJECT_B],
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

async function move(client: Client, items: unknown, folderId: string | null) {
  return client.query('select api.move_to_folder($1::jsonb,$2) as moved', [
    JSON.stringify(items),
    folderId,
  ])
}

async function placed(client: Client, folderId: string) {
  return (
    await client.query<{ object_kind: string; name: string }>(
      'select object_kind,name from api.folder_items_list($1)',
      [folderId],
    )
  ).rows
}

describe('PROJ-04.1 folder placement', () => {
  it('places a sheet in its own project folder and lists it', async () => {
    const owner = await actor(OWNER)
    await expect(
      move(owner, [{ kind: 'sheet_instance', id: sheetId }], FOLDER_A),
    ).resolves.toBeDefined()
    expect(await placed(owner, FOLDER_A)).toEqual([
      { object_kind: 'sheet_instance', name: 'Alpha sheet' },
    ])
  })

  it('refuses a cross-project move and keeps the original placement', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      move(owner, [{ kind: 'dataset', id: DATASET }], FOLDER_A),
      'SB119',
    )
    expect(await placed(owner, FOLDER_A)).toHaveLength(1)
    // Its own project's folder accepts it.
    await move(owner, [{ kind: 'dataset', id: DATASET }], FOLDER_B)
    expect(await placed(owner, FOLDER_B)).toEqual([
      { object_kind: 'dataset', name: 'Beta dataset' },
    ])
  })

  it('moves an object between folders rather than placing it twice', async () => {
    const owner = await actor(OWNER)
    await move(owner, [{ kind: 'sheet_instance', id: sheetId }], FOLDER_A)
    expect(await placed(owner, FOLDER_A)).toHaveLength(1)
    const { rows } = await migrator.query<{ n: number }>(
      'select count(*)::int n from api.folder_items where object_id=$1',
      [sheetId],
    )
    expect(rows[0]!.n).toBe(1)
  })

  it('refuses an unknown object, another workspace and a non-writer', async () => {
    const owner = await actor(OWNER)
    await expectDenied(
      move(
        owner,
        [{ kind: 'dataset', id: '00000000-0000-4000-8000-00000000cdff' }],
        FOLDER_A,
      ),
      '42501',
    )
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expectDenied(
      move(outsider, [{ kind: 'dataset', id: DATASET }], FOLDER_A),
      '42501',
    )
  })
})
