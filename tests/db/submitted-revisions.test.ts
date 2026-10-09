/**
 * REV-002 database contract: a submitted revision is one transactional,
 * immutable evidence envelope. The public seams are the preview/submit RPCs
 * and the RLS-protected REST resources they create.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '91000000-0000-4000-8000-000000000001'
const WS_B = '91000000-0000-4000-8000-000000000002'
const PROJECT_A = '92000000-0000-4000-8000-000000000001'
const PROJECT_B = '92000000-0000-4000-8000-000000000002'
const RECORD_A = '93000000-0000-4000-8000-000000000001'
const RECORD_B = '93000000-0000-4000-8000-000000000002'
const FILE_RECORD_A = '93000000-0000-4000-8000-000000000003'
const FILE_OBJECT_A = '94000000-0000-4000-8000-000000000001'
const FILE_STORAGE_KEY_A = `${WS_A}/${FILE_OBJECT_A}/${'a'.repeat(32)}`
const FILE_CHECKSUM_A = 'b'.repeat(64)
const OWNER_A = 'rev-owner-a'
const CONFIG_ADMIN_A = 'rev-config-admin-a'
const REVIEWER_A = 'rev-reviewer-a'
const OWNER_B = 'rev-owner-b'

let migrator: Client | undefined
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
    session_id: `session-${userId}`,
  })
}

async function authenticated(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    claims(userId, workspaceId),
  ])
  return client
}

async function preview(client: Client, recordId = RECORD_A) {
  const { rows } = await client.query(
    `SELECT api.preview_submission_digest($1) AS result`,
    [recordId],
  )
  return rows[0].result as {
    sourceDigest: string
    structureVersion: number
    metadataVersion: number
    calculationInputRevision: number
  }
}

async function submit(
  client: Client,
  sourceDigest: string,
  idempotencyKey: string,
  recordId = RECORD_A,
) {
  const { rows } = await client.query(
    `SELECT api.submit_record_revision(
       $1, $2, 'default-scientific-review', 1, ARRAY[$3]::text[], true, $4
     ) AS result`,
    [recordId, sourceDigest, REVIEWER_A, idempotencyKey],
  )
  return rows[0].result as {
    revision: { id: string; integrityDigest: string }
    submission: { id: string; state: string }
    idempotent: boolean
  }
}

async function submitWithDue(
  client: Client,
  sourceDigest: string,
  idempotencyKey: string,
  dueAt: string,
) {
  const { rows } = await client.query(
    `SELECT api.submit_record_revision(
       $1, $2, 'default-scientific-review', 1, ARRAY[$3]::text[], true, $4, $5
     ) AS result`,
    [RECORD_A, sourceDigest, REVIEWER_A, idempotencyKey, dueAt],
  )
  return rows[0].result as {
    revision: { id: string }
    submission: { id: string; state: string }
    idempotent: boolean
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator!.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Owner A','owner-a@rev.test',true),
       ($2,'Config Admin A','config-admin-a@rev.test',true),
       ($3,'Reviewer A','reviewer-a@rev.test',true),
       ($4,'Owner B','owner-b@rev.test',true)`,
    [OWNER_A, CONFIG_ADMIN_A, REVIEWER_A, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'rev-a','Revision A'),($2,'rev-b','Revision B')`,
    [WS_A, WS_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member'),($5,$6,'owner')`,
    [WS_A, OWNER_A, CONFIG_ADMIN_A, REVIEWER_A, WS_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES
       ($1,$2,'REV-A','Revision A',$3),($4,$5,'REV-B','Revision B',$6)`,
    [PROJECT_A, WS_A, OWNER_A, PROJECT_B, WS_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES
       ($1,$1,$2,now()+interval '1 hour'),
       ($3,$3,$4,now()+interval '1 hour'),
       ($5,$5,$6,now()+interval '1 hour'),
       ($7,$7,$8,now()+interval '1 hour')`,
    [
      `session-${OWNER_A}`,
      OWNER_A,
      `session-${CONFIG_ADMIN_A}`,
      CONFIG_ADMIN_A,
      `session-${REVIEWER_A}`,
      REVIEWER_A,
      `session-${OWNER_B}`,
      OWNER_B,
    ],
  )
  const configAdmin = await authenticated(CONFIG_ADMIN_A, WS_A)
  await configAdmin.query(
    `SELECT api.create_and_activate_model_field(
       $1,'experiment','temperature','Temperature','integer',true,null,
       '{}'::jsonb,'[]'::jsonb
     )`,
    [WS_A],
  )
  await migrator!.query(
    `INSERT INTO api.records
       (id,workspace_id,project_id,kind,identifier,title,status,custom_fields,tags,created_by_user_id)
     VALUES
       ($1,$2,$3,'experiment','EXP-REV-A','Submitted experiment','draft',
        '{"temperature":4}',ARRAY['stability'],$4),
       ($5,$6,$7,'experiment','EXP-REV-B','Other workspace experiment','draft',
        '{}','{}',$8),
       ($9,$2,$3,'file','FILE-REV-A','Submitted evidence.csv','active',
        '{}','{}',$4)`,
    [
      RECORD_A,
      WS_A,
      PROJECT_A,
      OWNER_A,
      RECORD_B,
      WS_B,
      PROJECT_B,
      OWNER_B,
      FILE_RECORD_A,
    ],
  )
  await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,'rich_text','{"doc":{"type":"doc","content":[]}}',100,$2)`,
    [RECORD_A, OWNER_A],
  )
  await migrator.query(
    `INSERT INTO api.file_objects
       (id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,
        checksum,status,storage_backend,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,'Submitted evidence.csv','text/csv',17,$5,'active','local',$6,$6)`,
    [
      FILE_OBJECT_A,
      WS_A,
      FILE_RECORD_A,
      FILE_STORAGE_KEY_A,
      FILE_CHECKSUM_A,
      OWNER_A,
    ],
  )
  await migrator.query(
    `INSERT INTO api.record_links
       (source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
     VALUES ($1,$2,'file','FILE-REV-A','file',$3)`,
    [RECORD_A, FILE_RECORD_A, OWNER_A],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

describe('REV-002 submitted revision contract', () => {
  it('WORK-01.1: an explicit due date overrides the project default', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    const dueAt = '2026-10-15T12:00:00.000Z'
    const created = await submitWithDue(
      owner,
      source.sourceDigest,
      'submit-due-override',
      dueAt,
    )
    const { rows } = await owner.query<{ due_at: Date }>(
      `SELECT due_at FROM api.review_submissions WHERE id = $1`,
      [created.submission.id],
    )
    expect(rows[0]?.due_at.toISOString()).toBe(dueAt)
  })

  it('WORK-01.1: without an override the due date uses the project period', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    const created = await submit(
      owner,
      source.sourceDigest,
      'submit-due-default',
    )
    const { rows } = await owner.query<{ due_at: Date; submitted_at: Date }>(
      `SELECT due_at, submitted_at FROM api.review_submissions WHERE id = $1`,
      [created.submission.id],
    )
    expect(rows[0]?.due_at).toBeInstanceOf(Date)
    const days = Math.round(
      (rows[0]!.due_at.getTime() - rows[0]!.submitted_at.getTime()) /
        86_400_000,
    )
    expect(days).toBe(7)
  })

  it('creates one attributed submission with a sha256-bound frozen envelope', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    expect(source.sourceDigest).toMatch(/^[0-9a-f]{64}$/)

    const created = await submit(owner, source.sourceDigest, 'submit-first')
    expect(created.idempotent).toBe(false)
    expect(created.submission.state).toBe('submitted')
    expect(created.revision.integrityDigest).toBe(source.sourceDigest)

    const { rows } = await owner.query(
      `SELECT r.integrity_digest,r.integrity_algorithm,r.canonical_snapshot,
              r.created_by_user_id,r.created_at,s.submitted_by_user_id,s.submitted_at,
              s.workflow_definition_key,s.workflow_definition_version,s.assigned_reviewer_user_ids,
              s.submitted_session_id,s.submitted_role
       FROM api.revisions r
       JOIN api.review_submissions s ON s.revision_id=r.id
       WHERE s.id=$1`,
      [created.submission.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      integrity_digest: source.sourceDigest,
      integrity_algorithm: 'sha256',
      created_by_user_id: OWNER_A,
      submitted_by_user_id: OWNER_A,
      workflow_definition_key: 'default-scientific-review',
      workflow_definition_version: 1,
      assigned_reviewer_user_ids: [REVIEWER_A],
      submitted_session_id: `session-${OWNER_A}`,
      submitted_role: 'authenticated',
    })
    expect(rows[0].created_at).toBeInstanceOf(Date)
    expect(rows[0].submitted_at).toBeInstanceOf(Date)
    expect(rows[0].canonical_snapshot.record.title).toBe('Submitted experiment')
    expect(rows[0].canonical_snapshot.blocks).toHaveLength(1)
    expect(rows[0].canonical_snapshot.files).toHaveLength(1)
    const digestCheck = await owner.query(
      `SELECT integrity_digest = encode(
         sha256(convert_to(canonical_snapshot::text,'UTF8')), 'hex'
       ) digest_matches_envelope
       FROM api.revisions WHERE id=$1`,
      [created.revision.id],
    )
    expect(digestCheck.rows[0].digest_matches_envelope).toBe(true)
    const retained = await migrator!.query(
      `SELECT file_object_id,file_record_id,storage_key,checksum,byte_size::text byte_size
       FROM internal.revision_file_objects WHERE revision_id=$1`,
      [created.revision.id],
    )
    expect(retained.rows).toEqual([
      {
        file_object_id: FILE_OBJECT_A,
        file_record_id: FILE_RECORD_A,
        storage_key: FILE_STORAGE_KEY_A,
        checksum: FILE_CHECKSUM_A,
        byte_size: '17',
      },
    ])
  })

  it('keeps later draft edits separate from the immutable submitted evidence', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    const created = await submit(
      owner,
      source.sourceDigest,
      'submit-separation',
    )

    await owner.query(
      `UPDATE api.records SET title='Later live draft',metadata_version=metadata_version+1
       WHERE id=$1`,
      [RECORD_A],
    )

    const { rows } = await owner.query(
      `SELECT canonical_snapshot->'record'->>'title' frozen_title,
              (SELECT title FROM api.records WHERE id=$1) live_title
       FROM api.revisions WHERE id=$2`,
      [RECORD_A, created.revision.id],
    )
    expect(rows[0]).toEqual({
      frozen_title: 'Submitted experiment',
      live_title: 'Later live draft',
    })
  })

  it('rejects a stale submission after a concurrent draft change', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const concurrent = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)

    await concurrent.query(
      `UPDATE api.records SET custom_fields='{"temperature":8}',metadata_version=metadata_version+1
       WHERE id=$1`,
      [RECORD_A],
    )

    await expect(
      submit(owner, source.sourceDigest, 'submit-stale'),
    ).rejects.toMatchObject({ code: 'SB001' })
    const { rows } = await owner.query(
      `SELECT count(*)::int n FROM api.review_submissions
       WHERE idempotency_key='submit-stale'`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('returns the same revision for an idempotent retry', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    const first = await submit(owner, source.sourceDigest, 'submit-retry')
    const retry = await submit(owner, source.sourceDigest, 'submit-retry')

    expect(retry.idempotent).toBe(true)
    expect(retry.revision.id).toBe(first.revision.id)
    expect(retry.submission.id).toBe(first.submission.id)
  })

  it('prevents ordinary inserts, updates and deletes of frozen revisions', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    const created = await submit(owner, source.sourceDigest, 'submit-immutable')

    await expect(
      owner.query(`UPDATE api.revisions SET reason='manual' WHERE id=$1`, [
        created.revision.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`DELETE FROM api.revisions WHERE id=$1`, [
        created.revision.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `INSERT INTO api.revisions
           (record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,
            reason,created_by_user_id,workspace_id,canonical_snapshot,integrity_digest)
         VALUES ($1,1,1,'{}','[]','submit',$2,$3,'{}',$4)`,
        [RECORD_A, OWNER_A, WS_A, '0'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('isolates preview, submission and REST resources by workspace', async () => {
    const ownerA = await authenticated(OWNER_A, WS_A)
    const ownerB = await authenticated(OWNER_B, WS_B)
    const source = await preview(ownerA)
    await submit(ownerA, source.sourceDigest, 'submit-isolation')

    await expect(preview(ownerB, RECORD_A)).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      submit(ownerB, source.sourceDigest, 'submit-cross-workspace', RECORD_A),
    ).rejects.toMatchObject({ code: '42501' })

    const revisions = await ownerB.query(`SELECT id FROM api.revisions`)
    const submissions = await ownerB.query(
      `SELECT id FROM api.review_submissions`,
    )
    expect(revisions.rows).toHaveLength(0)
    expect(submissions.rows).toHaveLength(0)
  })

  it('prevents record or actor deletion from cascading away submitted evidence', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    await submit(owner, source.sourceDigest, 'submit-retention')

    await expect(
      migrator!.query(`DELETE FROM api.records WHERE id=$1`, [RECORD_A]),
    ).rejects.toMatchObject({ code: '23001' })
    await expect(
      migrator!.query(`DELETE FROM internal."user" WHERE id=$1`, [OWNER_A]),
    ).rejects.toMatchObject({ code: '23001' })
  })

  it('retains submitted file bytes while allowing non-evidence draft metadata', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const source = await preview(owner)
    await submit(owner, source.sourceDigest, 'submit-file-retention')

    await expect(
      owner.query(`DELETE FROM api.file_objects WHERE id=$1`, [FILE_OBJECT_A]),
    ).rejects.toMatchObject({ code: '42501' })
    for (const status of ['missing', 'deleted']) {
      await expect(
        owner.query(
          `SELECT status FROM api.transition_file_status($1,$2,1,'lost bytes')`,
          [FILE_OBJECT_A, status],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    }
    await expect(
      owner.query(
        `UPDATE api.file_objects
         SET storage_key=$2,checksum=$3,byte_size=99,storage_backend='s3'
         WHERE id=$1`,
        [
          FILE_OBJECT_A,
          `${WS_A}/${FILE_OBJECT_A}/${'c'.repeat(32)}`,
          'd'.repeat(64),
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    await owner.query(
      `UPDATE api.file_objects SET display_name='Later draft label.csv' WHERE id=$1`,
      [FILE_OBJECT_A],
    )
    const { rows } = await owner.query(
      `SELECT display_name,storage_key,checksum,byte_size::text byte_size
       FROM api.file_objects WHERE id=$1`,
      [FILE_OBJECT_A],
    )
    expect(rows[0]).toEqual({
      display_name: 'Later draft label.csv',
      storage_key: FILE_STORAGE_KEY_A,
      checksum: FILE_CHECKSUM_A,
      byte_size: '17',
    })
  })
})
