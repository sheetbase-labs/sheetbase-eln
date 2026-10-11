import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { drizzle } from 'drizzle-orm/node-postgres'
import { expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  DESIGN_USER_IDS,
  DESIGN_WORKSPACE_IDS,
  designSteps,
} from '#/db/seed/design'
import { FIXTURE_USER_ID } from '#/db/seed/identities'
import { fixtureSteps } from '#/db/seed/run'
import {
  migratorUrl,
  prepareTestDatabase,
  roleUrl,
  setActorJwt,
} from './helpers'

const execute = promisify(execFile)

it.each(['fresh', 'approved-but-unsigned'])(
  'runs the full %s design seed through password signing and preserves frozen evidence on two reseeds',
  async (state) => {
    const { migrator, asRole } = await prepareTestDatabase()
    const storage = await mkdtemp(
      join(tmpdir(), 'sheetbase-design-signatures-'),
    )
    const env = {
      ...process.env,
      DATABASE_URL: migratorUrl(),
      PGRST_DB_URI: roleUrl('authenticator'),
      FILE_STORAGE_DIR: storage,
      SHEETBASE_ENV: 'test',
      SHEETBASE_DEV_AUTH_FREE: 'false',
    }
    const seed = async () => {
      const result = await execute('pnpm', ['db:seed:design'], { env })
      expect(result.stdout).toContain(
        'Seed complete: 47 step(s) applied idempotently.',
      )
    }
    try {
      let interruptedRevision:
        { id: string; integrityDigest: string } | undefined
      if (state === 'approved-but-unsigned') {
        const database = drizzle(migratorUrl(), { schema })
        const actor = await asRole('authenticator')
        try {
          for (const step of fixtureSteps) await step.run(database)
          for (const step of designSteps) {
            if (step.name === 'design review lifecycle') break
            await step.run(database)
          }
          await actor.query('set role authenticated')
          const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
          const recordId = '00000000-0000-4000-8000-000000000350'
          await setActorJwt(actor, DESIGN_USER_IDS.priya, workspaceId, {
            session_id: 'design-session-priya',
          })
          const preview = await actor.query(
            "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
            [recordId],
          )
          const submission = await actor.query<{
            result: {
              revision: { id: string; integrityDigest: string }
              submission: { id: string }
            }
          }>(
            "select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result",
            [
              recordId,
              preview.rows[0].digest,
              [DESIGN_USER_IDS.gareth],
              'design-review-exp-0138',
            ],
          )
          const result = submission.rows.at(0)?.result
          if (!result) throw new Error('Expected interrupted design submission')
          interruptedRevision = result.revision
          await setActorJwt(actor, DESIGN_USER_IDS.gareth, workspaceId, {
            session_id: 'design-session-gareth',
          })
          await actor.query(
            "select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)",
            [result.revision.id, 'design-review-exp-0138-checks'],
          )
          await actor.query("select api.approve_review($1,$2,'submitted',$3)", [
            result.submission.id,
            'Results meet acceptance criteria. Approved for release.',
            result.revision.integrityDigest,
          ])
          expect(
            (
              await migrator.query(
                'select count(*)::int as signatures from api.signatures',
              )
            ).rows[0].signatures,
          ).toBe(0)
        } finally {
          await actor.end()
          await database.$client.end()
        }
      }
      await seed()
      const signatures = await migrator.query(
        `select s.*,r.integrity_digest,r.superseded_by_revision_id,rec.identifier
         from api.signatures s join api.revisions r on r.id=s.revision_id
         join api.records rec on rec.id=s.record_id order by rec.identifier`,
      )
      expect(signatures.rows).toHaveLength(2)
      expect(signatures.rows.map((row) => row.identifier)).toEqual([
        'EXP-0136',
        'EXP-0138',
      ])
      for (const row of signatures.rows) {
        expect(row).toMatchObject({
          signer_user_id: DESIGN_USER_IDS.gareth,
          signer_role: 'authenticated',
          auth_method: 'password',
          signature_meaning: 'reviewed-and-approved',
          confirmation_phrase: 'Gareth P.',
        })
        expect(row.revision_integrity_digest).toBe(row.integrity_digest)
      }
      expect(signatures.rows[0].superseded_by_revision_id).not.toBeNull()
      expect(signatures.rows[1].superseded_by_revision_id).toBeNull()
      if (interruptedRevision) {
        expect(signatures.rows[1].revision_id).toBe(interruptedRevision.id)
        expect(signatures.rows[1].revision_integrity_digest).toBe(
          interruptedRevision.integrityDigest,
        )
      }
      const records = await migrator.query(
        `select identifier,locked_at,locked_by_revision_id from api.records
       where identifier in ('EXP-0136','EXP-0138') order by identifier`,
      )
      expect(records.rows[0].locked_at).toBeNull()
      expect(records.rows[0].locked_by_revision_id).toBeNull()
      expect(records.rows[1].locked_at).not.toBeNull()
      expect(records.rows[1].locked_by_revision_id).toBe(
        signatures.rows[1].revision_id,
      )
      const reviews = await migrator.query(
        `select r.identifier,s.state from api.review_submissions s
       join api.records r on r.id=s.record_id order by r.identifier`,
      )
      expect(reviews.rows).toEqual([
        { identifier: 'EXP-0127', state: 'returned' },
        { identifier: 'EXP-0130', state: 'submitted' },
        { identifier: 'EXP-0136', state: 'approved' },
        { identifier: 'EXP-0138', state: 'approved' },
      ])
      const certification = await migrator.query(
        'select * from api.user_signature_certifications where user_id=$1 and workspace_id=$2',
        [DESIGN_USER_IDS.gareth, DESIGN_WORKSPACE_IDS.processDevelopment],
      )
      expect(certification.rows).toHaveLength(1)
      expect(certification.rows[0]).toMatchObject({
        identity_verified_by: FIXTURE_USER_ID,
        verified_email: 'gareth.p@design.sheetbase.dev',
        auth_method: 'password',
        statement_version: 1,
        revoked_at: null,
      })
      const grants = await migrator.query(
        'select purpose,consumed_at from internal.signature_grants order by created_at',
      )
      expect(grants.rows.map((row) => row.purpose)).toEqual([
        'certify',
        'sign',
        'sign',
      ])
      expect(grants.rows.every((row) => row.consumed_at !== null)).toBe(true)
      const policies = await migrator.query(
        'select * from api.agent_operation_policies',
      )
      expect(policies.rows).toHaveLength(1)
      expect(policies.rows[0]).toMatchObject({
        signed_by_user_id: DESIGN_USER_IDS.gareth,
        signed_meaning: 'Authored',
      })
      const workflows = await migrator.query(
        'select * from api.agent_workflows order by id',
      )
      const proposals = await migrator.query(
        'select * from api.agent_operation_proposals order by id',
      )
      expect(workflows.rows).toHaveLength(1)
      expect(proposals.rows).toHaveLength(4)
      const revisions = await migrator.query(
        'select * from api.revisions order by id',
      )
      const audits = await migrator.query(
        'select * from internal.signature_authentication_events order by id',
      )
      const credential = await migrator.query(
        'select id,password from internal.account where "providerId"=\'credential\' and "userId"=$1',
        [DESIGN_USER_IDS.gareth],
      )
      expect(credential.rows).toHaveLength(1)
      expect(Boolean(credential.rows[0].password)).toBe(true)
      for (let repeat = 0; repeat < 2; repeat++) {
        await seed()
        expect(
          (
            await migrator.query(
              "select identifier,locked_at,locked_by_revision_id from api.records where identifier in ('EXP-0136','EXP-0138') order by identifier",
            )
          ).rows,
        ).toEqual(records.rows)
        expect(
          (
            await migrator.query(
              'select r.identifier,s.state from api.review_submissions s join api.records r on r.id=s.record_id order by r.identifier',
            )
          ).rows,
        ).toEqual(reviews.rows)
        expect(
          (
            await migrator.query(
              'select * from api.agent_workflows order by id',
            )
          ).rows,
        ).toEqual(workflows.rows)
        expect(
          (
            await migrator.query(
              'select * from api.agent_operation_proposals order by id',
            )
          ).rows,
        ).toEqual(proposals.rows)
        expect(
          (await migrator.query('select * from api.revisions order by id'))
            .rows,
        ).toEqual(revisions.rows)
        expect(
          (
            await migrator.query(
              'select s.*,r.integrity_digest,r.superseded_by_revision_id,rec.identifier from api.signatures s join api.revisions r on r.id=s.revision_id join api.records rec on rec.id=s.record_id order by rec.identifier',
            )
          ).rows,
        ).toEqual(signatures.rows)
        expect(
          (
            await migrator.query(
              'select * from api.user_signature_certifications where user_id=$1 and workspace_id=$2',
              [DESIGN_USER_IDS.gareth, DESIGN_WORKSPACE_IDS.processDevelopment],
            )
          ).rows,
        ).toEqual(certification.rows)
        expect(
          (await migrator.query('select * from api.agent_operation_policies'))
            .rows,
        ).toEqual(policies.rows)
        expect(
          (
            await migrator.query(
              'select * from internal.signature_authentication_events order by id',
            )
          ).rows,
        ).toEqual(audits.rows)
        expect(
          (
            await migrator.query(
              'select purpose,consumed_at from internal.signature_grants order by created_at',
            )
          ).rows,
        ).toEqual(grants.rows)
        const after = await migrator.query(
          'select password from internal.account where id=$1',
          [credential.rows[0].id],
        )
        expect(after.rows[0].password === credential.rows[0].password).toBe(
          true,
        )
      }
      const service = await asRole('authenticator')
      try {
        await service.query('set role api_client')
        await service.query(
          "select set_config('request.jwt.claims',$1,false)",
          [
            JSON.stringify({
              role: 'api_client',
              workspace_id: DESIGN_WORKSPACE_IDS.processDevelopment,
            }),
          ],
        )
        await expect(
          service.query('select api.sign_revision($1,$2,$3,$4,$5)', [
            signatures.rows[0].submission_id,
            'reviewed-and-approved',
            'Gareth P.',
            signatures.rows[0].revision_integrity_digest,
            'not-a-password-proof',
          ]),
        ).rejects.toMatchObject({ code: '42501' })
      } finally {
        await service.end()
      }
    } finally {
      await migrator.end()
      await rm(storage, { recursive: true, force: true })
    }
  },
  180_000,
)
