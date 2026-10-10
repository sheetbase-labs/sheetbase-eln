import { execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { DESIGN_USER_IDS, prepareDesignScenario } from '#/db/seed/design'

const execute = promisify(execFile)
const roleVariables = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'PGRST_DB_URI',
  'FORMULA_DATABASE_URL',
] as const
const scenarios = [
  ['ReviewSign', 'sheetbase_parity_review_sign'],
  ['SettingsSignature', 'sheetbase_parity_settings_signature'],
  ['HomeFirstRun', 'sheetbase_parity_home_first_run'],
] as const

it.each(scenarios)(
  'prepares isolated %s honestly and preserves its evidence on retry',
  async (screen, databaseName) => {
    const previous = { ...process.env }
    if (!previous.DATABASE_URL)
      throw new Error('DATABASE_URL required for scenario tests')
    const maintenanceUrl = new URL(previous.DATABASE_URL)
    maintenanceUrl.pathname = '/postgres'
    const maintenance = new Client({
      connectionString: maintenanceUrl.toString(),
    })
    await maintenance.connect()
    await maintenance.query(`CREATE DATABASE ${databaseName} OWNER migrator`)
    const storage = await mkdtemp(join(tmpdir(), 'design-scenario-'))
    for (const name of roleVariables) {
      const value = previous[name]
      if (!value) throw new Error(`${name} required for scenario tests`)
      const url = new URL(value)
      url.pathname = `/${databaseName}`
      process.env[name] = url.toString()
    }
    process.env.SHEETBASE_ENV = 'test'
    process.env.SHEETBASE_DEV_AUTH_FREE = 'false'
    if (!process.env.MIGRATION_DATABASE_URL)
      throw new Error('MIGRATION_DATABASE_URL required')
    const database = drizzle(process.env.MIGRATION_DATABASE_URL, { schema })
    try {
      await migrate(database, { migrationsFolder: 'drizzle' })
      const seeded = await execute('pnpm', ['db:seed:design'], {
        env: { ...process.env, FILE_STORAGE_DIR: storage },
      })
      expect(seeded.stdout).toContain(
        'Seed complete: 44 step(s) applied idempotently.',
      )
      const originalSignatures = (
        await database.$client.query('select * from api.signatures order by id')
      ).rows
      expect(originalSignatures).toHaveLength(2)

      for (const name of roleVariables) {
        const correct = process.env[name]
        if (!correct) throw new Error(`${name} required`)
        const invalid = new URL(correct)
        for (const pathname of [
          '/sheetbase',
          '/sheetbase_test',
          '/sheetbase_parity_wrong_screen',
        ]) {
          invalid.pathname = pathname
          process.env[name] = invalid.toString()
          await expect(prepareDesignScenario(database, screen)).rejects.toThrow(
            'exact isolated local scenario database',
          )
        }
        invalid.pathname = `/${databaseName}`
        invalid.hostname = 'example.com'
        process.env[name] = invalid.toString()
        await expect(prepareDesignScenario(database, screen)).rejects.toThrow(
          'exact isolated local scenario database',
        )
        process.env[name] = correct
      }
      const wrongPoolUrl = new URL(process.env.MIGRATION_DATABASE_URL)
      wrongPoolUrl.pathname = '/sheetbase_test'
      const wrongPool = drizzle(wrongPoolUrl.toString(), { schema })
      try {
        await expect(prepareDesignScenario(wrongPool, screen)).rejects.toThrow(
          'exact isolated local scenario database',
        )
      } finally {
        await wrongPool.$client.end()
      }
      process.env.SHEETBASE_ENV = 'production'
      await expect(prepareDesignScenario(database, screen)).rejects.toThrow(
        'exact isolated local scenario database',
      )
      process.env.SHEETBASE_ENV = 'test'
      process.env.SHEETBASE_DEV_AUTH_FREE = 'true'
      await expect(prepareDesignScenario(database, screen)).rejects.toThrow(
        'exact isolated local scenario database',
      )
      process.env.SHEETBASE_DEV_AUTH_FREE = 'false'

      const prepared = await prepareDesignScenario(database, screen)
      expect(
        (
          await database.$client.query(
            'select * from api.signatures order by id',
          )
        ).rows,
      ).toEqual(originalSignatures)
      if (prepared.screen === 'ReviewSign') {
        expect(prepared.route).toBe(`/review/${prepared.revisionId}`)
        const submissions = await database.$client.query(
          `select s.*,r.integrity_digest from api.review_submissions s join api.revisions r on r.id=s.revision_id
          where s.record_id=(select id from api.records where identifier='EXP-0138' and workspace_id=$1) order by s.submitted_at`,
          [prepared.workspaceId],
        )
        expect(submissions.rows).toHaveLength(2)
        expect(submissions.rows[1]).toMatchObject({
          id: prepared.submissionId,
          revision_id: prepared.revisionId,
          state: 'approved',
          submitted_by_user_id: DESIGN_USER_IDS.priya,
          assigned_reviewer_user_ids: [DESIGN_USER_IDS.gareth],
        })
        expect(prepared.revisionId).not.toBe(submissions.rows[0].revision_id)
        expect(
          (
            await database.$client.query(
              'select * from api.signatures where submission_id=$1',
              [prepared.submissionId],
            )
          ).rows,
        ).toEqual([])
        expect(
          (
            await database.$client.query(
              'select * from api.review_decisions where submission_id=$1',
              [prepared.submissionId],
            )
          ).rows,
        ).toHaveLength(1)
      } else if (prepared.screen === 'SettingsSignature') {
        const certifications = await database.$client.query(
          'select * from api.user_signature_certifications where user_id=$1 and workspace_id=$2',
          [prepared.userId, prepared.workspaceId],
        )
        expect(certifications.rows).toHaveLength(1)
        expect(certifications.rows[0]).toMatchObject({
          certified_at: null,
          identity_verified_by: DESIGN_USER_IDS.gareth,
          verified_email: 'sam.r@design.sheetbase.dev',
          credential_session_id: prepared.sessionId,
        })
        expect(certifications.rows[0].identity_verified_at).toBeInstanceOf(Date)
        expect(
          (
            await database.$client.query(
              'select * from internal.signature_grants where user_id=$1',
              [prepared.userId],
            )
          ).rows,
        ).toEqual([])
        const { createAuth } = await import('#/lib/auth')
        const secret = process.env.BETTER_AUTH_SECRET
        const baseUrl = process.env.BETTER_AUTH_URL
        if (!secret || !baseUrl)
          throw new Error('Better Auth fixture configuration required')
        const signed = createHmac('sha256', secret)
          .update(prepared.sessionId)
          .digest('base64')
        const headers = new Headers({
          origin: new URL(baseUrl).origin,
          cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${prepared.sessionId}.${signed}`)}`,
        })
        await createAuth(database).api.verifyPassword({
          headers,
          body: { password: 'design-fixture-only-signing-password' },
        })
      } else {
        const memberships = await database.$client.query(
          'select * from api.workspace_memberships where workspace_id=$1 and user_id=$2',
          [prepared.workspaceId, prepared.userId],
        )
        expect(memberships.rows).toHaveLength(1)
        expect(memberships.rows[0].role).toBe('member')
        const invitations = await database.$client.query(
          'select * from api.workspace_invitations where accepted_by_user_id=$1',
          [prepared.userId],
        )
        expect(invitations.rows).toHaveLength(1)
        expect(invitations.rows[0]).toMatchObject({
          status: 'accepted',
          created_by_user_id: DESIGN_USER_IDS.gareth,
        })
        expect(invitations.rows[0].accepted_at).toBeInstanceOf(Date)
        const access = await database.$client.query(
          'select * from api.project_access where user_id=$1',
          [prepared.userId],
        )
        expect(access.rows).toHaveLength(1)
        expect(access.rows[0]).toMatchObject({
          project_id: prepared.projectId,
          access_level: 'editor',
          granted_by_user_id: DESIGN_USER_IDS.gareth,
        })
        for (const sql of [
          'select * from api.recently_viewed where user_id=$1',
          'select * from api.records where created_by_user_id=$1',
          'select * from api.user_signature_certifications where user_id=$1',
        ]) {
          expect(
            (await database.$client.query(sql, [prepared.userId])).rows,
          ).toEqual([])
        }
      }

      const state = async () =>
        (
          await database.$client.query(`select jsonb_build_object(
      'signatures',(select jsonb_agg(to_jsonb(s) order by id) from api.signatures s),
      'submissions',(select jsonb_agg(to_jsonb(s) order by id) from api.review_submissions s),
      'revisions',(select jsonb_agg(to_jsonb(s) order by id) from api.revisions s),
      'certifications',(select jsonb_agg(to_jsonb(s) order by id) from api.user_signature_certifications s),
      'credentials',(select jsonb_agg(to_jsonb(s) order by id) from internal.account s),
      'authEvents',(select jsonb_agg(to_jsonb(s) order by id) from internal.signature_authentication_events s),
      'invitations',(select jsonb_agg(to_jsonb(s) order by id) from api.workspace_invitations s),
      'access',(select jsonb_agg(to_jsonb(s) order by id) from api.project_access s)
    ) as state`)
        ).rows[0].state
      const after = await state()
      for (let repeat = 0; repeat < 2; repeat++) {
        expect(await prepareDesignScenario(database, screen)).toEqual(prepared)
        expect(await state()).toEqual(after)
      }
    } finally {
      await database.$client.end()
      await maintenance.query(`DROP DATABASE ${databaseName}`)
      await maintenance.end()
      await rm(storage, { recursive: true, force: true })
      for (const name of [
        ...roleVariables,
        'SHEETBASE_ENV',
        'SHEETBASE_DEV_AUTH_FREE',
      ]) {
        if (previous[name] === undefined) delete process.env[name]
        else process.env[name] = previous[name]
      }
    }
  },
  180_000,
)
