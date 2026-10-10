import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { migratorUrl, resetTestDatabase } from './helpers'

it('upgrades populated 0313 through 0315 and current migrations without rewriting historical evidence', async () => {
  await resetTestDatabase()
  const folder = await mkdtemp(join(tmpdir(), 'sheetbase-signature-upgrade-'))
  const pool = new Pool({ connectionString: migratorUrl() })
  const database = drizzle(pool)
  try {
    const journal = z
      .object({
        entries: z.array(
          z.object({ idx: z.number(), tag: z.string() }).passthrough(),
        ),
      })
      .passthrough()
      .parse(JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')))
    const entries = journal.entries.filter((entry) => entry.idx <= 313)
    await mkdir(join(folder, 'meta'))
    await writeFile(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries }),
    )
    for (const entry of entries)
      await copyFile(
        `drizzle/${entry.tag}.sql`,
        join(folder, `${entry.tag}.sql`),
      )
    await migrate(database, { migrationsFolder: folder })
    const client = await pool.connect()
    try {
      await client.query(`INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES('historical-signer','Historical Signer','historical@sheetbase.test',true);
        INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES('historical-session','historical-token','historical-signer',now()+interval '1 hour');`)
      const workspace = (
        await client.query<{ id: string }>(
          `INSERT INTO api.workspaces(slug,name) VALUES('signing-upgrade','Signing upgrade') RETURNING id`,
        )
      ).rows[0].id
      await client.query(
        `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,'historical-signer','member')`,
        [workspace],
      )
      await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({
          sub: 'historical-signer',
          session_id: 'historical-session',
          workspace_id: workspace,
          role: 'authenticated',
        }),
      ])
      await client.query('SELECT api.certify_signature($1,1)', [workspace])
      const project = (
        await client.query<{ id: string }>(
          `INSERT INTO api.projects(workspace_id,key,title) VALUES($1,'UPGRADE','Upgrade') RETURNING id`,
          [workspace],
        )
      ).rows[0].id
      const record = (
        await client.query<{ id: string }>(
          `INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES($1,$2,'experiment','EXP-UPGRADE','Historical experiment','draft','historical-signer') RETURNING id`,
          [workspace, project],
        )
      ).rows[0].id
      const snapshot = {
        formatVersion: 1,
        record: {
          id: record,
          workspaceId: workspace,
          title: 'Historical experiment',
          kind: 'experiment',
          status: 'draft',
        },
        blocks: [],
        links: [],
        scientificTables: [],
        formulas: [],
        files: [],
      }
      const revision = (
        await client.query<{ id: string; integrity_digest: string }>(
          `INSERT INTO api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,canonical_snapshot,integrity_algorithm,reason,created_by_user_id)
        VALUES($1,$2,1,1,$3,'[]',$3,'sha256','validate','historical-signer') RETURNING id,integrity_digest`,
          [record, workspace, JSON.stringify(snapshot)],
        )
      ).rows[0]
      const submission = (
        await client.query<{ id: string }>(
          `INSERT INTO api.review_submissions(workspace_id,record_id,revision_id,state,workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,submitted_by_user_id,submitted_session_id,submitted_role,submitted_at,idempotency_key)
        VALUES($1,$2,$3,'approved','default-scientific-review',1,'{historical-signer}','historical-signer','historical-session','authenticated',now(),'historical-upgrade') RETURNING id`,
          [workspace, record, revision.id],
        )
      ).rows[0].id
      await client.query(
        `SELECT api.run_revision_checks($1,'default-scientific-checks',1,true,'historical-checks')`,
        [revision.id],
      )
      await client.query(
        `SELECT api.sign_revision($1,'approve-for-record','Historical Signer',$2)`,
        [submission, revision.integrity_digest],
      )
      const before = (await client.query('SELECT * FROM api.signatures')).rows
      expect(before).toHaveLength(1)
      expect(before[0].auth_method).toBe('session+name-confirmation')
      const certificationBefore = (
        await client.query(
          'SELECT statement_version,certified_at,revoked_at FROM api.user_signature_certifications',
        )
      ).rows
      const through0315 = journal.entries.filter((entry) => entry.idx <= 315)
      await writeFile(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: through0315 }),
      )
      for (const entry of through0315.filter((entry) => entry.idx > 313))
        await copyFile(
          `drizzle/${entry.tag}.sql`,
          join(folder, `${entry.tag}.sql`),
        )
      await migrate(database, { migrationsFolder: folder })
      expect((await client.query('SELECT * FROM api.signatures')).rows).toEqual(
        before,
      )
      await migrate(database, { migrationsFolder: 'drizzle' })
      expect((await client.query('SELECT * FROM api.signatures')).rows).toEqual(
        before.map((signature) => ({ ...signature, signer_name: null })),
      )
      expect(
        (
          await client.query(
            'SELECT statement_version,certified_at,revoked_at FROM api.user_signature_certifications',
          )
        ).rows,
      ).toEqual(certificationBefore)
      expect(
        (
          await client.query(
            'SELECT identity_verified_at,identity_verified_by,auth_method FROM api.user_signature_certifications',
          )
        ).rows,
      ).toEqual([
        {
          identity_verified_at: null,
          identity_verified_by: null,
          auth_method: null,
        },
      ])
      await expect(
        client.query('SELECT api.certify_signature($1,1)', [workspace]),
      ).rejects.toMatchObject({ code: '42501' })
      const applied = (
        await client.query(
          'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
        )
      ).rows
      await migrate(database, { migrationsFolder: 'drizzle' })
      expect((await client.query('SELECT * FROM api.signatures')).rows).toEqual(
        before.map((signature) => ({ ...signature, signer_name: null })),
      )
      expect(
        (
          await client.query(
            'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
          )
        ).rows,
      ).toEqual(applied)
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
    await rm(folder, { recursive: true, force: true })
  }
})
