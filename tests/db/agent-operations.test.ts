/**
 * AUTO-04 database proof.
 *
 * Proposals are workspace-scoped, idempotent, human-approved, revisioned, and
 * executed through the canonical operation RPC. The proposal timeline and the
 * ordinary change-event stream retain attribution and outcome evidence.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0040000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0040000-0000-4000-8000-000000000002'
const OWNER = 'auto04-owner'
const VIEWER = 'auto04-viewer'
const OUTSIDER = 'auto04-outsider'
const CREDENTIAL = 'a0040000-0000-4000-8000-000000000003'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(
  userId: string,
  workspaceId: string,
  extra: Record<string, unknown> = {},
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId, extra)
  return client
}

async function credential(workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await setActorJwt(client, '', workspaceId, {
    role: 'api_client',
    sub: null,
    credential_id: CREDENTIAL,
    scopes: ['schema:write'],
  })
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
      'Create assay schema',
      'Create a governed draft for reviewed assay measurements.',
      JSON.stringify(operation),
      JSON.stringify({
        agentId: 'assay-helper',
        agentName: 'Assay helper',
        tool: { name: 'sheetbase.schema', version: '1' },
        model: { provider: 'openai', name: 'gpt-5.6' },
        invocationId: 'invocation-auto04',
      }),
      idempotencyKey,
    ],
  )
  return rows[0] as {
    id: string
    status: string
    revision: string
    request_digest: string
    preview: Record<string, unknown>
    impact: Record<string, unknown>
    result: Record<string, unknown> | null
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified") VALUES
      ($1,'AUTO04 Owner','auto04-owner@sheetbase.test',true),
      ($2,'AUTO04 Viewer','auto04-viewer@sheetbase.test',true),
      ($3,'AUTO04 Outsider','auto04-outsider@sheetbase.test',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'auto04','AUTO04'),($2,'auto04-other','AUTO04 Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO internal.api_credentials(
      id,workspace_id,name,display_prefix,secret_hash,scopes,created_by_user_id
    ) VALUES ($1,$2,'AUTO04 credential','sb_auto04','auto04-hash',ARRAY['schema:write'],$3)`,
    [CREDENTIAL, WS, OWNER],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('AUTO-04 agent-authored operations', () => {
  it('previews idempotently, requires human approval, and executes the canonical schema RPC', async () => {
    const owner = await actor(OWNER, WS)
    const operation = {
      kind: 'dataset_schema.create',
      workspaceId: WS,
      key: 'agent_assay',
      name: 'Agent assay',
      description: 'Reviewed assay measurements',
      fields: [
        {
          key: 'sample_id',
          label: 'Sample ID',
          logicalType: 'text',
          nullable: false,
        },
        {
          key: 'titre',
          label: 'Titre',
          logicalType: 'decimal',
          nullable: false,
        },
      ],
    }

    const proposed = await propose(owner, operation, 'auto04-schema-1')
    const replay = await propose(owner, operation, 'auto04-schema-1')
    expect(replay.id).toBe(proposed.id)
    expect(replay.request_digest).toBe(proposed.request_digest)
    expect(proposed.status).toBe('pending')
    expect(proposed.preview).toMatchObject({
      formatVersion: 1,
      kind: 'dataset_schema.create',
      target: { type: 'dataset_schema', label: 'Agent assay' },
    })
    expect(proposed.impact).toMatchObject({
      mutationClass: 'configuration',
      createsDraft: true,
      affectedRows: 0,
      destructive: false,
    })

    const credentialSession = await credential(WS)
    const credentialProposal = await propose(
      credentialSession,
      {
        ...operation,
        key: 'agent_assay_credential',
        name: 'Credential agent assay',
      },
      'auto04-schema-credential',
    )
    expect(credentialProposal.status).toBe('pending')
    await expectDenied(
      credentialSession.query(
        `SELECT * FROM api.decide_agent_operation($1,1,'approve',NULL)`,
        [credentialProposal.id],
      ),
      '42501',
    )

    const approved = await owner.query<{
      status: string
      revision: string
      approved_by_user_id: string
    }>(
      `SELECT status,revision,approved_by_user_id
         FROM api.decide_agent_operation($1,1,'approve',NULL)`,
      [proposed.id],
    )
    expect(approved.rows[0]).toMatchObject({
      status: 'approved',
      revision: '2',
      approved_by_user_id: OWNER,
    })

    const executed = await owner.query<{
      status: string
      revision: string
      result: {
        schema_definition_id: string
        schema_version_id: string
      }
    }>(
      `SELECT status,revision,result
         FROM api.execute_agent_operation($1,2)`,
      [proposed.id],
    )
    expect(executed.rows[0].status).toBe('succeeded')
    expect(executed.rows[0].revision).toBe('4')

    const canonical = await migrator.query(
      `SELECT d.key,d.name,v.lifecycle,count(f.*)::int AS field_count
         FROM api.dataset_schema_definitions d
         JOIN api.dataset_schema_versions v ON v.schema_id=d.id
         LEFT JOIN api.dataset_schema_version_fields f ON f.schema_version_id=v.id
        WHERE d.id=$1
        GROUP BY d.key,d.name,v.lifecycle`,
      [executed.rows[0].result.schema_definition_id],
    )
    expect(canonical.rows[0]).toEqual({
      key: 'agent_assay',
      name: 'Agent assay',
      lifecycle: 'draft',
      field_count: 2,
    })

    const timeline = await owner.query(
      `SELECT event_type FROM api.agent_operation_events
        WHERE proposal_id=$1 ORDER BY sequence`,
      [proposed.id],
    )
    expect(timeline.rows.map((row) => row.event_type)).toEqual([
      'proposed',
      'approved',
      'execution_started',
      'execution_succeeded',
    ])
    const audit = await migrator.query(
      `SELECT operation,payload->>'status' AS status
         FROM api.change_events
        WHERE entity_type='agent_operation_proposal' AND entity_uuid=$1
        ORDER BY sequence`,
      [proposed.id],
    )
    expect(audit.rows).toEqual([
      { operation: 'create', status: 'pending' },
      { operation: 'update', status: 'approved' },
      { operation: 'update', status: 'succeeded' },
    ])
  })

  it('delegates Sheet and Pipeline drafts to their versioned Definition RPCs', async () => {
    const owner = await actor(OWNER, WS)
    const sheet = await propose(
      owner,
      {
        kind: 'sheet_definition.create',
        workspaceId: WS,
        key: 'agent_results_sheet',
        name: 'Agent results sheet',
        description: 'Drafted from the approved agent proposal.',
        configuration: validSheetDefinitionConfiguration(),
      },
      'auto04-sheet-create',
    )
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
      [sheet.id],
    )
    const sheetResult = await owner.query<{
      status: string
      result: {
        definition: { id: string }
        version: { lifecycle: string; configuration: Record<string, unknown> }
      }
    }>(`SELECT status,result FROM api.execute_agent_operation($1,2)`, [
      sheet.id,
    ])
    expect(sheetResult.rows[0].status).toBe('succeeded')
    expect(sheetResult.rows[0].result.version).toMatchObject({
      lifecycle: 'draft',
      configuration: { formatVersion: 1 },
    })

    const definition = await owner.query<{ id: string; revision: string }>(
      `SELECT id,revision FROM api.create_pipeline_definition(
        $1,'agent_pipeline_versioned','Agent pipeline versioned',NULL
      )`,
      [WS],
    )
    const pipeline = await propose(
      owner,
      {
        kind: 'pipeline_definition.create_version',
        workspaceId: WS,
        definitionId: definition.rows[0].id,
        expectedDefinitionRevision: Number(definition.rows[0].revision),
        configuration: {
          configVersion: 1,
          description: 'A deterministic pass-through draft.',
          parameters: [],
          inputs: [{ name: 'input', required: true }],
          transform: {
            language: 'sql',
            statement: 'SELECT * FROM input',
          },
          output: {
            mode: 'create',
            schemaVersionId: '90000000-0000-4000-8000-000000000001',
            datasetName: 'Agent pipeline output',
            datasetLabel: 'Agent pipeline output',
          },
        },
      },
      'auto04-pipeline-version',
    )
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
      [pipeline.id],
    )
    const pipelineResult = await owner.query<{
      status: string
      result: {
        definition_id: string
        lifecycle: string
        version: number
      }
    }>(`SELECT status,result FROM api.execute_agent_operation($1,2)`, [
      pipeline.id,
    ])
    expect(pipelineResult.rows[0]).toMatchObject({
      status: 'succeeded',
      result: {
        definition_id: definition.rows[0].id,
        lifecycle: 'draft',
        version: 1,
      },
    })
  })

  it('enforces capability, workspace isolation, and optimistic proposal revision', async () => {
    const viewer = await actor(VIEWER, WS)
    const owner = await actor(OWNER, WS)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const operation = {
      kind: 'pipeline_definition.create',
      workspaceId: WS,
      key: 'agent_pipeline',
      name: 'Agent Pipeline',
      description: null,
    }

    await expectDenied(propose(viewer, operation, 'viewer-denied'), '42501')
    await expectDenied(
      propose(outsider, operation, 'other-workspace-denied'),
      '42501',
    )

    const proposed = await propose(owner, operation, 'auto04-pipeline-1')
    await owner.query(
      `SELECT * FROM api.decide_agent_operation($1,1,'approve',NULL)`,
      [proposed.id],
    )
    await expect(
      owner.query(
        `SELECT * FROM api.decide_agent_operation($1,1,'approve',NULL)`,
        [proposed.id],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
    const crossWorkspace = await outsider.query(
      `SELECT * FROM api.agent_operation_proposals WHERE id=$1`,
      [proposed.id],
    )
    expect(crossWorkspace.rowCount).toBe(0)
  })

  it('records canonical optimistic-concurrency failure without applying stale data', async () => {
    const owner = await actor(OWNER, WS)
    const schemaDefinition = await owner.query<{
      result: {
        schema_definition_id: string
        schema_version_id: string
      }
    }>(
      `SELECT api.create_dataset_schema_definition(
        $1,'agent_rows','Agent rows',NULL,
        '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
      ) result`,
      [WS],
    )
    const schemaVersionId = schemaDefinition.rows[0].result.schema_version_id
    await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schemaVersionId,
    ])
    const dataset = await owner.query<{ id: string }>(
      `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       VALUES($1,$2,'Agent row target',$3) RETURNING id`,
      [WS, schemaVersionId, OWNER],
    )
    const field = await migrator.query<{ field_id: string }>(
      `SELECT field_id FROM api.dataset_schema_version_fields
        WHERE schema_version_id=$1`,
      [schemaVersionId],
    )
    const rowId = 'a0040000-0000-4000-8000-000000000010'
    await owner.query(
      `SELECT api.commit_dataset_row_batch($1,1,$2::jsonb,'auto04-initial-row')`,
      [
        dataset.rows[0].id,
        JSON.stringify([
          {
            operation: 'create',
            rowId,
            values: { [field.rows[0].field_id]: 1 },
          },
        ]),
      ],
    )

    const proposed = await propose(
      owner,
      {
        kind: 'dataset_rows.commit',
        datasetId: dataset.rows[0].id,
        expectedRevision: 2,
        rows: [
          {
            operation: 'update',
            rowId,
            expectedRevision: 1,
            values: { [field.rows[0].field_id]: 2 },
          },
        ],
      },
      'auto04-stale-row',
    )
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
      [proposed.id],
    )
    await owner.query(
      `SELECT api.commit_dataset_row_batch($1,2,$2::jsonb,'auto04-racing-row')`,
      [
        dataset.rows[0].id,
        JSON.stringify([
          {
            operation: 'update',
            rowId,
            expectedRevision: 1,
            values: { [field.rows[0].field_id]: 9 },
          },
        ]),
      ],
    )

    const failed = await owner.query<{
      status: string
      error_code: string
      result: unknown
    }>(
      `SELECT status,error_code,result
         FROM api.execute_agent_operation($1,2)`,
      [proposed.id],
    )
    expect(failed.rows[0]).toMatchObject({
      status: 'failed',
      error_code: 'SB073',
      result: null,
    })
    const current = await owner.query<{
      result: { rows: Array<{ values: Record<string, unknown> }> }
    }>(`SELECT api.query_dataset_rows($1,'{}'::jsonb,100,0) result`, [
      dataset.rows[0].id,
    ])
    expect(current.rows[0].result.rows[0].values[field.rows[0].field_id]).toBe(
      9,
    )
  })
})
