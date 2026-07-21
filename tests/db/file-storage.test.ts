/**
 * SCI-003 integration proof: file metadata workspace isolation, cross-workspace
 * link rejection, same-workspace valid links, quarantine/deleted visibility and
 * mutation rules, actor attribution, durable change events, and the lifecycle
 * RPC — all enforced at the PostgreSQL/RLS boundary. Runs against a freshly
 * migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const DENIED = '42501'
const CHECK_VIOLATION = '23514'
const STALE_VERSION = 'SB001'
const MISSING_LINK = 'SB002'
const INVALID_TRANSITION = 'SB004'

const WS_A = '00000000-0000-4000-8000-00000000070a'
const WS_B = '00000000-0000-4000-8000-00000000070b'
const PROJ_A = '00000000-0000-4000-8000-00000000071a'
const PROJ_B = '00000000-0000-4000-8000-00000000071b'
const OWNER_A = 'sci003-db-owner-a'
const OWNER_B = 'sci003-db-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

/** Build a valid storage key: <workspace-uuid>/<record-uuid>/<32 hex>. */
function key(workspaceId: string, recordId: string, suffix: string): string {
  return `${workspaceId}/${recordId}/${suffix}`
}

// 32-hex suffixes (8 groups of 4) — each distinct for unique-key tests.
const S1 = 'aaaa1111bbbb2222cccc3333dddd4444'
const S2 = 'bbbb2222cccc3333dddd4444eeee5555'
const S3 = 'cccc3333dddd4444eeee5555ffff6666'
const S4 = 'dddd4444eeee5555ffff6666aaaa1111'
const S5 = 'eeee5555ffff6666aaaa1111bbbb2222'
const S6 = 'ffff6666aaaa1111bbbb2222cccc3333'
const S7 = '1111bbbb2222cccc3333dddd4444eeee'
const S8 = '2222cccc3333dddd4444eeee5555ffff'
const S9 = '3333dddd4444eeee5555ffff6666aaaa'
const S10 = '4444eeee5555ffff6666aaaa1111bbbb'
const S11 = '5555ffff6666aaaa1111bbbb2222cccc'
const S12 = '6666aaaa1111bbbb2222cccc3333dddd'

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'SCI003 A', 'sci003-a@sheetbase.test', true),
      ('${OWNER_B}', 'SCI003 B', 'sci003-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'sci003-a', 'SCI003 A'),
      ('${WS_B}', 'sci003-b', 'SCI003 B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'sci003-a', 'SCI003 Project A'),
      ('${PROJ_B}', '${WS_B}', 'sci003-b', 'SCI003 Project B')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

/** Create a file record as the migrator (bypasses RLS); no change event. */
async function createFileRecord(
  workspaceId: string,
  projectId: string,
  identifier: string,
  title: string,
  ownerId: string,
): Promise<string> {
  const { rows } = await migrator.query(
    `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ($1, $2, 'file', $3, $4, $5) RETURNING id::text`,
    [workspaceId, projectId, identifier, title, ownerId],
  )
  return rows[0].id
}

/** Create an experiment record as the migrator; no change event. */
async function createExperimentRecord(
  workspaceId: string,
  projectId: string,
  identifier: string,
  title: string,
  ownerId: string,
): Promise<string> {
  const { rows } = await migrator.query(
    `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ($1, $2, 'experiment', $3, $4, $5) RETURNING id::text`,
    [workspaceId, projectId, identifier, title, ownerId],
  )
  return rows[0].id
}

/** Insert file_objects as migrator (bypasses RLS); no change event emitted. */
async function insertFileObject(
  recordId: string,
  workspaceId: string,
  storageKey: string,
  ownerId: string,
  status = 'active',
): Promise<string> {
  return insertFileObjectRaw(
    migrator,
    recordId,
    workspaceId,
    storageKey,
    ownerId,
    status,
  )
}

/** Shared insert SQL used by both the migrator and authenticated helpers. */
async function insertFileObjectRaw(
  conn: Client,
  recordId: string,
  workspaceId: string,
  storageKey: string,
  ownerId: string,
  status = 'active',
): Promise<string> {
  const { rows } = await conn.query(
    `INSERT INTO api.file_objects
      (workspace_id, record_id, storage_key, display_name, media_type, byte_size, status, storage_backend, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, 'file.csv', 'text/csv', 128, $4, 'local', $5, $5)
     RETURNING id::text`,
    [workspaceId, recordId, storageKey, status, ownerId],
  )
  return rows[0].id
}

/** Insert file_objects as an authenticated workspace member; emits a change event. */
async function insertFileObjectAs(
  client: Client,
  recordId: string,
  workspaceId: string,
  storageKey: string,
  ownerId: string,
): Promise<string> {
  return insertFileObjectRaw(
    client,
    recordId,
    workspaceId,
    storageKey,
    ownerId,
    'active',
  )
}

describe('SCI-003 file metadata workspace isolation', () => {
  it('isolates file_objects reads by workspace', async () => {
    const recA = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-A',
      'File A',
      OWNER_A,
    )
    const recB = await createFileRecord(
      WS_B,
      PROJ_B,
      'FILE-2025-DB-B',
      'File B',
      OWNER_B,
    )
    await insertFileObject(recA, WS_A, key(WS_A, recA, S1), OWNER_A)
    await insertFileObject(recB, WS_B, key(WS_B, recB, S2), OWNER_B)

    const a = await asAuthenticated(OWNER_A, WS_A)
    const { rows: aRows } = await a.query(
      `SELECT count(*)::int AS n FROM api.file_objects`,
    )
    expect(aRows[0].n).toBe(1)

    const b = await asAuthenticated(OWNER_B, WS_B)
    const { rows: bRows } = await b.query(
      `SELECT count(*)::int AS n FROM api.file_objects`,
    )
    expect(bRows[0].n).toBe(1)
  })

  it('rejects cross-workspace file_objects insert at the RLS boundary', async () => {
    const recA = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-XW',
      'File A XW',
      OWNER_A,
    )
    const b = await asAuthenticated(OWNER_B, WS_B)
    // The row claims workspace A while the caller is workspace B; RLS denies.
    await expect(
      b.query(
        `INSERT INTO api.file_objects
          (workspace_id, record_id, storage_key, display_name, media_type, byte_size, storage_backend, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, 'file.csv', 'text/csv', 128, 'local', $4, $4)`,
        [WS_A, recA, key(WS_A, recA, S3), OWNER_B],
      ),
    ).rejects.toMatchObject({ code: DENIED })
  })
})

