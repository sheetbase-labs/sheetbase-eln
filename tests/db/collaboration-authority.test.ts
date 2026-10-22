import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  grantProjectAccess,
  prepareTestDatabase,
  testDatabaseName,
} from './helpers'

const WS = '00000000-0000-4000-8000-000000cc0001'
const OTHER_WS = '00000000-0000-4000-8000-000000cc0002'
const PROJECT = '00000000-0000-4000-8000-000000cc0003'
const RECORD = '00000000-0000-4000-8000-000000cc0004'
const DRAFT = '00000000-0000-4000-8000-000000cc0005'
const SHEET = '00000000-0000-4000-8000-000000cc0006'
const DRAFT_SHEET = '00000000-0000-4000-8000-000000cc0007'
const OWNER = 'collab-owner'
const EDITOR = 'collab-editor'
const READER = 'collab-reader'
const VIEWER = 'collab-viewer'
const FORBIDDEN = 'collab-forbidden'
const OUTSIDER = 'collab-outsider'
let dataset: string
let migrator: Client
let access: typeof import('#/lib/collaboration/access.server')
let resolution: typeof import('#/lib/collaboration/resolution.server')
let database: typeof import('#/db/client.server')

const room = (kind = 'record', id = RECORD, workspace = WS) =>
  `workspace:${workspace}:${kind}:${id}`

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  vi.stubEnv('DATABASE_URL', url.toString())
  vi.stubEnv('LIVEBLOCKS_SECRET_KEY', 'sk_test-not-used-for-network')
  // Import the actual server modules against this worker's disposable DB.
  access = await import('#/lib/collaboration/access.server')
  resolution = await import('#/lib/collaboration/resolution.server')
  database = await import('#/db/client.server')
  for (const user of [OWNER, EDITOR, READER, VIEWER, FORBIDDEN, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'collab','Collab'),($2,'collab-other','Other')`,
    [WS, OTHER_WS],
  )
  for (const [user, role] of [
    [OWNER, 'owner'],
    [EDITOR, 'member'],
    [READER, 'member'],
    [VIEWER, 'viewer'],
    [FORBIDDEN, 'admin'],
    [OUTSIDER, 'member'],
  ]) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)`,
      [user === OUTSIDER ? OTHER_WS : WS, user, role],
    )
  }
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'COL','Collab',$3)`,
    [PROJECT, WS, OWNER],
  )
  for (const user of [OWNER, EDITOR, READER, VIEWER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: user,
      canView: true,
      canEdit: user === OWNER || user === EDITOR,
    })
  }
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values
      ($1,$3,$4,'experiment','COL-1','Shared experiment','in_progress',$5),
      ($2,$3,$4,'experiment','COL-2','Private draft','draft',$5)`,
    [RECORD, DRAFT, WS, PROJECT, OWNER],
  )
  // Trusted fixture setup, as in the Sheet/search DB suites. The normal
  // guard still validates state and identity; authority reads are untouched.
  await migrator.query(
    `select set_config('sheetbase.sheet_instance_write','rpc-v1',false)`,
  )
  await migrator.query(
    `insert into api.sheet_instances(id,workspace_id,project_id,notebook_record_id,name,state) values
      ($1,$3,$4,null,'Project sheet',$6),($2,$3,$4,$5,'Private draft sheet',$6)`,
    [
      SHEET,
      DRAFT_SHEET,
      WS,
      PROJECT,
      DRAFT,
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
        },
        provenance: { createdFrom: 'ad_hoc' },
      }),
    ],
  )
  const definition = await migrator.query<{ id: string }>(
    `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,'collab','Collab') returning id`,
    [WS],
  )
  const version = await migrator.query<{ id: string }>(
    `insert into api.dataset_schema_versions(schema_id,version,lifecycle,published_at) values($1,1,'active',now()) returning id`,
    [definition.rows[0].id],
  )
  const result = await migrator.query<{ id: string }>(
    `insert into api.datasets(workspace_id,schema_version_id,name,primary_project_id) values($1,$2,'Project dataset',$3) returning id`,
    [WS, version.rows[0].id, PROJECT],
  )
  dataset = result.rows[0].id
})

