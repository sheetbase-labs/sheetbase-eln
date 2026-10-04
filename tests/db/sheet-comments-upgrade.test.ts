import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { createAdHocTextField } from '#/lib/sheet-local-data'
import { migratorUrl, resetTestDatabase, roleUrl, setActorJwt } from './helpers'

it('upgrades genuine positional historical Sheet evidence and comments without rewriting or guessing cell identities', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sheet-comment-pre0309-'))
  const journalBefore = await readFile('drizzle/meta/_journal.json', 'utf8')
  const journal = z
    .object({ entries: z.array(z.object({ idx: z.number() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(journalBefore))
  const client = new Client({ connectionString: migratorUrl() })
  const actor = new Client({ connectionString: roleUrl('authenticator') })
  try {
    await resetTestDatabase()
    await cp('drizzle', folder, { recursive: true })
    await writeFile(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 308),
      }),
    )
    await client.connect()
    await migrate(drizzle(client), { migrationsFolder: folder })
    const workspace = crypto.randomUUID()
    const record = crypto.randomUUID()
    const field = crypto.randomUUID()
    const row = crypto.randomUUID()
    const owner = 'historical-sheet-comment-owner'
    const reviewer = 'historical-sheet-comment-reviewer'
    await client.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,$1,'historical-owner@sheet-comment.test',true),($2,$2,'historical-reviewer@sheet-comment.test',true)`,
      [owner, reviewer],
    )
    await client.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES('historical-session','historical-session',$1,now()+interval '1 hour')`,
      [owner],
    )
    await client.query(
      `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'historical-sheet-comments','Historical sheet comments')`,
      [workspace],
    )
    await client.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')`,
      [workspace, owner, reviewer],
    )
    await client.query(
      `INSERT INTO api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id) VALUES($1,$2,'experiment','EXP-HISTORICAL-COMMENT','Original evidence','draft',$3)`,
      [record, workspace, owner],
    )
    await actor.connect()
    await actor.query('SET ROLE authenticated')
    await setActorJwt(actor, owner, workspace, {
      session_id: 'historical-session',
    })
    const instance = (
      await actor.query(
        `SELECT to_jsonb(api.create_sheet_instance($1,'Historical sheet',NULL,NULL,NULL,NULL,$2::jsonb)) result`,
        [
          workspace,
          JSON.stringify({
            bindings: [],
            localFields: [
              { ...createAdHocTextField('Original field'), fieldId: field },
            ],
            localValues: { [row]: { [field]: 'Original value 37' } },
            calculationOverrides: {},
            presentation: {
              columnOrder: [field],
              hiddenColumnIds: [],
              columnWidths: {},
              frozenColumnCount: 0,
              density: 'standard',
              filters: [],
              sorts: [],
            },
            provenance: { createdFrom: 'ad_hoc' },
          }),
        ],
      )
    ).rows[0].result
    const block = (
      await actor.query(
        'SELECT api.insert_sheet_instance_block($1,NULL,NULL,$2) result',
        [record, instance.id],
      )
    ).rows[0].result.block
    const digest = (
      await actor.query(
        "SELECT api.preview_submission_digest($1)->>'sourceDigest' digest",
        [record],
      )
    ).rows[0].digest
    const revision = (
      await actor.query(
        `SELECT api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,'historical-comment') result`,
        [record, digest, reviewer],
      )
    ).rows[0].result.revision
    const root = (
      await actor.query(
        `SELECT api.create_comment($1,'block',$2::jsonb,'Original historical thread','{}') result`,
        [revision.id, JSON.stringify({ blockId: block.id })],
      )
    ).rows[0].result
    const evidenceBefore = (
      await client.query(
        'SELECT to_jsonb(e) evidence FROM api.revision_sheet_evidence e WHERE revision_id=$1',
        [revision.id],
      )
    ).rows
    expect(evidenceBefore[0].evidence.composed_grid.rowKeys).toBeUndefined()
    const revisionBefore = (
      await client.query(
        'SELECT canonical_snapshot,integrity_digest FROM api.revisions WHERE id=$1',
        [revision.id],
      )
    ).rows
    const commentBefore = (
      await client.query('SELECT target,body FROM api.comments WHERE id=$1', [
        root.id,
      ])
    ).rows
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' })
    expect(
      (
        await client.query(
          'SELECT to_jsonb(e) evidence FROM api.revision_sheet_evidence e WHERE revision_id=$1',
          [revision.id],
        )
      ).rows,
    ).toEqual(evidenceBefore)
    expect(
      (
        await client.query(
          'SELECT canonical_snapshot,integrity_digest FROM api.revisions WHERE id=$1',
          [revision.id],
        )
      ).rows,
    ).toEqual(revisionBefore)
    expect(
      (
        await client.query('SELECT target,body FROM api.comments WHERE id=$1', [
          root.id,
        ])
      ).rows,
    ).toEqual(commentBefore)
    await expect(
      actor.query(
        `SELECT api.create_comment($1,'sheet_cell',$2::jsonb,'Do not infer historical coordinates','{}')`,
        [
          revision.id,
          JSON.stringify({
            instanceId: instance.id,
            rowKeys: [row],
            fieldIds: [field],
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    await actor.query(
      `SELECT api.reply_to_comment($1,'Existing historical block thread still works','{}')`,
      [root.id],
    )
    expect(await readFile('drizzle/meta/_journal.json', 'utf8')).toBe(
      journalBefore,
    )
  } finally {
    await actor.end()
    await client.end()
    await rm(folder, { recursive: true, force: true })
  }
}, 60_000)