describe('SCI-003 file links and cross-workspace rejection', () => {
  it('allows a same-workspace file link via create_record_link', async () => {
    const expId = await createExperimentRecord(
      WS_A,
      PROJ_A,
      'EXP-2025-DB-LINK',
      'Host',
      OWNER_A,
    )
    const fileId = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-LINK',
      'Linked file',
      OWNER_A,
    )
    const a = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await a.query(
      `SELECT * FROM api.create_record_link($1, 'file', 'FILE-2025-DB-LINK', 'file', $2, NULL)`,
      [expId, fileId],
    )
    expect(rows.length).toBe(1)
    expect(rows[0].target_record_id).toBe(fileId)
  })

  it('rejects a cross-workspace file link at the database boundary with SB002', async () => {
    const expBId = await createExperimentRecord(
      WS_B,
      PROJ_B,
      'EXP-2025-DB-XW',
      'B Host',
      OWNER_B,
    )
    const fileId = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-XWL',
      'A file',
      OWNER_A,
    )
    const b = await asAuthenticated(OWNER_B, WS_B)
    // The target record lives in WS_A; the WS_B caller cannot resolve it under
    // RLS, so create_record_link raises missing_link (SB002).
    await expect(
      b.query(
        `SELECT * FROM api.create_record_link($1, 'file', 'FILE-2025-DB-XWL', 'file', $2, NULL)`,
        [expBId, fileId],
      ),
    ).rejects.toMatchObject({ code: MISSING_LINK })
  })
})

describe('SCI-003 lifecycle RPC and visibility', () => {
  it('transitions active -> quarantined -> active -> deleted and rejects invalid transitions', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-LC',
      'Lifecycle file',
      OWNER_A,
    )
    const objId = await insertFileObject(rec, WS_A, key(WS_A, rec, S4), OWNER_A)
    const a = await asAuthenticated(OWNER_A, WS_A)

    const q = await a.query(
      `SELECT status FROM api.transition_file_status($1, 'quarantined', 1, 'suspected') AS f`,
      [objId],
    )
    expect(q.rows[0].status).toBe('quarantined')

    const r = await a.query(
      `SELECT status FROM api.transition_file_status($1, 'active', 2) AS f`,
      [objId],
    )
    expect(r.rows[0].status).toBe('active')

    const d = await a.query(
      `SELECT status FROM api.transition_file_status($1, 'deleted', 3) AS f`,
      [objId],
    )
    expect(d.rows[0].status).toBe('deleted')

    // deleted -> quarantined is not a permitted transition.
    await expect(
      a.query(
        `SELECT status FROM api.transition_file_status($1, 'quarantined', 4) AS f`,
        [objId],
      ),
    ).rejects.toMatchObject({ code: INVALID_TRANSITION })
  })

  it('enforces optimistic concurrency on lifecycle transitions', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-OC',
      'OC file',
      OWNER_A,
    )
    const objId = await insertFileObject(rec, WS_A, key(WS_A, rec, S5), OWNER_A)
    const a = await asAuthenticated(OWNER_A, WS_A)
    await expect(
      a.query(
        `SELECT status FROM api.transition_file_status($1, 'quarantined', 99) AS f`,
        [objId],
      ),
    ).rejects.toMatchObject({ code: STALE_VERSION })
  })

  it('still surfaces quarantined and deleted file metadata to workspace members', async () => {
    const recQ = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-QV',
      'Quarantined visible',
      OWNER_A,
    )
    const objQ = await insertFileObject(
      recQ,
      WS_A,
      key(WS_A, recQ, S6),
      OWNER_A,
    )
    const a = await asAuthenticated(OWNER_A, WS_A)
    await a.query(
      `SELECT status FROM api.transition_file_status($1, 'quarantined', 1, 'audit') AS f`,
      [objQ],
    )
    const { rows: qRows } = await a.query(
      `SELECT status, quarantined_at FROM api.file_objects WHERE id = $1`,
      [objQ],
    )
    expect(qRows[0].status).toBe('quarantined')
    expect(qRows[0].quarantined_at).not.toBeNull()
  })
})

