/**
 * Content-write proposal kinds added for MCP coverage.
 *
 * These are not new write engines: each proposal delegates to the existing
 * canonical RPC and stays human-required. The test proves the contract,
 * approval, canonical execution and workspace target checks.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0060000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0060000-0000-4000-8000-000000000002'
const PROJECT = 'a0060000-0000-4000-8000-000000000003'
const OTHER_PROJECT = 'a0060000-0000-4000-8000-000000000004'
const OWNER = 'a006-owner'
const MC_FIELD = 'a0060000-0000-4000-8000-000000000020'
const MC_COLUMN = 'a0060000-0000-4000-8000-000000000021'
const MC_PARAMETER = 'a0060000-0000-4000-8000-000000000022'
const MC_BINDING = 'a0060000-0000-4000-8000-000000000023'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, OWNER, WS)
  return client
}

async function propose(
  client: Client,
  operation: Record<string, unknown>,
  idempotencyKey: string,
) {
  const { rows } = await client.query(
    `SELECT * FROM api.propose_agent_operation(
      $1::uuid,$2::text,$3::text,$4::jsonb,$5::jsonb,$6::text
    )`,
    [
      WS,
      'Content write',
      'A content write proposed for human approval.',
      JSON.stringify(operation),
      JSON.stringify({
        agentId: 'content-helper',
        tool: { name: 'sheetbase.content', version: '1' },
        model: { provider: 'local', name: 'scripted' },
        invocationId: `invocation-${idempotencyKey}`,
      }),
      idempotencyKey,
    ],
  )
  return rows[0] as {
    id: string
    status: string
    revision: string
    approval_policy: string
    risk_class: string
    result: Record<string, unknown> | null
  }
}

async function decideAndExecute(
  client: Client,
  proposal: {
    id: string
    revision: string
  },
) {
  const approved = await client.query(
    `SELECT to_jsonb(api.decide_agent_operation($1,$2,'approve','Reviewed')) result`,
    [proposal.id, proposal.revision],
  )
  const decided = approved.rows[0].result as {
    revision: string
    status: string
  }
  expect(decided.status).toBe('approved')
  const executed = await client.query(
    `SELECT to_jsonb(api.execute_agent_operation($1,$2)) result`,
    [proposal.id, decided.revision],
  )
  const result = executed.rows[0].result as {
    status: string
    result: Record<string, unknown>
    error_code?: string
    error_message?: string
  }
  if (result.status !== 'succeeded') console.log('execution failed', result)
  return result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified")
     VALUES ($1,'Content Owner','content-owner@sheetbase.test',true)`,
    [OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'content','Content'),($2,'content-other','Content Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id)
     VALUES ($1,$2,'C01','Content project',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title)
     VALUES ($1,$2,'C02','Other project')`,
    [OTHER_PROJECT, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.record_field_definitions(
       workspace_id,kind,field_name,label,display_order,logical_type,
       lifecycle,created_by_user_id
     ) VALUES ($1,'experiment','batch','Batch',1,'text','active',$2)`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('agent content writes', () => {
  it('creates a record only after human approval and canonical execution', async () => {
    const owner = await actor()
    const proposed = await propose(
      owner,
      {
        kind: 'record.create',
        workspaceId: WS,
        projectId: PROJECT,
        recordKind: 'experiment',
        title: 'Agent-created experiment',
        tags: ['agent'],
      },
      'content-record-1',
    )

    expect(proposed.status).toBe('pending')
    expect(proposed.approval_policy).toBe('human_required')
    expect(proposed.risk_class).toBe('consequential_write')

    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      kind: 'experiment',
      title: 'Agent-created experiment',
      project_id: PROJECT,
    })
  })

  it('rejects a record target outside the active workspace', async () => {
    const owner = await actor()
    await expect(
      propose(
        owner,
        {
          kind: 'record.create',
          workspaceId: WS,
          projectId: OTHER_PROJECT,
          recordKind: 'experiment',
          title: 'Wrong workspace',
        },
        'content-record-2',
      ),
    ).rejects.toThrow(/invalid record create operation/)
  })

  it('updates custom fields at the expected metadata revision', async () => {
    const owner = await actor()
    const created = await owner.query<{ id: string; metadata_version: number }>(
      `SELECT id, metadata_version FROM api.create_record($1,'experiment','Fields target')`,
      [PROJECT],
    )
    const record = created.rows[0]

    const proposed = await propose(
      owner,
      {
        kind: 'record.custom_fields.update',
        recordId: record.id,
        expectedMetadataVersion: record.metadata_version,
        values: { batch: 'B-42' },
      },
      'content-fields-1',
    )
    expect(proposed.approval_policy).toBe('human_required')
    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      id: record.id,
      custom_fields: { batch: 'B-42' },
    })
  })

  it('updates, archives and restores a Sheet Instance through the canonical RPCs', async () => {
    const owner = await actor()
    const state = {
      bindings: [],
      localFields: [],
      localValues: {},
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
      provenance: { createdFrom: 'ad_hoc' },
    }
    const created = (
      await owner.query<{ result: { id: string; revision: number } }>(
        `SELECT to_jsonb(api.create_sheet_instance($1,'Agent sheet',NULL,NULL,$2,NULL,$3::jsonb)) result`,
        [WS, PROJECT, JSON.stringify(state)],
      )
    ).rows[0].result

    const update = await propose(
      owner,
      {
        kind: 'sheet_instance.update',
        instanceId: created.id,
        expectedRevision: created.revision,
        state: {
          ...state,
          presentation: { ...state.presentation, density: 'compact' },
        },
      },
      'content-sheet-update',
    )
    const updated = await decideAndExecute(owner, update)
    expect(updated.status).toBe('succeeded')
    expect(updated.result).toMatchObject({
      id: created.id,
      state: { presentation: { density: 'compact' } },
    })

    const archive = await propose(
      owner,
      {
        kind: 'sheet_instance.archive',
        instanceId: created.id,
        expectedRevision: (updated.result as { revision: number }).revision,
      },
      'content-sheet-archive',
    )
    const archived = await decideAndExecute(owner, archive)
    expect(archived.status).toBe('succeeded')
    expect(archived.result).toMatchObject({ lifecycle: 'archived' })

    const restore = await propose(
      owner,
      {
        kind: 'sheet_instance.restore',
        instanceId: created.id,
        expectedRevision: (archived.result as { revision: number }).revision,
      },
      'content-sheet-restore',
    )
    const restored = await decideAndExecute(owner, restore)
    expect(restored.status).toBe('succeeded')
    expect(restored.result).toMatchObject({ lifecycle: 'active' })
  })

  it('refuses a Sheet Instance whose source is not a published workspace version', async () => {
    const owner = await actor()
    await expect(
      propose(
        owner,
        {
          kind: 'sheet_instance.create',
          workspaceId: WS,
          name: 'Agent sheet',
          sourceDefinitionVersionId: 'a0060000-0000-4000-8000-000000000099',
          projectId: PROJECT,
          state: {},
        },
        'content-sheet-1',
      ),
    ).rejects.toThrow(/invalid Sheet Instance create operation/)
  })

  it('creates and activates a model field through the canonical RPCs', async () => {
    const owner = await actor()
    const create = await propose(
      owner,
      {
        kind: 'model_field.create',
        workspaceId: WS,
        modelKey: 'experiment',
        fieldName: 'agent_note',
        label: 'Agent note',
        logicalType: 'text',
      },
      'content-model-field-create',
    )
    const created = await decideAndExecute(owner, create)
    expect(created.status).toBe('succeeded')
    expect(created.result).toMatchObject({
      field_name: 'agent_note',
      lifecycle: 'draft',
    })
    const definitionId = (created.result as { id: string }).id

    const activate = await propose(
      owner,
      { kind: 'model_field.activate', definitionId },
      'content-model-field-activate',
    )
    const activated = await decideAndExecute(owner, activate)
    expect(activated.status).toBe('succeeded')
    expect(activated.result).toMatchObject({
      id: definitionId,
      lifecycle: 'active',
    })
  })

  it('creates a notebook comment through the canonical RPC', async () => {
    const owner = await actor()
    const record = (
      await owner.query<{ id: string }>(
        `SELECT id FROM api.create_record($1,'experiment','Comment target')`,
        [PROJECT],
      )
    ).rows[0]
    const proposed = await propose(
      owner,
      {
        kind: 'record.comment.create',
        recordId: record.id,
        targetKind: 'record',
        target: {},
        body: 'Agent note: check the hold time.',
        mentions: [],
      },
      'content-comment-1',
    )
    expect(proposed.approval_policy).toBe('human_required')
    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      body: 'Agent note: check the hold time.',
    })
    const comments = await migrator.query(
      `SELECT body FROM api.comments WHERE record_id=$1`,
      [record.id],
    )
    expect(comments.rows).toEqual([
      { body: 'Agent note: check the hold time.' },
    ])
  })

  it('moves a notebook block between anchors through the canonical RPC', async () => {
    const owner = await actor()
    const record = (
      await owner.query<{ id: string }>(
        `SELECT id FROM api.create_record($1,'experiment','Move target')`,
        [PROJECT],
      )
    ).rows[0]
    const first = (
      await owner.query<{
        result: { block: { id: string }; structure_version: number }
      }>(
        `SELECT api.insert_block($1,'rich_text','{"doc":{"type":"doc","content":[]}}'::jsonb) result`,
        [record.id],
      )
    ).rows[0].result
    const second = (
      await owner.query<{
        result: { block: { id: string }; structure_version: number }
      }>(
        `SELECT api.insert_block($1,'rich_text','{"doc":{"type":"doc","content":[]}}'::jsonb) result`,
        [record.id],
      )
    ).rows[0].result

    const proposal = await propose(
      owner,
      {
        kind: 'notebook_block.move',
        blockId: second.block.id,
        expectedStructureVersion: second.structure_version,
        beforeBlockId: first.block.id,
      },
      'content-block-move',
    )
    const moved = await decideAndExecute(owner, proposal)
    expect(moved.status).toBe('succeeded')
    const order = await migrator.query<{ id: string; order: number }>(
      `SELECT id, "order" FROM api.blocks WHERE record_id=$1 ORDER BY "order"`,
      [record.id],
    )
    expect(order.rows.map((row) => row.id)).toEqual([
      second.block.id,
      first.block.id,
    ])
  })

  it('updates and deletes a notebook block through the canonical RPCs', async () => {
    const owner = await actor()
    const record = (
      await owner.query<{ id: string }>(
        `SELECT id FROM api.create_record($1,'experiment','Block target')`,
        [PROJECT],
      )
    ).rows[0]
    const inserted = (
      await owner.query<{
        block: { id: string; version: number }
        structure_version: number
      }>(
        `SELECT api.insert_block($1,'rich_text','{"doc":{"type":"doc","content":[]}}'::jsonb) result`,
        [record.id],
      )
    ).rows[0].result as {
      block: { id: string; version: number }
      structure_version: number
    }

    const update = await propose(
      owner,
      {
        kind: 'notebook_block.update',
        blockId: inserted.block.id,
        expectedVersion: inserted.block.version,
        payload: { doc: { type: 'doc', content: [] }, note: 'updated' },
      },
      'content-block-update',
    )
    expect(update.approval_policy).toBe('human_required')
    const updated = await decideAndExecute(owner, update)
    expect(updated.status).toBe('succeeded')
    expect(updated.result).toMatchObject({
      id: inserted.block.id,
      payload: { note: 'updated' },
    })

    const remove = await propose(
      owner,
      {
        kind: 'notebook_block.delete',
        blockId: inserted.block.id,
        expectedStructureVersion: inserted.structure_version,
      },
      'content-block-delete',
    )
    const removed = await decideAndExecute(owner, remove)
    expect(removed.status).toBe('succeeded')
    const blocks = await migrator.query(
      `SELECT id FROM api.blocks WHERE record_id=$1`,
      [record.id],
    )
    expect(blocks.rows).toEqual([])
  })

  it('instantiates an active protocol template through the canonical RPC', async () => {
    const owner = await actor()
    const template = await owner.query<{ id: string }>(
      `SELECT id FROM api.create_record(NULL,'protocol_template','Protocol template','active')`,
    )
    const proposed = await propose(
      owner,
      {
        kind: 'template.instantiate',
        templateRecordId: template.rows[0].id,
        targetProjectId: PROJECT,
        targetKind: 'experiment',
        title: 'Instantiated experiment',
      },
      'content-template-1',
    )
    expect(proposed.approval_policy).toBe('human_required')
    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      record: { kind: 'experiment', title: 'Instantiated experiment' },
    })
  })

  it('materializes a Sheet Instance through a preview-bound proposal', async () => {
    const owner = await actor()
    const schema = (
      await owner.query<{ result: { schema_version_id: string } }>(
        `SELECT api.create_dataset_schema_definition(
           $1,'mat_results','Materialization results',NULL,$2::jsonb
         ) result`,
        [
          WS,
          JSON.stringify([
            {
              field_id: MC_FIELD,
              key: 'sample',
              label: 'Sample',
              logical_type: 'text',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schema.schema_version_id,
    ])
    const datasetId = (
      await migrator.query<{ id: string }>(
        `INSERT INTO api.datasets(workspace_id,schema_version_id,name)
         VALUES($1,$2,'Materialization source') RETURNING id`,
        [WS, schema.schema_version_id],
      )
    ).rows[0].id
    const rowId = (
      await migrator.query<{ id: string }>(
        `INSERT INTO api.dataset_rows(dataset_id,workspace_id)
         VALUES($1,$2) RETURNING id`,
        [datasetId, WS],
      )
    ).rows[0].id
    await migrator.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,text_value)
       VALUES($1,$2,'S-1')`,
      [rowId, MC_FIELD],
    )

    const configuration = {
      formatVersion: 1,
      parameters: [
        {
          id: MC_PARAMETER,
          key: 'results',
          label: 'Results',
          required: true,
          type: {
            kind: 'dataset',
            contract: {
              mode: 'exact',
              schemaVersionId: schema.schema_version_id,
            },
          },
          constraints: {},
        },
      ],
      bindings: [{ id: MC_BINDING, key: 'results', parameterId: MC_PARAMETER }],
      rowIdentity: { kind: 'source', columnIds: [MC_COLUMN] },
      joins: [],
      columns: [
        {
          id: MC_COLUMN,
          field: {
            fieldId: MC_COLUMN,
            key: 'sample',
            label: 'Sample',
            description: null,
            logicalType: 'text',
            nullable: true,
            defaultValue: null,
            cardinality: 'one',
            quantity: null,
            validation: {},
            category: null,
            relationship: null,
            computation: { mode: 'stored' },
            lifecycle: 'active',
          },
          source: {
            kind: 'bound',
            bindingId: MC_BINDING,
            sourceFieldId: MC_FIELD,
          },
        },
      ],
      calculations: [],
      writeBackRules: [],
      actions: [],
      presentation: {
        columnOrder: [MC_COLUMN],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
    }
    const definition = (
      await owner.query<{
        result: { version: { id: string; revision: number } }
      }>(
        `SELECT api.create_sheet_definition(
           $1,'mat_sheet','Materialization sheet',NULL,$2::jsonb
         ) result`,
        [WS, JSON.stringify(configuration)],
      )
    ).rows[0].result
    await owner.query(`SELECT api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const instance = (
      await owner.query<{ result: { id: string; revision: number } }>(
        `SELECT to_jsonb(api.create_sheet_instance_from_definition(
           $1,'Materialization instance',NULL,$2,NULL,NULL,$3::jsonb,$4::jsonb
         )) result`,
        [
          WS,
          definition.version.id,
          JSON.stringify({
            bindings: [],
            localFields: [],
            localValues: {},
            calculationOverrides: {},
            presentation: configuration.presentation,
            provenance: { createdFrom: 'definition_version' },
          }),
          JSON.stringify([
            { parameterId: MC_PARAMETER, kind: 'dataset', datasetId },
          ]),
        ],
      )
    ).rows[0].result

    const resolved = (
      await owner.query<{ result: { id: string; revision: number } }>(
        `SELECT to_jsonb(api.resolve_sheet_instance_row_identity($1,$2)) result`,
        [instance.id, instance.revision],
      )
    ).rows[0].result
    const preview = (
      await owner.query<{ result: { previewDigest: string } }>(
        `SELECT api.preview_sheet_materialization($1,$2,NULL) result`,
        [resolved.id, resolved.revision],
      )
    ).rows[0].result
    const proposed = await propose(
      owner,
      {
        kind: 'sheet_instance.materialize',
        instanceId: resolved.id,
        expectedRevision: resolved.revision,
        outputName: 'Agent materialization',
        previewDigest: preview.previewDigest,
      },
      'content-sheet-materialize',
    )
    expect(proposed.approval_policy).toBe('human_required')
    expect(proposed.risk_class).toBe('consequential_write')
    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    const outputId = (executed.result as { datasetId: string }).datasetId
    expect(outputId).toBeTruthy()
    const output = await migrator.query<{ name: string }>(
      `SELECT name FROM api.datasets WHERE id=$1`,
      [outputId],
    )
    expect(output.rows).toEqual([{ name: 'Agent materialization' }])
  })

  it('refuses a materialization proposal for an ad hoc Sheet Instance', async () => {
    const owner = await actor()
    const created = (
      await owner.query<{ result: { id: string; revision: number } }>(
        `SELECT to_jsonb(api.create_sheet_instance($1,'Ad hoc',NULL,NULL,NULL,NULL,$2::jsonb)) result`,
        [
          WS,
          JSON.stringify({
            bindings: [],
            localFields: [],
            localValues: {},
            calculationOverrides: {},
            presentation: {
              columnOrder: [],
              hiddenColumnIds: [],
              columnWidths: {},
              frozenColumnCount: 0,
              density: 'standard',
            },
            provenance: { createdFrom: 'ad_hoc' },
          }),
        ],
      )
    ).rows[0].result
    await expect(
      propose(
        owner,
        {
          kind: 'sheet_instance.materialize',
          instanceId: created.id,
          expectedRevision: created.revision,
          outputName: 'Ad hoc output',
          previewDigest: '0'.repeat(64),
        },
        'content-sheet-materialize-ad-hoc',
      ),
    ).rejects.toThrow(/Definition-backed Sheet Instance required/)
  })
})
