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

it('captures typed Dataset cell old/new/reason with stable source receipts and no replay events', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  let actor: Client | undefined
  const workspace = crypto.randomUUID()
  const owner = 'exp-06-dataset-owner'
  const fieldId = crypto.randomUUID()
  const rowId = crypto.randomUUID()
  try {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'Dataset owner','exp06-dataset@test.invalid',true)`,
      [owner],
    )
    await migrator.query(
      `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'exp06-dataset','Dataset history')`,
      [workspace],
    )
    await migrator.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
      [workspace, owner],
    )
    actor = await asRole('authenticator')
    await actor.query('SET ROLE authenticated')
    await setActorJwt(actor, owner, workspace)
    const schemaVersionId = z.uuid().parse(
      (
        await actor.query(
          `SELECT api.create_dataset_schema_definition($1,'exp06_load','Load history',NULL,$2::jsonb) result`,
          [
            workspace,
            JSON.stringify([
              {
                field_id: fieldId,
                key: 'load',
                label: 'Load (L/m²)',
                logical_type: 'decimal',
                nullable: true,
              },
            ]),
          ],
        )
      ).rows[0].result.schema_version_id,
    )
    await actor.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schemaVersionId,
    ])
    const datasetId = z
      .uuid()
      .parse(
        (
          await actor.query(
            `INSERT INTO api.datasets(workspace_id,schema_version_id,name) VALUES($1,$2,'Clarification runs') RETURNING id`,
            [workspace, schemaVersionId],
          )
        ).rows[0].id,
      )
    const commit = async (revision: number, rows: unknown[], key: string) =>
      z
        .object({
          ok: z.literal(true),
          sourceEvents: z.array(
            z.object({
              recordId: z.uuid().nullable(),
              sourceEventId: z.uuid(),
            }),
          ),
        })
        .passthrough()
        .parse(
          (
            await actor!.query(
              `SELECT api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
              [datasetId, revision, JSON.stringify(rows), key],
            )
          ).rows[0].result,
        )
    await commit(
      1,
      [{ operation: 'create', rowId, values: { [fieldId]: 125 } }],
      'exp06-create',
    )
    const analysisId = z.uuid().parse(
      (
        await actor.query(
          `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
       VALUES($1,$2,'Current load analysis','{}',$3::jsonb) RETURNING id`,
          [
            workspace,
            owner,
            JSON.stringify([
              { datasetId, schemaVersionNumber: 1, revision: 2 },
            ]),
          ],
        )
      ).rows[0].id,
    )
    await actor.query(
      `INSERT INTO api.analysis_definitions(workspace_id,owner_user_id,name,definition,source_revisions)
       VALUES($1,$2,'Already stale analysis','{}',$3::jsonb)`,
      [
        workspace,
        owner,
        JSON.stringify([{ datasetId, schemaVersionNumber: 1, revision: 1 }]),
      ],
    )
    const edit = [
      {
        operation: 'update',
        rowId,
        expectedRevision: 1,
        values: { [fieldId]: 150 },
        reason: 'Transcription error',
      },
    ]
    const result = await commit(2, edit, 'exp06-correct')
    expect(result.sourceEvents).toHaveLength(1)
    const source = result.sourceEvents[0]
    const payload = z
      .object({
        rowId: z.uuid(),
        rowRevision: z.number(),
        datasetRevision: z.number(),
        reason: z.string(),
        changes: z.record(
          z.string(),
          z.object({
            fieldId: z.uuid(),
            from: z.number().nullable(),
            to: z.number(),
          }),
        ),
      })
      .parse(
        (
          await migrator.query(
            `SELECT payload FROM api.change_events WHERE id=$1`,
            [source.sourceEventId],
          )
        ).rows[0].payload,
      )
    expect(payload).toMatchObject({
      rowId,
      rowRevision: 2,
      datasetRevision: 3,
      reason: 'Transcription error',
      changes: { [fieldId]: { fieldId, from: 125, to: 150 } },
    })
    const effects = (
      await migrator.query(
        `SELECT payload FROM api.change_events WHERE workspace_id=$1 AND payload->>'effect'='stale_analysis'`,
        [workspace],
      )
    ).rows
    expect(effects).toHaveLength(1)
    expect(effects[0].payload).toMatchObject({
      analysisId,
      sourceEventId: source.sourceEventId,
      sourceEventIds: [source.sourceEventId],
      changes: { status: { from: 'current', to: 'stale' } },
    })
    const count = (
      await migrator.query(
        `SELECT count(*)::int count FROM api.change_events WHERE workspace_id=$1`,
        [workspace],
      )
    ).rows[0].count
    expect((await commit(2, edit, 'exp06-correct')).sourceEvents).toEqual(
      result.sourceEvents,
    )
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int count FROM api.change_events WHERE workspace_id=$1`,
          [workspace],
        )
      ).rows[0].count,
    ).toBe(count)
    await commit(
      3,
      [{ ...edit[0], expectedRevision: 2, values: { [fieldId]: 175 } }],
      'exp06-later',
    )
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int count FROM api.change_events WHERE workspace_id=$1 AND payload->>'effect'='stale_analysis'`,
          [workspace],
        )
      ).rows[0].count,
    ).toBe(1)
    expect(
      (
        await migrator.query(
          `SELECT payload FROM api.change_events WHERE id=$1`,
          [source.sourceEventId],
        )
      ).rows[0].payload,
    ).toMatchObject(payload)
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

