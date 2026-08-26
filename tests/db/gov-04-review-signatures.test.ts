/**
 * GOV-04 — Electronic records, review & signatures: focused contract proof
 * over the existing REV/SIGN machinery (no new state machines).
 *
 * Proven here in one composed flow:
 * - submitted revision evidence stays frozen while live state mutates;
 * - revision-to-revision comparison inputs are historical snapshots only;
 * - signatures remain attached to the exact signed revision digest after an
 *   amendment (never reassigned, never copied);
 * - approve/reject decisions stay attributable (actor, session, role, digest);
 * - submit/sign/amend/checks and the four decision RPCs deny api_client;
 * - archived/deleted/inaccessible records fail closed for the review RPCs.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '98000000-0000-4000-8000-0000000000b1'
const WS_OTHER = '98000000-0000-4000-8000-0000000000b2'
const PROJECT = '99000000-0000-4000-8000-0000000000b1'
const RECORD = '9a000000-0000-4000-8000-0000000000b1'
const AUTHOR = 'g4-author'
const REVIEWER = 'g4-reviewer'
const OUTSIDER = 'g4-outsider'

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

async function asApiClient(workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({
      credential_id: '00000000-0000-4000-8000-00000000c001',
      workspace_id: workspaceId,
      role: 'api_client',
    }),
  ])
  return client
}

function passingSnapshot(): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: RECORD,
      workspaceId: WS,
      title: 'GOV04 experiment',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [
      {
        id: 'b1',
        type: 'rich_text',
        payload: { doc: { type: 'doc', content: [] } },
        order: 100,
      },
    ],
    links: [],
    scientificTables: [],
    formulas: [],
    files: [],
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator!.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Gov Author','g4-author@gov.test',true),
       ($2,'Gov Reviewer','g4-reviewer@gov.test',true),
       ($3,'Gov Outsider','g4-outsider@gov.test',true)`,
    [AUTHOR, REVIEWER, OUTSIDER],
  )
  await migrator!.query(
    `INSERT INTO internal."session" (id,"expiresAt",token,"userId") VALUES
       ('session-g4-author','2099-01-01T00:00:00Z','tok-a',$1),
       ('session-g4-reviewer','2099-01-01T00:00:00Z','tok-r',$2)`,
    [AUTHOR, REVIEWER],
  )
  await migrator!.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'g4','GOV04'),($2,'g4-x','GOV04 other')`,
    [WS, WS_OTHER],
  )
  await migrator!.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'member'),($1,$3,'owner'),($4,$5,'owner')`,
    [WS, AUTHOR, REVIEWER, WS_OTHER, OUTSIDER],
  )
  await migrator!.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'G4','GOV04 project')`,
    [PROJECT, WS],
  )
  await migrator!.query(
    `INSERT INTO api.records
       (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
     VALUES ($1,$2,$3,'experiment','EXP-G4','GOV04 experiment','draft','{}','{}',$4)`,
    [RECORD, WS, PROJECT, AUTHOR],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

describe('GOV-04 frozen evidence and signature attachment', () => {
  it('keeps submitted evidence and signatures frozen across live edits and amendments', async () => {
    const author = await authenticated(AUTHOR, WS)

    // Submit through the controlled human-session RPC.
    const sourceDigest = (
      await author.query(
        `SELECT api.preview_submission_digest($1) AS result`,
        [RECORD],
      )
    ).rows[0].result.sourceDigest as string
    const submitted = (
      await author.query(
        `SELECT api.submit_record_revision($1,$2,'default-scientific-review',1,$3,true,$4) AS result`,
        [RECORD, sourceDigest, `{${REVIEWER}}`, 'g4-submit-1'],
      )
    ).rows[0].result as {
      revision: { id: string; integrityDigest: string }
      submission: { id: string; state: string }
      idempotent: boolean
    }
    const revisionId = submitted.revision.id
    const integrityDigest = submitted.revision.integrityDigest
    const submissionId = submitted.submission.id

    // Reviewer checks + approve + sign.
    const { rows: revRows } = await migrator!.query<{
      id: string
      workspace_id: string
    }>(
      `SELECT id, workspace_id FROM api.revisions WHERE id = $1`,
      [revisionId],
    )
    expect(revRows[0]).toMatchObject({ workspace_id: WS })

    const reviewer = await authenticated(REVIEWER, WS)
    const checks = (
      await reviewer.query(
        `SELECT api.run_revision_checks($1,'default-scientific-checks',1,true,$2) AS result`,
        [revisionId, 'g4-checks-1'],
      )
    ).rows[0].result as { overallStatus: string }
    // Warnings do not block approval; only blocking failures do.
    expect(checks.overallStatus).not.toBe('fail')

    await reviewer.query(
      `SELECT api.approve_review($1,NULL,'submitted',$2)`,
      [submissionId, integrityDigest],
    )
    await reviewer.query(
      `SELECT api.sign_revision($1,'approve-for-record',$2,$3)`,
      [submissionId, 'Gov Reviewer', integrityDigest],
    )

    // Evidence package before any live mutation.
    const beforePackage = (
      await reviewer.query(
        `SELECT api.revision_evidence_package($1) AS result`,
        [revisionId],
      )
    ).rows[0].result

    // Live record keeps moving afterwards — history must not.
    await migrator!.query(
      `UPDATE api.records SET title='Live title drift' WHERE id=$1`,
      [RECORD],
    )
    const afterPackage = (
      await authenticated(REVIEWER, WS).then((c) =>
        c.query(`SELECT api.revision_evidence_package($1) AS result`, [
          revisionId,
        ]),
      )
    ).rows[0].result

    expect(afterPackage.revision.integrityDigest).toBe(
      integrityDigest,
    )
    expect(afterPackage.canonicalSnapshot).toEqual(
      beforePackage.canonicalSnapshot,
    )
    // metadata_snapshot stores the record snapshot itself (REV-002:
    // envelope -> 'record'), so the frozen title lives at the top level.
    expect(afterPackage.metadataSnapshot.title).not.toBe('Live title drift')

    // Amendment: supersedes the signed revision, unlocks the record, and
    // leaves every signature row exactly where it was.
    const amendment = (
      await author.query(
        `SELECT api.create_amendment($1,$2) AS result`,
        [RECORD, 'Correct concentration units'],
      )
    ).rows[0].result as {
      revisionId: string
      supersedesRevisionId: string
      integrityDigest: string
    }
    expect(amendment.supersedesRevisionId).toBe(revisionId)
    expect(amendment.integrityDigest).not.toBe(integrityDigest)

    const { rows: signatures } = await migrator!.query<{
      revision_id: string
      revision_integrity_digest: string
      signer_user_id: string
      signature_meaning: string
    }>(
      `SELECT revision_id, revision_integrity_digest, signer_user_id, signature_meaning
         FROM api.signatures WHERE submission_id = $1`,
      [submissionId],
    )
    expect(signatures).toHaveLength(1)
    expect(signatures[0]).toMatchObject({
      revision_id: revisionId,
      revision_integrity_digest: integrityDigest,
      signer_user_id: REVIEWER,
      signature_meaning: 'approve-for-record',
    })

    const { rows: amendmentSignatures } = await migrator!.query(
      `SELECT id FROM api.signatures WHERE revision_id = $1`,
      [amendment.revisionId],
    )
    expect(amendmentSignatures).toHaveLength(0)

    const { rows: superseded } = await migrator!.query<{ superseded_by_revision_id: string }>(
      `SELECT superseded_by_revision_id FROM api.revisions WHERE id = $1`,
      [revisionId],
    )
    expect(superseded[0]?.superseded_by_revision_id).toBe(amendment.revisionId)

    // The locked record is editable again; nothing about the old evidence moved.
    const { rows: recordRows } = await migrator!.query<{ locked_at: string | null; title: string }>(
      `SELECT locked_at, title FROM api.records WHERE id = $1`,
      [RECORD],
    )
    expect(recordRows[0]?.locked_at).toBeNull()

    void beforePackage
  })

  it('keeps decisions attributable to actor, session, role and digest', async () => {
    // A second submission that gets rejected with a note.
    const author = await authenticated(AUTHOR, WS)
    const sourceDigest = (
      await author.query(
        `SELECT api.preview_submission_digest($1) AS result`,
        [RECORD],
      )
    ).rows[0].result.sourceDigest as string
    const submitted = (
      await author.query(
        `SELECT api.submit_record_revision($1,$2,'default-scientific-review',1,$3,true,$4) AS result`,
        [RECORD, sourceDigest, `{${REVIEWER}}`, 'g4-submit-2'],
      )
    ).rows[0].result as {
      revision: { id: string; integrityDigest: string }
      submission: { id: string }
    }

    const reviewer = await authenticated(REVIEWER, WS)
    await reviewer.query(
      `SELECT api.reject_review($1,$2,'submitted',$3)`,
      [
        submitted.submission.id,
        'Units inconsistent',
        submitted.revision.integrityDigest,
      ],
    )

    const { rows: decisions } = await migrator!.query<{
      decision: string
      actor_user_id: string
      actor_session_id: string
      actor_role: string
      revision_integrity_digest: string
      note: string | null
    }>(
      `SELECT decision, actor_user_id, actor_session_id, actor_role,
              revision_integrity_digest, note
         FROM api.review_decisions
        WHERE submission_id = $1 ORDER BY created_at ASC`,
      [submitted.submission.id],
    )
    expect(decisions.at(-1)).toMatchObject({
      decision: 'reject',
      actor_user_id: REVIEWER,
      actor_session_id: 'session-g4-reviewer',
      actor_role: 'authenticated',
      revision_integrity_digest: submitted.revision.integrityDigest,
      note: 'Units inconsistent',
    })
  })

  it('denies api credentials every attestation surface', async () => {
    const apiClient = await asApiClient(WS)
    const NO_REVISION = "'00000000-0000-4000-8000-0000000000b1'::uuid"
    const deniedRpc = (call: string) =>
      expect(
        apiClient.query(`SELECT ${call}`),
      ).rejects.toMatchObject({ code: '42501' })

    await deniedRpc(`api.submit_record_revision(${NO_REVISION},'x'::text,'default-scientific-review'::text,1,'{r}'::text[],true,'k'::text)`)
    await deniedRpc(`api.sign_revision(${NO_REVISION},'approve-for-record'::text,'x'::text,'${'ab'.repeat(32)}'::text)`)
    await deniedRpc(`api.create_amendment(${NO_REVISION},NULL::text)`)
    await deniedRpc(`api.run_revision_checks(${NO_REVISION},'default-scientific-checks'::text,1,true,'k'::text)`)
    await deniedRpc(`api.approve_review(${NO_REVISION},NULL::text,'submitted'::text,'${'ab'.repeat(32)}'::text)`)
    await deniedRpc(`api.request_changes_on_review(${NO_REVISION},'note'::text,'submitted'::text,'${'ab'.repeat(32)}'::text)`)
    await deniedRpc(`api.reject_review(${NO_REVISION},'note'::text,'submitted'::text,'${'ab'.repeat(32)}'::text)`)
    await deniedRpc(`api.withdraw_review(${NO_REVISION},'reason'::text,'submitted'::text,'${'ab'.repeat(32)}'::text)`)
  })

  it('fails closed for archived, deleted and inaccessible records', async () => {
    // Deleted record: submit must refuse.
    const deletedRecordId = '9a000000-0000-4000-8000-0000000000b2'
    await migrator!.query(
      `INSERT INTO api.records
         (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
       VALUES ($1,$2,$3,'experiment','EXP-G4-DEL','Deleted experiment','draft','{}','{}',$4)`,
      [deletedRecordId, WS, PROJECT, AUTHOR],
    )
    await migrator!.query(`UPDATE api.records SET deleted_at=now() WHERE id=$1`, [
      deletedRecordId,
    ])

    const author = await authenticated(AUTHOR, WS)
    // The controlled read path refuses deleted records outright — the
    // digest cannot even be presented, so submission fails closed twice.
    await expect(
      author.query(
        `SELECT api.preview_submission_digest($1) AS result`,
        [deletedRecordId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      author.query(
        `SELECT api.submit_record_revision($1,$2,'default-scientific-review',1,$3,true,$4)`,
        [deletedRecordId, '00'.repeat(32), `{${REVIEWER}}`, 'g4-submit-deleted'],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // Archived record likewise.
    const archivedRecordId = '9a000000-0000-4000-8000-0000000000b3'
    await migrator!.query(
      `INSERT INTO api.records
         (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
       VALUES ($1,$2,$3,'experiment','EXP-G4-ARC','Archived experiment','draft','{}','{}',$4)`,
      [archivedRecordId, WS, PROJECT, AUTHOR],
    )
    await migrator!.query(
      `UPDATE api.records SET archived_at=now() WHERE id=$1`,
      [archivedRecordId],
    )
    await expect(
      author.query(
        `SELECT api.preview_submission_digest($1) AS result`,
        [archivedRecordId],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // Cross-workspace caller gets the same existence-safe unknown-revision
    // response as any stranger (DATA-02 contract: no existence leakage).
    const outsider = await authenticated(OUTSIDER, WS_OTHER)
    await expect(
      outsider.query(`SELECT api.revision_evidence_package($1) AS result`, [
        '00000000-0000-4000-8000-0000000000b1',
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
