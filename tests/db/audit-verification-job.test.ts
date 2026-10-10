/**
 * REV-05.2 — the nightly verification job.
 *
 * The job verifies the audit chain and every signed revision's integrity digest,
 * then records the result as a System entry so the log itself shows whether the
 * trail is intact. DEC-04 fixes the schedule at 06:00.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000d000'
const PROJECT = '00000000-0000-4000-8000-00000000d001'
const RECORD = '00000000-0000-4000-8000-00000000d002'
const ADMIN = 'rev052-admin'

type VerificationResult = {
  ok: boolean
  chain: {
    ok: boolean
    entriesChecked: number
    firstBadSequence: string | null
    firstBadId: string | null
  }
  signedRevisions: {
    ok: boolean
    checked: number
    firstBadSignatureId: string | null
    firstBadRevisionId: string | null
  }
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let revisionId: string
let signatureId: string
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [ADMIN, `${ADMIN}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'rev052','REV-05.2')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, ADMIN],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'R52','Verify',$3)`,
    [PROJECT, WS, ADMIN],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-R52','Signed record',$4)`,
    [RECORD, WS, PROJECT, ADMIN],
  )

  // A frozen revision and the signature that captured its digest.
  const revision = await migrator.query<{
    id: string
    integrity_digest: string
  }>(
    `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,
                               block_snapshot,reason,created_by_user_id,updated_at)
     values($1,1,1,'{"title":"Signed record"}'::jsonb,'[]'::jsonb,'submit',$2,now())
     returning id,integrity_digest`,
    [RECORD, ADMIN],
  )
  revisionId = revision.rows[0]!.id
  const submission = await migrator.query<{ id: string }>(
    `insert into api.review_submissions(workspace_id,record_id,revision_id,workflow_definition_key,
                                        workflow_definition_version,assigned_reviewer_user_ids,
                                        submitted_by_user_id,submitted_session_id,submitted_role,
                                        submitted_at,idempotency_key)
     values($1,$2,$3,'default-scientific-review',1,array[$4],$4,'sess-r52','author',now(),'sub-r52')
     returning id`,
    [WS, RECORD, revisionId, ADMIN],
  )
  const signature = await migrator.query<{ id: string }>(
    `insert into api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,
                                assurance_level,revision_integrity_digest,signer_user_id,
                                signer_session_id,signer_role,auth_method,confirmation_phrase,signed_at)
     values($1,$2,$3,$4,'reviewed-and-approved','standard',$5,$6,'sess-r52','reviewer','password',
            'I confirm this record',now())
     returning id`,
    [
      WS,
      submission.rows[0]!.id,
      revisionId,
      RECORD,
      revision.rows[0]!.integrity_digest,
      ADMIN,
    ],
  )
  signatureId = signature.rows[0]!.id

  await setActorJwt(migrator, ADMIN, WS)
  for (const n of [1, 2]) {
    await migrator.query(
      `select internal.emit_change_event($1,'record',$2,'update',$2,$3,$4::jsonb)`,
      [WS, RECORD, PROJECT, JSON.stringify({ n })],
    )
  }
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function admin(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, ADMIN, WS)
  return client
}

async function run(client: Client): Promise<VerificationResult> {
  return (
    await client.query<{ result: VerificationResult }>(
      'select api.run_audit_verification($1) as result',
      [WS],
    )
  ).rows[0]!.result
}

async function systemEntries() {
  return (
    await migrator.query<{
      payload: VerificationResult
      actor_user_id: string | null
    }>(
      `select payload,actor_user_id from api.change_events
        where workspace_id=$1 and entity_type='system' order by sequence`,
      [WS],
    )
  ).rows
}

describe('REV-05.2 audit verification job', () => {
  it('verifies a clean trail and records the result as a System entry', async () => {
    const before = (await systemEntries()).length
    const result = await run(await admin())

    expect(result.ok).toBe(true)
    expect(result.chain.ok).toBe(true)
    expect(result.chain.entriesChecked).toBeGreaterThan(0)
    expect(result.signedRevisions).toMatchObject({ ok: true, checked: 1 })

    const entries = await systemEntries()
    expect(entries).toHaveLength(before + 1)
    const latest = entries[entries.length - 1]!
    expect(latest.actor_user_id).toBeNull()
    expect(latest.payload.ok).toBe(true)
    expect(latest.payload.chain.entriesChecked).toBe(
      result.chain.entriesChecked,
    )
  })

  it('detects a rewritten audit entry', async () => {
    const target = (
      await migrator.query<{ id: string; sequence: string }>(
        `select id,sequence from api.change_events where workspace_id=$1 order by sequence limit 1`,
        [WS],
      )
    ).rows[0]!
    await migrator.query(
      'alter table api.change_events disable trigger refuse_change_event_mutation',
    )
    try {
      await migrator.query(
        `update api.change_events set payload='{"tampered":true}'::jsonb where id=$1`,
        [target.id],
      )
      const result = await run(await admin())
      expect(result.ok).toBe(false)
      expect(result.chain.ok).toBe(false)
      expect(result.chain.firstBadSequence).toBe(Number(target.sequence))

      const latest = (await systemEntries()).slice(-1)[0]!
      expect(latest.payload.ok).toBe(false)
      expect(latest.payload.chain.firstBadSequence).toBe(
        Number(target.sequence),
      )
    } finally {
      await migrator.query(
        'alter table api.change_events enable trigger refuse_change_event_mutation',
      )
    }
  })

  it('detects a rewritten signed revision', async () => {
    await migrator.query(
      'alter table api.revisions disable trigger prevent_frozen_revision_mutation',
    )
    try {
      await migrator.query(
        `update api.revisions set canonical_snapshot=canonical_snapshot||'{"tampered":true}'::jsonb where id=$1`,
        [revisionId],
      )
      const result = await run(await admin())
      expect(result.ok).toBe(false)
      expect(result.signedRevisions.ok).toBe(false)
      expect(result.signedRevisions).toMatchObject({
        firstBadRevisionId: revisionId,
        firstBadSignatureId: signatureId,
      })
    } finally {
      await migrator.query(
        'alter table api.revisions enable trigger prevent_frozen_revision_mutation',
      )
    }
  })
})
