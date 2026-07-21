/**
 * SCI-003 API contract proof. The file byte routes (authorize/upload/download)
 * and the metadata RPCs go through the real PostgREST + database; the admin
 * connection is used only for fixture setup, cleanup, storage-object
 * manipulation, and durable-event verification. A local filesystem
 * ObjectStorage backed by a temp dir stands in for the object-storage service.
 */
import { config } from 'dotenv'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  LocalFileStorage,
  setObjectStorageForTesting,
} from '#/lib/file-storage'
import {
  handleDownload,
  handleUpload,
  handleUploadAuthorize,
} from '#/lib/file-routes'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS_A = '6c000000-0000-4000-8000-000000000001'
const WS_B = '6c000000-0000-4000-8000-000000000002'
const PROJECT_A = '6c000000-0000-4000-8000-000000000003'
const PROJECT_B = '6c000000-0000-4000-8000-000000000004'
const USER_A = 'sci-003-api-owner-a'
const USER_B = 'sci-003-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let storageDir: string
let storage: LocalFileStorage

function authDeps(userId: string, workspaceId: string) {
  return {
    getSession: async () => ({
      user: { id: userId },
      session: { id: 'sci-003-session' },
    }),
    getWorkspaceForUser: async () => ({ id: workspaceId }),
    mintToken: (input: {
      userId: string
      workspaceId: string
      sessionId: string
      clientId?: string | null
    }) => mintPostgrestToken(SECRET, input),
  }
}

