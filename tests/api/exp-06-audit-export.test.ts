import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'

import { handleRecordAuditExport } from '#/lib/export/routes'
import { mintPostgrestToken } from '#/lib/postgrest-token'

const workspace = crypto.randomUUID()
const otherWorkspace = crypto.randomUUID()
const actorId = `exp-06-export-${crypto.randomUUID()}`
const outsiderId = `exp-06-outsider-${crypto.randomUUID()}`
const sessionId = `exp-06-session-${crypto.randomUUID()}`
let admin: Client
let actor: Client
let recordId: string
let beforeSequence: number
let expectedSequences: string[]

function deps(userId = actorId, workspaceId = workspace) {
  return {
    getSession: async () => ({
      user: { id: userId },
      session: { id: sessionId },
    }),
    getWorkspaceForUser: async () => ({ id: workspaceId }),
    mintToken: (input: {
      userId: string
      workspaceId: string
      sessionId: string
    }) =>
      mintPostgrestToken(
        z.string().min(32).parse(process.env.PGRST_JWT_SECRET),
        input,
      ),
  }
}

function request(query: string) {
  return new Request(
    `https://sheetbase.test/api/export/record/${recordId}/audit${query}`,
  )
}

beforeAll(async () => {
  admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
  actor = new Client({ connectionString: process.env.PGRST_DB_URI })
  await admin.connect()
  await actor.connect()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'Export owner',$1||'@sheetbase.test',true),($2,'Export outsider',$2||'@sheetbase.test',true)`,
    [actorId, outsiderId],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES($1::uuid,$1::uuid::text,'Export history'),($2::uuid,$2::uuid::text,'Other export workspace')`,
    [workspace, otherWorkspace],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')`,
    [workspace, actorId, otherWorkspace, outsiderId],
  )
  await admin.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$1,$2,now()+interval '1 hour')`,
    [sessionId, actorId],
  )
  await actor.query('SET ROLE authenticated')
  await actor.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: actorId,
      workspace_id: workspace,
      session_id: sessionId,
      role: 'authenticated',
    }),
  ])
  const projectId = z
    .uuid()
    .parse(
      (
        await actor.query(
          "SELECT id FROM api.create_project('Audit export project')",
        )
      ).rows[0].id,
    )
  recordId = z
    .uuid()
    .parse(
      (
        await actor.query(
          "SELECT id FROM api.create_record($1,'experiment','Title 0')",
          [projectId],
        )
      ).rows[0].id,
    )
  for (let index = 1; index <= 221; index++)
    await actor.query('UPDATE api.records SET title=$2 WHERE id=$1', [
      recordId,
      `Title ${index}`,
    ])
  beforeSequence = Number(
    (
      await admin.query(
        'SELECT max(sequence)+1 boundary FROM api.change_events WHERE workspace_id=$1',
        [workspace],
      )
    ).rows[0].boundary,
  )
  expectedSequences = (
    await admin.query<{ sequence: string }>(
      "SELECT sequence::text FROM api.change_events WHERE workspace_id=$1 AND entity_uuid=$2 AND operation='update' AND sequence<$3 ORDER BY api.change_events.sequence DESC",
      [workspace, recordId, beforeSequence],
    )
  ).rows.map((row) => row.sequence)
  await actor.query('UPDATE api.records SET title=$2 WHERE id=$1', [
    recordId,
    'Arrived after snapshot',
  ])
})

afterAll(async () => {
  await actor?.end()
  if (!admin) return
  await admin.end()
})

it('exports every filtered page in the viewed prefix and records the exact event count', async () => {
  const query = `?category=text&actor=${actorId}&before=${beforeSequence}`
  const response = await handleRecordAuditExport(
    request(query),
    recordId,
    deps(),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
  const body = await response.text()
  const lines = body.trimEnd().split('\r\n')
  expect(lines[0]).toBe(
    'time,sequence,actor,action,object,field,old_value,new_value,reason,client_id,payload',
  )
  expect(lines.slice(1).map((line) => line.split(',')[1])).toEqual(
    expectedSequences,
  )
  expect(lines).toHaveLength(222)
  expect(lines[1]).toContain(',Title,Title 220,Title 221,')
  expect(lines.at(-1)).toContain(',Title,Title 0,Title 1,')
  expect(body).not.toContain('Arrived after snapshot')
  const repeated = await handleRecordAuditExport(
    request(query),
    recordId,
    deps(),
  )
  expect(await repeated.text()).toBe(body)
  const receipts = await admin.query(
    "SELECT actor_user_id,row_count,byte_size FROM api.data_exports WHERE object_id=$1 AND format='audit-csv'",
    [recordId],
  )
  expect(receipts.rows).toEqual([
    {
      actor_user_id: actorId,
      row_count: 221,
      byte_size: String(new TextEncoder().encode(body).byteLength),
    },
    {
      actor_user_id: actorId,
      row_count: 221,
      byte_size: String(new TextEncoder().encode(body).byteLength),
    },
  ])
})

it('enforces actor/category selection instead of exporting unrelated rows', async () => {
  const response = await handleRecordAuditExport(
    request(`?category=signatures&before=${beforeSequence}`),
    recordId,
    deps(),
  )
  expect(response.status).toBe(200)
  expect((await response.text()).trimEnd().split('\r\n')).toHaveLength(1)
  const differentActor = await handleRecordAuditExport(
    request(`?category=text&actor=${outsiderId}&before=${beforeSequence}`),
    recordId,
    deps(),
  )
  expect(differentActor.status).toBe(200)
  expect((await differentActor.text()).trimEnd().split('\r\n')).toHaveLength(1)
})

it('denies cross-workspace exports and invalid/unbounded selections without writing receipts', async () => {
  const before = (
    await admin.query(
      'SELECT count(*)::int count FROM api.data_exports WHERE object_id=$1',
      [recordId],
    )
  ).rows[0].count
  const denied = await handleRecordAuditExport(
    request(`?before=${beforeSequence}`),
    recordId,
    deps(outsiderId, otherWorkspace),
  )
  const missing = await handleRecordAuditExport(
    request(`?before=${beforeSequence}`),
    crypto.randomUUID(),
    deps(),
  )
  expect(denied.status).toBe(404)
  expect(await denied.text()).toBe(await missing.text())
  for (const query of [
    '',
    '?before=0',
    '?before=1.5',
    `?category=unknown&before=${beforeSequence}`,
  ])
    expect(
      (await handleRecordAuditExport(request(query), recordId, deps())).status,
    ).toBe(400)
  expect(
    (
      await admin.query(
        'SELECT count(*)::int count FROM api.data_exports WHERE object_id=$1',
        [recordId],
      )
    ).rows[0].count,
  ).toBe(before)
})