it('resolves native Analysis citations with live readable sources and denies foreign/unknown/forged/direct targets', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  let actor: Client | undefined
  const workspace = crypto.randomUUID()
  const foreignWorkspace = crypto.randomUUID()
  const owner = 'exp06-analysis-owner'
  try {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'Analysis owner','exp06-analysis@test.invalid',true)`,
      [owner],
    )
    await migrator.query(
      `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'exp06-analysis','Analysis'),($2,'exp06-foreign','Foreign')`,
      [workspace, foreignWorkspace],
    )
    await migrator.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$3,'owner'),($2,$3,'owner')`,
      [workspace, foreignWorkspace, owner],
    )
    actor = await asRole('authenticator')
    await actor.query('SET ROLE authenticated')
    await setActorJwt(actor, owner, workspace)
    const projectId = z
      .uuid()
      .parse(
        (
          await actor.query(
            `SELECT id FROM api.create_project('Analysis citations')`,
          )
        ).rows[0].id,
      )
    const recordId = z
      .uuid()
      .parse(
        (
          await actor.query(
            `SELECT id FROM api.create_record($1,'experiment','Citation source')`,
            [projectId],
          )
        ).rows[0].id,
      )
    const deniedRecordId = z
      .uuid()
      .parse(
        (
          await actor.query(
            `SELECT id FROM api.create_record($1,'experiment','Unrelated readable record')`,
            [projectId],
          )
        ).rows[0].id,
      )
    // A hidden project source is real, but the source experiment's grant must
    // not authorize it. The view itself remains visible in the workspace.
    const hiddenProjectId = z
      .uuid()
      .parse(
        (
          await migrator.query(
            `INSERT INTO api.projects(workspace_id,key,title) VALUES($1,'hidden','Hidden source') RETURNING id`,
            [workspace],
          )
        ).rows[0].id,
      )
    await migrator.query(`UPDATE api.records SET project_id=$2 WHERE id=$1`, [
      deniedRecordId,
      hiddenProjectId,
    ])
    const readable = z
      .object({ id: z.uuid(), display_id: z.string() })
      .parse(
        (
          await actor.query(
            `INSERT INTO api.analysis_views(workspace_id,owner_user_id,name,charts,source_revisions) VALUES($1,$2,'Readable citation',jsonb_build_array($3::jsonb),'[]') RETURNING id,display_id`,
            [workspace, owner, JSON.stringify({ recordId })],
          )
        ).rows[0],
      )
    const deniedSpec = z
      .object({ display_id: z.string() })
      .parse(
        (
          await actor.query(
            `INSERT INTO api.analysis_views(workspace_id,owner_user_id,name,charts,source_revisions) VALUES($1,$2,'Hidden spec citation',jsonb_build_array($3::jsonb),'[]') RETURNING display_id`,
            [workspace, owner, JSON.stringify({ recordId: deniedRecordId })],
          )
        ).rows[0],
      )
    const deniedProvenance = z
      .object({ display_id: z.string() })
      .parse(
        (
          await actor.query(
            `INSERT INTO api.analysis_views(workspace_id,owner_user_id,name,charts,source_revisions) VALUES($1,$2,'Hidden provenance citation','[{}]',$3::jsonb) RETURNING display_id`,
            [workspace, owner, JSON.stringify([{ recordId: deniedRecordId }])],
          )
        ).rows[0],
      )
    await migrator.query(
      `INSERT INTO api.analysis_views(workspace_id,owner_user_id,name,display_id,charts) VALUES($1,$2,'Foreign citation','AN-9000','[{}]')`,
      [foreignWorkspace, owner],
    )
    expect(
      (
        await actor.query(
          `SELECT id FROM api.analysis_views WHERE display_id=$1`,
          [deniedSpec.display_id],
        )
      ).rows,
    ).toHaveLength(1)
    const link = z
      .object({ id: z.uuid(), target_record_id: z.null() })
      .parse(
        (
          await actor.query(
            `SELECT * FROM api.create_record_link($1,'analysis',$2,'analysis')`,
            [recordId, readable.display_id],
          )
        ).rows[0],
      )
    expect(
      (
        await migrator.query(
          `SELECT actor_user_id,record_id,payload FROM api.change_events WHERE entity_uuid=$1 AND operation='link'`,
          [link.id],
        )
      ).rows[0],
    ).toMatchObject({
      actor_user_id: owner,
      record_id: recordId,
      payload: {
        targetKind: 'analysis',
        targetIdentifier: readable.display_id,
        linkType: 'analysis',
      },
    })
    for (const identifier of [
      deniedSpec.display_id,
      deniedProvenance.display_id,
      'AN-9000',
      'AN-9999',
    ]) {
      await expect(
        actor.query(
          `SELECT api.create_record_link($1,'analysis',$2,'analysis')`,
          [recordId, identifier],
        ),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        actor.query(
          `INSERT INTO api.record_links(source_record_id,target_kind,target_identifier,link_type,created_by_user_id) VALUES($1,'analysis',$2,'analysis',$3)`,
          [recordId, identifier, owner],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    }
    await expect(
      actor.query(
        `SELECT api.create_record_link($1,'analysis',$2,'analysis',$1)`,
        [recordId, readable.display_id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    const eventId = z
      .uuid()
      .parse(
        (
          await migrator.query(
            `SELECT id FROM api.change_events WHERE entity_uuid=$1 AND operation='link'`,
            [link.id],
          )
        ).rows[0].id,
      )
    expect(
      (
        await actor.query(`SELECT id FROM api.change_events WHERE id=$1`, [
          eventId,
        ])
      ).rows,
    ).toHaveLength(1)
    await migrator.query(
      `UPDATE api.analysis_views SET source_revisions=$2::jsonb WHERE id=$1`,
      [readable.id, JSON.stringify([{ recordId: deniedRecordId }])],
    )
    expect(
      (
        await actor.query(`SELECT id FROM api.change_events WHERE id=$1`, [
          eventId,
        ])
      ).rows,
    ).toHaveLength(0)
    expect(
      (
        await actor.query(`SELECT * FROM api.record_links WHERE id=$1`, [
          link.id,
        ])
      ).rows,
    ).toHaveLength(0)
  } finally {
    await actor?.end()
    await migrator.end()
  }
})