afterAll(async () => {
  await database?.db.$client.end()
  await migrator?.end()
  vi.unstubAllEnvs()
})

async function grant(userId: string, roomId = room()) {
  return access.resolveRoomAccess(new Headers(), roomId, {
    ...access.realCollaborationAuthDeps,
    // Only the HTTP identity boundary is substituted, never authority predicates.
    getSession: async () => ({
      user: { id: userId, name: userId, email: `${userId}@test.invalid` },
      session: { id: `session-${userId}` },
    }),
  })
}

async function denied(userId: string, roomId: string) {
  expect(await grant(userId, roomId)).toMatchObject({ ok: false, status: 403 })
  expect(await resolution.resolveRoomsForCaller(userId, [roomId])).toEqual([])
  expect(
    await resolution.mentionSuggestionsForRoom(userId, roomId, ''),
  ).toEqual([])
}

describe('canonical collaboration authority through real server resolvers', () => {
  it('denies same-workspace project guesses, private drafts and cross-workspace objects without names or mentions', async () => {
    for (const roomId of [
      room(),
      room('sheet', SHEET),
      room('dataset', dataset),
    ]) {
      await denied(FORBIDDEN, roomId)
      await denied(OUTSIDER, roomId)
    }
    await denied(EDITOR, room('record', DRAFT))
    await denied(EDITOR, room('sheet', DRAFT_SHEET))
    const draftNames = await resolution.resolveRoomsForCaller(OWNER, [
      room('record', DRAFT),
    ])
    expect(draftNames).toEqual([
      {
        id: room('record', DRAFT),
        name: 'COL-2 · Private draft',
        url: expect.any(String),
      },
    ])
    await denied(OWNER, room('record', RECORD, OTHER_WS))
    await denied(EDITOR, room('record', crypto.randomUUID()))
    expect(await grant(OWNER, room('record', DRAFT))).toMatchObject({
      ok: true,
    })
  })

  it('requires current Edit for writes while retaining View-only readers and viewers', async () => {
    for (const roomId of [
      room(),
      room('sheet', SHEET),
      room('dataset', dataset),
    ]) {
      expect(await grant(EDITOR, roomId)).toMatchObject({
        ok: true,
        permissions: {
          permissions: expect.arrayContaining(['comments:write']),
        },
      })
      for (const reader of [READER, VIEWER]) {
        expect(await grant(reader, roomId)).toMatchObject({
          ok: true,
          objectState: 'read_only',
          permissions: {
            permissions: [
              'room:read',
              'comments:read',
              'storage:none',
              'feeds:none',
            ],
          },
        })
        expect(
          await resolution.resolveRoomsForCaller(reader, [roomId]),
        ).toHaveLength(1)
      }
    }
    const mentions = await resolution.mentionSuggestionsForRoom(
      OWNER,
      room(),
      '',
    )
    expect(mentions.sort()).toEqual([EDITOR, READER, VIEWER].sort())
    expect(
      await resolution.mentionSuggestionsForRoom(
        OWNER,
        room('record', DRAFT),
        '',
      ),
    ).toEqual([])
  })

  it('keeps archived/locked objects readable but never writable, and denies deleted objects', async () => {
    await migrator.query(
      `update api.records set archived_at=now() where id=$1`,
      [RECORD],
    )
    expect(await grant(EDITOR)).toMatchObject({
      ok: true,
      objectState: 'read_only',
    })
    await migrator.query(
      `update api.records set archived_at=now() where id=$1`,
      [DRAFT],
    )
    expect(await grant(OWNER, room('sheet', DRAFT_SHEET))).toMatchObject({
      ok: true,
      objectState: 'read_only',
    })
    await migrator.query(
      `update api.records set archived_at=null,deleted_at=now() where id=$1`,
      [DRAFT],
    )
    await denied(OWNER, room('sheet', DRAFT_SHEET))
    await migrator.query(`update api.records set deleted_at=null where id=$1`, [
      DRAFT,
    ])
    const revision = await migrator.query<{ id: string }>(
      `insert into api.revisions(record_id,workspace_id,structure_version,metadata_version,
        metadata_snapshot,block_snapshot,reason,created_by_user_id)
       values($1,$2,1,1,'{}','[]','manual',$3) returning id`,
      [RECORD, WS, OWNER],
    )
    await migrator.query(
      `update api.records set archived_at=null,locked_at=now(),locked_by_revision_id=$2 where id=$1`,
      [RECORD, revision.rows[0].id],
    )
    expect(await grant(EDITOR)).toMatchObject({
      ok: true,
      objectState: 'read_only',
    })
    await migrator.query(
      `update api.records set locked_at=null,locked_by_revision_id=null,deleted_at=now() where id=$1`,
      [RECORD],
    )
    await denied(EDITOR, room())
    await migrator.query(`update api.records set deleted_at=null where id=$1`, [
      RECORD,
    ])
    await migrator.query(
      `update api.sheet_instances set lifecycle='archived' where id=$1`,
      [SHEET],
    )
    await migrator.query(
      `update api.datasets set lifecycle='archived' where id=$1`,
      [dataset],
    )
    expect(await grant(EDITOR, room('sheet', SHEET))).toMatchObject({
      ok: true,
      objectState: 'read_only',
    })
    expect(await grant(EDITOR, room('dataset', dataset))).toMatchObject({
      ok: true,
      objectState: 'read_only',
    })
    expect(
      await resolution.resolveRoomsForCaller(EDITOR, [
        room(),
        room('sheet', SHEET),
        room('dataset', dataset),
      ]),
    ).toHaveLength(3)
    await migrator.query(
      `update api.sheet_instances set lifecycle='active' where id=$1`,
      [SHEET],
    )
    await migrator.query(
      `update api.datasets set lifecycle='active' where id=$1`,
      [dataset],
    )
  })

  it('rechecks grants, resolution and mention eligibility immediately after authority is revoked', async () => {
    expect(await grant(EDITOR)).toMatchObject({
      ok: true,
      objectState: 'writable',
    })
    await migrator.query(
      `update api.project_access set can_edit=false where project_id=$1 and user_id=$2`,
      [PROJECT, EDITOR],
    )
    expect(await grant(EDITOR)).toMatchObject({
      ok: true,
      objectState: 'read_only',
    })
    await migrator.query(
      `delete from api.project_access where project_id=$1 and user_id=$2`,
      [PROJECT, EDITOR],
    )
    await denied(EDITOR, room())
    expect(
      await resolution.mentionSuggestionsForRoom(OWNER, room(), ''),
    ).not.toContain(EDITOR)
    const group = await migrator.query<{ id: string }>(
      `insert into api.workspace_groups(workspace_id,name) values($1,'Collaboration group') returning id`,
      [WS],
    )
    await migrator.query(
      `insert into api.workspace_group_memberships(workspace_id,group_id,user_id) values($1,$2,$3)`,
      [WS, group.rows[0].id, EDITOR],
    )
    await migrator.query(
      `insert into api.project_access(workspace_id,project_id,group_id,can_view,can_edit,granted_by_user_id) values($1,$2,$3,true,true,$4)`,
      [WS, PROJECT, group.rows[0].id, OWNER],
    )
    expect(await grant(EDITOR)).toMatchObject({
      ok: true,
      objectState: 'writable',
    })
    await migrator.query(
      `delete from api.workspace_group_memberships where group_id=$1 and user_id=$2`,
      [group.rows[0].id, EDITOR],
    )
    await denied(EDITOR, room())
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: EDITOR,
    })
    expect(await grant(EDITOR)).toMatchObject({ ok: true })
    await migrator.query(
      `update api.workspace_memberships set suspended_at=now() where workspace_id=$1 and user_id=$2`,
      [WS, EDITOR],
    )
    await denied(EDITOR, room())
    await migrator.query(
      `update api.workspace_memberships set suspended_at=null where workspace_id=$1 and user_id=$2`,
      [WS, EDITOR],
    )
    expect(await grant(EDITOR)).toMatchObject({ ok: true })
    await migrator.query(
      `delete from api.workspace_memberships where workspace_id=$1 and user_id=$2`,
      [WS, EDITOR],
    )
    await denied(EDITOR, room())
    await migrator.query(
      `update api.workspaces set status='archived' where id=$1`,
      [WS],
    )
    await denied(READER, room())
  })
})