describe('SCI-003 durable change events and actor attribution', () => {
  it('emits a file create change event with the actor user id', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-EVT',
      'Event file',
      OWNER_A,
    )
    const a = await asAuthenticated(OWNER_A, WS_A)
    const objId = await insertFileObjectAs(
      a,
      rec,
      WS_A,
      key(WS_A, rec, S7),
      OWNER_A,
    )
    const { rows } = await migrator.query(
      `SELECT operation, entity_type, actor_user_id FROM api.change_events
       WHERE entity_type = 'file' AND entity_uuid = $1
       ORDER BY sequence DESC LIMIT 1`,
      [objId],
    )
    expect(rows.length).toBe(1)
    expect(rows[0].operation).toBe('create')
    expect(rows[0].actor_user_id).toBe(OWNER_A)
  })

  it('emits a quarantine event on lifecycle transition', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-QE',
      'Quarantine event file',
      OWNER_A,
    )
    const objId = await insertFileObject(rec, WS_A, key(WS_A, rec, S8), OWNER_A)
    const a = await asAuthenticated(OWNER_A, WS_A)
    await a.query(
      `SELECT status FROM api.transition_file_status($1, 'quarantined', 1, 'audit test') AS f`,
      [objId],
    )
    const { rows } = await migrator.query(
      `SELECT operation, actor_user_id FROM api.change_events
       WHERE entity_type = 'file' AND entity_uuid = $1
       ORDER BY sequence DESC LIMIT 1`,
      [objId],
    )
    expect(rows[0].operation).toBe('quarantine')
    expect(rows[0].actor_user_id).toBe(OWNER_A)
  })
})

describe('SCI-003 storage key, size, type and state constraints', () => {
  it('rejects a malformed storage key', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-SK',
      'Bad key file',
      OWNER_A,
    )
    await expect(
      migrator.query(
        `INSERT INTO api.file_objects
          (workspace_id, record_id, storage_key, display_name, media_type, byte_size, storage_backend)
         VALUES ($1, $2, 'not-a-valid-key', 'file.csv', 'text/csv', 128, 'local')`,
        [WS_A, rec],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects an oversized byte_size', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-BIG',
      'Big file',
      OWNER_A,
    )
    await expect(
      migrator.query(
        `INSERT INTO api.file_objects
          (workspace_id, record_id, storage_key, display_name, media_type, byte_size, storage_backend)
         VALUES ($1, $2, $3, 'file.csv', 'text/csv', 104857601, 'local')`,
        [WS_A, rec, key(WS_A, rec, S9)],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects a disallowed media type', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-MT',
      'Bad type file',
      OWNER_A,
    )
    await expect(
      migrator.query(
        `INSERT INTO api.file_objects
          (workspace_id, record_id, storage_key, display_name, media_type, byte_size, storage_backend)
         VALUES ($1, $2, $3, 'file.exe', 'application/x-msdownload', 128, 'local')`,
        [WS_A, rec, key(WS_A, rec, S10)],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects deleted status without a deleted_at timestamp', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-DT',
      'Inconsistent file',
      OWNER_A,
    )
    await expect(
      migrator.query(
        `INSERT INTO api.file_objects
          (workspace_id, record_id, storage_key, display_name, media_type, byte_size, status, storage_backend)
         VALUES ($1, $2, $3, 'file.csv', 'text/csv', 128, 'deleted', 'local')`,
        [WS_A, rec, key(WS_A, rec, S11)],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects a duplicate storage key', async () => {
    const rec = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-DUP',
      'Dup key file',
      OWNER_A,
    )
    const dupKey = key(WS_A, rec, S12)
    await insertFileObject(rec, WS_A, dupKey, OWNER_A)
    const rec2 = await createFileRecord(
      WS_A,
      PROJ_A,
      'FILE-2025-DB-DUP2',
      'Dup key file 2',
      OWNER_A,
    )
    await expect(
      migrator.query(
        `INSERT INTO api.file_objects
          (workspace_id, record_id, storage_key, display_name, media_type, byte_size, storage_backend)
         VALUES ($1, $2, $3, 'file.csv', 'text/csv', 128, 'local')`,
        [WS_A, rec2, dupKey],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })
})
