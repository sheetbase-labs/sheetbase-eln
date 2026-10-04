import type { Client } from 'pg'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { prepareTestDatabase, setActorJwt } from './helpers'

it('records the actual editing session alongside immutable captured before/after values', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  let actor: Client | undefined
  const workspace = crypto.randomUUID()
  const owner = 'exp-06-history-owner'
  const firstSession = 'exp-06-first-browser'
  const secondSession = 'exp-06-second-browser'
  try {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'History owner','exp-06@sheetbase.test',true)`,
      [owner],
    )
    await migrator.query(
      `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'exp-06-history','History contract')`,
      [workspace],
    )
    await migrator.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
      [workspace, owner],
    )
    await migrator.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$1,$3,now()+interval '1 hour'),($2,$2,$3,now()+interval '1 hour')`,
      [firstSession, secondSession, owner],
    )
    actor = await asRole('authenticator')
    await actor.query('SET ROLE authenticated')
    await setActorJwt(actor, owner, workspace, { session_id: firstSession })
    const projectId = z
      .uuid()
      .parse(
        (
          await actor.query(
            "SELECT id FROM api.create_project('History project')",
          )
        ).rows[0].id,
      )
    const recordId = z
      .uuid()
      .parse(
        (
          await actor.query(
            "SELECT id FROM api.create_record($1,'experiment','Original title')",
            [projectId],
          )
        ).rows[0].id,
      )
    await actor.query('UPDATE api.records SET title=$2 WHERE id=$1', [
      recordId,
      'Corrected title',
    ])
    await setActorJwt(actor, owner, workspace, { session_id: secondSession })
    await actor.query('UPDATE api.records SET title=$2 WHERE id=$1', [
      recordId,
      'Independent second edit',
    ])
    const captured = z
      .array(
        z.object({
          payload: z
            .object({
              changes: z.object({
                title: z.object({ from: z.string(), to: z.string() }),
              }),
            })
            .passthrough(),
        }),
      )
      .parse(
        (
          await migrator.query(
            `SELECT payload FROM api.change_events WHERE entity_type='record' AND entity_uuid=$1 AND operation='update' ORDER BY sequence`,
            [recordId],
          )
        ).rows,
      )
    expect(captured.map((event) => event.payload.changes.title)).toEqual([
      { from: 'Original title', to: 'Corrected title' },
      { from: 'Corrected title', to: 'Independent second edit' },
    ])
    expect(captured.map((event) => event.payload.sessionId)).toEqual([
      firstSession,
      secondSession,
    ])
  } finally {
    await actor?.end()
    await migrator.end()
  }
})

it('captures genuine rich-text payload values at the successful write, not a later live read', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  let actor: Client | undefined
  const workspace = crypto.randomUUID()
  const owner = 'exp-06-text-owner'
  const payload = (text: string) => ({
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  })
  try {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'Text owner','exp-06-text@sheetbase.test',true)`,
      [owner],
    )
    await migrator.query(
      `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'exp-06-text','Text history')`,
      [workspace],
    )
    await migrator.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
      [workspace, owner],
    )
    actor = await asRole('authenticator')
    await actor.query('SET ROLE authenticated')
    await setActorJwt(actor, owner, workspace)
    const project = z
      .uuid()
      .parse(
        (await actor.query(`SELECT id FROM api.create_project('Text history')`))
          .rows[0].id,
      )
    const record = z
      .uuid()
      .parse(
        (
          await actor.query(
            `SELECT id FROM api.create_record($1,'experiment','Text audit')`,
            [project],
          )
        ).rows[0].id,
      )
    const inserted = z
      .object({ block: z.object({ id: z.uuid(), version: z.number() }) })
      .parse(
        (
          await actor.query(
            `SELECT api.insert_block($1,'rich_text',$2::jsonb) result`,
            [record, JSON.stringify(payload('Flux 120 LMH'))],
          )
        ).rows[0].result,
      )
    await actor.query(`SELECT api.update_block_payload($1,$2::jsonb,$3,1)`, [
      inserted.block.id,
      JSON.stringify(payload('Flux 100 LMH')),
      inserted.block.version,
    ])
    await actor.query(`SELECT api.update_block_payload($1,$2::jsonb,$3,1)`, [
      inserted.block.id,
      JSON.stringify(payload('Independent later text')),
      inserted.block.version + 1,
    ])
    const rows = (
      await migrator.query(
        `SELECT payload FROM api.change_events WHERE entity_type='block' AND entity_uuid=$1 AND operation='update' ORDER BY sequence`,
        [inserted.block.id],
      )
    ).rows
    expect(rows.map((row) => row.payload.changes?.payload)).toEqual([
      { from: payload('Flux 120 LMH'), to: payload('Flux 100 LMH') },
      { from: payload('Flux 100 LMH'), to: payload('Independent later text') },
    ])
  } finally {
    await actor?.end()
    await migrator.end()
  }
})
