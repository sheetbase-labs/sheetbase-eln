import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { migratorUrl, resetTestDatabase, roleUrl } from './helpers'

it.each([319, 324])(
  'upgrades populated migration %i preserving explicit grants and evidence, without inventing workspace-wide access',
  async (baseline) => {
    await resetTestDatabase()
    const folder = await mkdtemp(join(tmpdir(), 'set02-upgrade-'))
    const client = new Client({ connectionString: migratorUrl() })
    const actor = new Client({ connectionString: roleUrl('authenticator') })
    await client.connect()
    await actor.connect()
    try {
      const journal = z
        .object({
          entries: z.array(
            z.object({ idx: z.number(), tag: z.string() }).passthrough(),
          ),
        })
        .passthrough()
        .parse(JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')))
      const entries = journal.entries.filter((entry) => entry.idx <= baseline)
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
      await migrate(drizzle(client), { migrationsFolder: folder })
      const beforeHistory = (
        await client.query(
          `SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
        )
      ).rows
      await client.query(`INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ('set-upgrade-lead','Lead','lead@set-upgrade.test',true),('set-upgrade-editor','Editor','editor@set-upgrade.test',true),('set-upgrade-admin','Ruleless admin','admin@set-upgrade.test',true)`)
      const workspace = (
        await client.query<{ id: string }>(
          `INSERT INTO api.workspaces(slug,name) VALUES('set-upgrade','SET upgrade') RETURNING id`,
        )
      ).rows[0].id
      await client.query(
        `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,'set-upgrade-lead','owner'),($1,'set-upgrade-editor','scientist'),($1,'set-upgrade-admin','admin')`,
        [workspace],
      )
      const project = (
        await client.query<{ id: string }>(
          `INSERT INTO api.projects(workspace_id,key,title,lead_user_id) VALUES($1,'SET-UP','Populated private project','set-upgrade-lead') RETURNING id`,
          [workspace],
        )
      ).rows[0].id
      await client.query(
        baseline === 319
          ? `INSERT INTO api.project_access(workspace_id,project_id,user_id,access_level,granted_by_user_id) VALUES($1,$2,'set-upgrade-editor','editor','set-upgrade-lead')`
          : `INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
           VALUES($1,$2,'set-upgrade-editor',true,true,false,false,'set-upgrade-lead')`,
        [workspace, project],
      )
      const record = (
        await client.query<{ id: string }>(
          `INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES($1,$2,'experiment','EXP-SET-UP','Preserve notebook','set-upgrade-lead') RETURNING id`,
          [workspace, project],
        )
      ).rows[0].id
      const revision = (
        await client.query<{ id: string }>(
          `INSERT INTO api.revisions(workspace_id,record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,integrity_digest,reason,created_by_user_id) VALUES($1,$2,1,1,'{"title":"Frozen original"}','[]',repeat('b',64),'submit','set-upgrade-lead') RETURNING id`,
          [workspace, record],
        )
      ).rows[0].id
      const beforeEvidence = (
        await client.query(`SELECT * FROM api.revisions WHERE id=$1`, [
          revision,
        ])
      ).rows[0]
      await migrate(drizzle(client), { migrationsFolder: 'drizzle' })
      expect(
        (
          await client.query(
            `SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT $1`,
            [beforeHistory.length],
          )
        ).rows,
      ).toEqual(beforeHistory)
      expect(
        (
          await client.query(`SELECT * FROM api.revisions WHERE id=$1`, [
            revision,
          ])
        ).rows[0],
      ).toEqual(beforeEvidence)
      expect(
        (
          await client.query(
            `SELECT user_id,can_view,can_edit,can_review,can_manage FROM api.project_access WHERE project_id=$1 ORDER BY user_id`,
            [project],
          )
        ).rows,
      ).toEqual([
        {
          user_id: 'set-upgrade-editor',
          can_view: true,
          can_edit: true,
          can_review: false,
          can_manage: false,
        },
        {
          user_id: 'set-upgrade-lead',
          can_view: true,
          can_edit: true,
          can_review: true,
          can_manage: true,
        },
      ])
      await actor.query('SET ROLE authenticated')
      for (const [user, expected] of [
        ['set-upgrade-admin', false],
        ['set-upgrade-editor', true],
        ['set-upgrade-lead', true],
      ] as const) {
        await actor.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
          JSON.stringify({
            sub: user,
            workspace_id: workspace,
            role: 'authenticated',
          }),
        ])
        expect(
          (
            await actor.query(`SELECT id FROM api.records WHERE id=$1`, [
              record,
            ])
          ).rowCount,
        ).toBe(expected ? 1 : 0)
      }
    } finally {
      await actor.end()
      await client.end()
      await rm(folder, { recursive: true, force: true })
    }
  },
)