function proxy(
  path: string,
  userId: string,
  workspaceId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'sci-003-session' },
      }),
      getWorkspaceForUser: async () => ({ id: workspaceId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

async function rpc(
  name: string,
  userId: string,
  workspaceId: string,
  body: unknown,
) {
  return proxy(`rpc/${name}`, userId, workspaceId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createRecord(
  userId: string,
  workspaceId: string,
  projectId: string,
  kind: string,
  title: string,
  status = 'draft',
) {
  const res = await rpc('create_record', userId, workspaceId, {
    p_project_id: projectId,
    p_kind: kind,
    p_title: title,
    p_status: status,
  })
  expect(res.status).toBe(200)
  return res.json()
}

function authorizeRequest(userId: string, workspaceId: string, body: unknown) {
  return new Request('http://sheetbase.test/api/files/upload-authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function uploadRequest(
  fileRecordId: string,
  bytes: Uint8Array,
  contentType = 'text/csv',
) {
  return new Request(`http://sheetbase.test/api/files/${fileRecordId}/upload`, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: bytes,
  })
}

function downloadRequest(fileRecordId: string) {
  return new Request(
    `http://sheetbase.test/api/files/${fileRecordId}/download`,
    {
      method: 'GET',
    },
  )
}

async function clean() {
  await admin.query(
    `DELETE FROM api.file_objects WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM internal."user" WHERE id IN ($1,$2)`, [
    USER_A,
    USER_B,
  ])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  storageDir = await mkdtemp(join(tmpdir(), 'sheetbase-sci003-api-'))
  storage = new LocalFileStorage(storageDir)
  setObjectStorageForTesting(storage)
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 003 API A','sci-003-api-a@test.invalid',true),
      ($2,'SCI 003 API B','sci-003-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-003-api-a','SCI 003 API A'),($2,'sci-003-api-b','SCI 003 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci003a','SCI 003 API A'),($3,$4,'sci003b','SCI 003 API B')`,
    [PROJECT_A, WS_A, PROJECT_B, WS_B],
  )
})

afterAll(async () => {
  setObjectStorageForTesting(null)
  if (admin) {
    await clean()
    await admin.end()
  }
  if (storageDir) await rm(storageDir, { recursive: true, force: true })
})

async function authorizeAndUpload(
  userId: string,
  workspaceId: string,
  projectId: string,
  file: { name: string; type: string; bytes: Uint8Array; checksum?: string },
) {
  const authRes = await handleUploadAuthorize(
    authorizeRequest(userId, workspaceId, {
      projectId,
      displayName: file.name,
      mediaType: file.type,
      byteSize: file.bytes.byteLength,
      checksum: file.checksum ?? null,
    }),
    authDeps(userId, workspaceId),
  )
  expect(authRes.status).toBe(201)
  const meta = await authRes.json()
  const upRes = await handleUpload(
    uploadRequest(meta.fileRecordId, file.bytes, file.type),
    meta.fileRecordId,
    authDeps(userId, workspaceId),
    storage,
  )
  return { authRes, upRes, meta }
}

describe('SCI-003 file upload, download and isolation', () => {
  it('authorizes, uploads, and downloads a file successfully', async () => {
    const bytes = new TextEncoder().encode('virus stability run 07,4C,day0\n')
    const { upRes, meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'stability-run07.csv',
      type: 'text/csv',
      bytes,
    })
    expect(upRes.status).toBe(200)
    const finalize = await upRes.json()
    expect(finalize.status).toBe('active')
    expect(finalize.checksum).toMatch(/^[0-9a-f]{64}$/)

    const dlRes = await handleDownload(
      downloadRequest(meta.fileRecordId),
      meta.fileRecordId,
      authDeps(USER_A, WS_A),
      storage,
    )
    expect(dlRes.status).toBe(200)
    expect(dlRes.headers.get('content-type')).toBe('text/csv')
    expect(dlRes.headers.get('content-disposition')).toContain(
      'stability-run07.csv',
    )
    const body = await dlRes.text()
    expect(body).toBe(new TextDecoder().decode(bytes))
  })

  it('rejects an oversized upload and marks the file missing', async () => {
    const authRes = await handleUploadAuthorize(
      authorizeRequest(USER_A, WS_A, {
        projectId: PROJECT_A,
        displayName: 'big.csv',
        mediaType: 'text/csv',
        byteSize: 10,
      }),
      authDeps(USER_A, WS_A),
    )
    expect(authRes.status).toBe(201)
    const meta = await authRes.json()
    const big = new Uint8Array(2 * 1024 * 1024)
    // Wrap the storage so putStream enforces a tiny cap regardless of the
    // route's global 100 MiB limit, exercising the 413 + mark-missing path
    // without streaming 100 MiB through the test.
    const cappedStorage: LocalFileStorage = {
      ...storage,
      putStream: (key, body) => storage.putStream(key, body, 10),
    }
    const upRes = await handleUpload(
      uploadRequest(meta.fileRecordId, big),
      meta.fileRecordId,
      authDeps(USER_A, WS_A),
      cappedStorage,
    )
    expect(upRes.status).toBe(413)
    const err = await upRes.json()
    expect(err.error.code).toBe('oversize')

    const { rows } = await admin.query(
      `SELECT status FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    expect(rows[0].status).toBe('missing')
  })

  it('rejects a checksum mismatch and marks the file missing', async () => {
    const claimed = '0'.repeat(64) // wrong on purpose
    const bytes = new TextEncoder().encode('payload that will not match')
    const authRes = await handleUploadAuthorize(
      authorizeRequest(USER_A, WS_A, {
        projectId: PROJECT_A,
        displayName: 'mismatch.csv',
        mediaType: 'text/csv',
        byteSize: bytes.byteLength,
        checksum: claimed,
      }),
      authDeps(USER_A, WS_A),
    )
    const meta = await authRes.json()
    const upRes = await handleUpload(
      uploadRequest(meta.fileRecordId, bytes),
      meta.fileRecordId,
      authDeps(USER_A, WS_A),
      storage,
    )
    expect(upRes.status).toBe(409)
    const err = await upRes.json()
    expect(err.error.code).toBe('checksum_mismatch')
    const { rows } = await admin.query(
      `SELECT status FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    expect(rows[0].status).toBe('missing')
  })

  it('rejects a disallowed media type at authorize time', async () => {
    const res = await handleUploadAuthorize(
      authorizeRequest(USER_A, WS_A, {
        projectId: PROJECT_A,
        displayName: 'evil.exe',
        mediaType: 'application/x-msdownload',
        byteSize: 10,
      }),
      authDeps(USER_A, WS_A),
    )
    expect(res.status).toBe(400)
    const err = await res.json()
    expect(err.error.code).toBe('policy_violation')
  })

  it('rejects cross-workspace download access', async () => {
    const bytes = new TextEncoder().encode('private to workspace A')
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'private.csv',
      type: 'text/csv',
      bytes,
    })
    // Workspace B user attempts download.
    const dlRes = await handleDownload(
      downloadRequest(meta.fileRecordId),
      meta.fileRecordId,
      authDeps(USER_B, WS_B),
      storage,
    )
    expect(dlRes.status).toBe(404)
    const err = await dlRes.json()
    expect(err.error.code).toBe('not_found')
  })

  it('renders a missing storage object honestly after reconcile', async () => {
    const bytes = new TextEncoder().encode('will be removed from storage')
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'gone.csv',
      type: 'text/csv',
      bytes,
    })
    // Simulate storage loss (e.g. disk cleanup) behind the boundary.
    const { rows } = await admin.query(
      `SELECT storage_key FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    await storage.delete(rows[0].storage_key)
    const dlRes = await handleDownload(
      downloadRequest(meta.fileRecordId),
      meta.fileRecordId,
      authDeps(USER_A, WS_A),
      storage,
    )
    expect(dlRes.status).toBe(404)
    const err = await dlRes.json()
    expect(err.error.code).toBe('missing')
    // The reconcile made the state durable.
    const { rows: after } = await admin.query(
      `SELECT status FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    expect(after[0].status).toBe('missing')
  })

  it('quarantines, restores, and soft-deletes a file via the lifecycle RPC', async () => {
    const bytes = new TextEncoder().encode('lifecycle subject')
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'lifecycle.csv',
      type: 'text/csv',
      bytes,
    })
    const { rows } = await admin.query(
      `SELECT id, version FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    const fileId = rows[0].id
    const v0 = rows[0].version

    // Quarantine.
    const q = await rpc('transition_file_status', USER_A, WS_A, {
      p_file_id: fileId,
      p_target_status: 'quarantined',
      p_expected_version: v0,
      p_reason: 'suspected corruption',
    })
    expect(q.status).toBe(200)
    const quarantined = await q.json()
    expect(quarantined.status).toBe('quarantined')
    // Download is refused honestly.
    const dlQ = await handleDownload(
      downloadRequest(meta.fileRecordId),
      meta.fileRecordId,
      authDeps(USER_A, WS_A),
      storage,
    )
    expect(dlQ.status).toBe(410)
    expect((await dlQ.json()).error.code).toBe('quarantined')

    // Restore.
    const r = await rpc('transition_file_status', USER_A, WS_A, {
      p_file_id: fileId,
      p_target_status: 'active',
      p_expected_version: quarantined.version,
    })
    expect(r.status).toBe(200)

    // Soft delete.
    const active = await r.json()
    const d = await rpc('transition_file_status', USER_A, WS_A, {
      p_file_id: fileId,
      p_target_status: 'deleted',
      p_expected_version: active.version,
    })
    expect(d.status).toBe(200)
    expect((await d.json()).status).toBe('deleted')
    const dlD = await handleDownload(
      downloadRequest(meta.fileRecordId),
      meta.fileRecordId,
      authDeps(USER_A, WS_A),
      storage,
    )
    expect(dlD.status).toBe(410)
    expect((await dlD.json()).error.code).toBe('deleted')
  })

  it('rejects an invalid lifecycle transition at the database boundary', async () => {
    const bytes = new TextEncoder().encode('bad transition')
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'bad.csv',
      type: 'text/csv',
      bytes,
    })
    const { rows } = await admin.query(
      `SELECT id, version FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    // active -> deleted is allowed, but deleted -> quarantined is not.
    const d = await rpc('transition_file_status', USER_A, WS_A, {
      p_file_id: rows[0].id,
      p_target_status: 'deleted',
      p_expected_version: rows[0].version,
    })
    expect(d.status).toBe(200)
    const deleted = await d.json()
    const bad = await rpc('transition_file_status', USER_A, WS_A, {
      p_file_id: rows[0].id,
      p_target_status: 'quarantined',
      p_expected_version: deleted.version,
    })
    expect(bad.status).toBeGreaterThanOrEqual(400)
  })

  it('links a file to an experiment with provenance and emits durable events', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'File link host',
    )
    const bytes = new TextEncoder().encode('linked file bytes')
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'linked.csv',
      type: 'text/csv',
      bytes,
    })
    const linkRes = await rpc('create_record_link', USER_A, WS_A, {
      p_source_record_id: experiment.id,
      p_target_record_id: meta.fileRecordId,
      p_target_kind: 'file',
      p_target_identifier: meta.fileIdentifier,
      p_link_type: 'file',
    })
    expect(linkRes.status).toBe(200)

    // A file.created change event was emitted for the file object.
    const { rows } = await admin.query(
      `SELECT operation, entity_type, actor_user_id FROM api.change_events
       WHERE workspace_id=$1 AND entity_type='file' AND entity_uuid=(
         SELECT id FROM api.file_objects WHERE record_id=$2
       ) ORDER BY sequence DESC LIMIT 3`,
      [WS_A, meta.fileRecordId],
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.operation === 'create')).toBe(true)
    expect(rows[0].actor_user_id).toBe(USER_A)
  })

  it('rejects a cross-workspace file link at the database boundary', async () => {
    const experimentA = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'A host',
    )
    const bytes = new TextEncoder().encode('ws A file')
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'wsA.csv',
      type: 'text/csv',
      bytes,
    })
    // Workspace B experiment tries to link workspace A's file.
    const experimentB = await createRecord(
      USER_B,
      WS_B,
      PROJECT_B,
      'experiment',
      'B host',
    )
    const linkRes = await rpc('create_record_link', USER_B, WS_B, {
      p_source_record_id: experimentB.id,
      p_target_record_id: meta.fileRecordId,
      p_target_kind: 'file',
      p_target_identifier: meta.fileIdentifier,
      p_link_type: 'file',
    })
    // The same-workspace trigger rejects this (the B record cannot link to an
    // A file because the target record is in a different workspace).
    expect(linkRes.status).toBeGreaterThanOrEqual(400)
  })
  it('rejects upload-authorize without a session', async () => {
    const res = await handleUploadAuthorize(
      authorizeRequest(USER_A, WS_A, {
        projectId: PROJECT_A,
        displayName: 'noauth.csv',
        mediaType: 'text/csv',
        byteSize: 10,
      }),
      {
        ...authDeps(USER_A, WS_A),
        getSession: async () => null,
      },
    )
    expect(res.status).toBe(401)
    const err = await res.json()
    expect(err.error.code).toBe('unauthenticated')
  })

  it('exposes file_objects metadata through /api/db with status filtering', async () => {
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'filter.csv',
      type: 'text/csv',
      bytes: new TextEncoder().encode('filter me'),
    })

    const getRes = await proxy(
      `file_objects?record_id=eq.${meta.fileRecordId}&select=status,display_name,media_type,byte_size,storage_key`,
      USER_A,
      WS_A,
    )
    expect(getRes.status).toBe(200)
    const rows = await getRes.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('active')
    expect(rows[0].display_name).toBe('filter.csv')
    expect(rows[0].media_type).toBe('text/csv')
    expect(rows[0].storage_key).toMatch(/\/[0-9a-f]{32}$/)

    const qRes = await rpc('transition_file_status', USER_A, WS_A, {
      p_file_id: meta.fileObjectId,
      p_target_status: 'quarantined',
      p_expected_version: 1,
      p_reason: 'metadata filter test',
    })
    expect(qRes.status).toBe(200)

    const activeRes = await proxy(
      `file_objects?record_id=eq.${meta.fileRecordId}&status=eq.active&select=status`,
      USER_A,
      WS_A,
    )
    const activeRows = await activeRes.json()
    expect(activeRows).toHaveLength(0)

    const qFilterRes = await proxy(
      `file_objects?record_id=eq.${meta.fileRecordId}&status=eq.quarantined&select=status`,
      USER_A,
      WS_A,
    )
    const qRows = await qFilterRes.json()
    expect(qRows).toHaveLength(1)
    expect(qRows[0].status).toBe('quarantined')
  })

  it('denies cross-workspace file_objects metadata reads', async () => {
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'private-meta.csv',
      type: 'text/csv',
      bytes: new TextEncoder().encode('private metadata'),
    })
    const res = await proxy(
      `file_objects?record_id=eq.${meta.fileRecordId}&select=status`,
      USER_B,
      WS_B,
    )
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows).toHaveLength(0)
  })

  it('allows same-workspace display_name updates via /api/db PATCH and emits an update event', async () => {
    const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
      name: 'rename-me.csv',
      type: 'text/csv',
      bytes: new TextEncoder().encode('rename payload'),
    })
    const before = await admin.query(
      `SELECT version FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    const patchRes = await proxy(
      `file_objects?record_id=eq.${meta.fileRecordId}`,
      USER_A,
      WS_A,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: 'renamed-safely.csv' }),
      },
    )
    expect(patchRes.status).toBe(204)
    const after = await admin.query(
      `SELECT display_name, version, updated_by_user_id FROM api.file_objects WHERE record_id=$1`,
      [meta.fileRecordId],
    )
    expect(after.rows[0].display_name).toBe('renamed-safely.csv')
    expect(after.rows[0].version).toBe(before.rows[0].version)
    expect(after.rows[0].updated_by_user_id).toBe(USER_A)
    const events = await admin.query(
      `SELECT operation FROM api.change_events
       WHERE workspace_id=$1 AND entity_type='file' AND entity_uuid=(
         SELECT id FROM api.file_objects WHERE record_id=$2
       ) ORDER BY sequence DESC LIMIT 2`,
      [WS_A, meta.fileRecordId],
    )
    expect(events.rows.some((r) => r.operation === 'update')).toBe(true)
  })
})
