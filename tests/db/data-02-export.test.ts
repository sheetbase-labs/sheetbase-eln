/**
 * DATA-02 database contract proof: export receipts (api.data_exports) and the
 * canonical api.revision_evidence_package read. Runs against a freshly
 * migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '0d020000-0000-4000-8000-00000000000a'
const WS_B = '0d020000-0000-4000-8000-00000000000b'
const OWNER_A = 'data-02-owner-a'

const REVISION_A = '0d020000-0000-4000-8000-0000000000a1'
const FILE_RECORD_A = '0d020000-0000-4000-8000-0000000000a2'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  // Sheet-instance-style guards do not affect revisions, but the retained-file
  // trigger requires a canonical files array on every inserted revision.
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','Owner A','data-02-a@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','data-02-a','DATA-02 A'),
      ('${WS_B}','data-02-b','DATA-02 B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner');
    insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
    values ('${FILE_RECORD_A}','${WS_A}','file','FILE-2026-9001','Pinned bytes','${OWNER_A}');
    -- metadata_snapshot deliberately differs from the live record row so the
    -- package proves it reads the submitted snapshot, not current state.
    insert into api.revisions(id,workspace_id,record_id,reason,
      structure_version,metadata_version,metadata_snapshot,block_snapshot,
      canonical_snapshot,integrity_digest,created_by_user_id)
    values ('${REVISION_A}','${WS_A}','${FILE_RECORD_A}','submit',1,1,
      '{"record":{"identifier":"FILE-2026-9001","title":"Snapshot title","kind":"file","status":"submitted"}}','{}',
      '{"files":[]}', repeat('a',64),'${OWNER_A}');
  `)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('DATA-02 export receipts (api.data_exports)', () => {
  it('keeps request roles read-only: direct INSERT is revoked', async () => {
    const a = await actor(OWNER_A, WS_A)
    await expect(
      a.query(
        `insert into api.data_exports(workspace_id,object_type,object_id,format,actor_user_id)
         values ($1,'dataset',$2,'csv',$3)`,
        [WS_A, REVISION_A, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('scopes receipt reads to the workspace', async () => {
    // Seeded by migrator (the route writes over the app connection).
    await migrator.query(
      `insert into api.data_exports(workspace_id,object_type,object_id,format,row_count,actor_user_id)
       values ($1,'dataset',$2,'csv',5,$3)`,
      [WS_A, REVISION_A, OWNER_A],
    )
    const a = await actor(OWNER_A, WS_A)
    const { rows } = await a.query(
      `select object_type, format, actor_user_id from api.data_exports where object_id=$1`,
      [REVISION_A],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].format).toBe('csv')
    expect(rows[0].actor_user_id).toBe(OWNER_A)

    // A foreign workspace's claims see none of them.
    const foreignClaims = await asRole('authenticator')
    clients.push(foreignClaims)
    await foreignClaims.query('SET ROLE authenticated')
    await foreignClaims.query(
      `select set_config('request.jwt.claims',$1,false)`,
      [JSON.stringify({ sub: OWNER_A, workspace_id: WS_B })],
    )
    const { rows: foreignRows } = await foreignClaims.query(
      `select count(*)::int as n from api.data_exports where object_id=$1`,
      [REVISION_A],
    )
    expect(foreignRows[0].n).toBe(0)
  })

  it('enforces object-type integrity regardless of writer', async () => {
    await expect(
      migrator.query(
        `insert into api.data_exports(workspace_id,object_type,object_id,format,actor_user_id)
         values ($1,'widgets',$2,'csv',$3)`,
        [WS_A, REVISION_A, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('DATA-02 revision_evidence_package contract', () => {
  it('returns envelope, sheet evidence and file manifest together', async () => {
    await migrator.query(`
      insert into api.file_objects(id,workspace_id,record_id,storage_key,display_name,
        media_type,byte_size,status,storage_backend,checksum,created_by_user_id,updated_by_user_id)
      values ('0d020000-0000-4000-8000-0000000000b1','${WS_A}','${FILE_RECORD_A}',
        '${WS_A}/0d020000-0000-4000-8000-0000000000a2/' || repeat('a',32),
        'pinned.csv','text/csv',10,'active','local',repeat('b',64),'${OWNER_A}','${OWNER_A}');
      insert into internal.revision_file_objects(revision_id,file_object_id,workspace_id,
        file_record_id,storage_key,storage_backend,checksum_algorithm,checksum,byte_size)
      values ('${REVISION_A}','0d020000-0000-4000-8000-0000000000b1','${WS_A}',
        '${FILE_RECORD_A}',
        '${WS_A}/0d020000-0000-4000-8000-0000000000a2/' || repeat('a',32),
        'local','sha256',repeat('b',64),10);
    `)

    const a = await actor(OWNER_A, WS_A)
    const { rows } = await a.query(
      `select api.revision_evidence_package($1) as pkg`,
      [REVISION_A],
    )
    const pkg = rows[0].pkg
    expect(pkg.revision.id).toBe(REVISION_A)
    expect(pkg.revision.reason).toBe('submit')
    // Snapshot-derived, not the live row (live title is 'Pinned bytes').
    expect(pkg.record.identifier).toBe('FILE-2026-9001')
    expect(pkg.record.title).toBe('Snapshot title')
    expect(pkg.record.status).toBe('submitted')
    expect(pkg.files).toHaveLength(1)
    expect(pkg.files[0].checksum).toBe('b'.repeat(64))
    expect(pkg.sheetEvidence).toEqual([])
    expect(pkg.canonicalSnapshot.files).toEqual([])
    // Review/signature collections supersede export_revision_evidence.
    expect(pkg.decisions).toEqual([])
    expect(pkg.checkResults).toEqual([])
    expect(pkg.signatures).toEqual([])
    expect(pkg.comments).toEqual([])
    expect(pkg.submission).toBeNull()
  })

  it('denies another workspace without leaking existence', async () => {
    const b = await actor('data-02-owner-b', WS_B)
    await expect(
      b.query(`select api.revision_evidence_package($1)`, [REVISION_A]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects an unknown revision', async () => {
    const a = await actor(OWNER_A, WS_A)
    await expect(
      a.query(`select api.revision_evidence_package($1)`, [
        '0d020000-0000-4000-8000-0000000000ff',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
