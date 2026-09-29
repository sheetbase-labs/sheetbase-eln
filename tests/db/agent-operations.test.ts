/**
 * AUTO-04 database proof.
 *
 * Proposals are workspace-scoped, idempotent, risk-classified, revisioned,
 * and executed through the canonical operation RPC. Policy decisions and the
 * proposal timeline retain attribution and evaluation evidence.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0040000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0040000-0000-4000-8000-000000000002'
const OWNER = 'auto04-owner'
const STEWARD = 'auto04-steward'
const VIEWER = 'auto04-viewer'
const OUTSIDER = 'auto04-outsider'
const CREDENTIAL = 'a0040000-0000-4000-8000-000000000003'
const LIMITED_CREDENTIAL = 'a0040000-0000-4000-8000-000000000004'
const NO_AGENT_CREDENTIAL = 'a0040000-0000-4000-8000-000000000005'
const OTHER_CREDENTIAL = 'a0040000-0000-4000-8000-000000000006'

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

async function credential(
  workspaceId: string,
  credentialId = CREDENTIAL,
  scopes = [
    'agent_operations:read',
    'agent_operations:write',
    'datasets:write',
    'schema:write',
  ],
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await setActorJwt(client, '', workspaceId, {
    role: 'api_client',
    sub: null,
    credential_id: credentialId,
    scopes,
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
    risk_class: string
    approval_policy: string
    policy_id: string | null
    policy_reason: string
    policy_limits: Record<string, unknown>
    policy_target: Record<string, unknown>
    policy_evidence: Record<string, unknown>
    executed_by_credential_id: string | null
    result: Record<string, unknown> | null
  }
}

async function createDataset(
  client: Client,
  key: string,
  name: string,
  primaryProjectId: string | null = null,
): Promise<{ id: string; fieldId: string }> {
  const schema = await client.query<{
    result: { schema_version_id: string }
  }>(
    `SELECT api.create_dataset_schema_definition(
      $1,$2,$3,NULL,
      '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
    ) result`,
    [WS, key, `${name} schema`],
  )
  const schemaVersionId = schema.rows[0].result.schema_version_id
  await client.query(`SELECT api.publish_dataset_schema_version($1)`, [
    schemaVersionId,
  ])
  const dataset = await client.query<{ id: string }>(
    `INSERT INTO api.datasets(
       workspace_id,primary_project_id,schema_version_id,name,created_by_user_id
     ) VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [WS, primaryProjectId, schemaVersionId, name, OWNER],
  )
  const field = await migrator.query<{ field_id: string }>(
    `SELECT field_id FROM api.dataset_schema_version_fields
      WHERE schema_version_id=$1`,
    [schemaVersionId],
  )
  return { id: dataset.rows[0].id, fieldId: field.rows[0].field_id }
}

async function createPolicy(
  client: Client,
  input: {
    name: string
    targetType: string
    targetId: string | null
    maxAffectedRows: number
    credentialId?: string
  },
) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_agent_operation_policy(
      $1,$2,'dataset_rows.commit',$3,$4,$5,$6::jsonb
    )`,
    [
      WS,
      input.name,
      input.targetType,
      input.targetId,
      input.credentialId ?? CREDENTIAL,
      JSON.stringify({ maxAffectedRows: input.maxAffectedRows }),
    ],
  )
  return rows[0] as { id: string; enabled: boolean; credential_id: string }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified") VALUES
      ($1,'AUTO04 Owner','auto04-owner@sheetbase.test',true),
      ($2,'AUTO04 Steward','auto04-steward@sheetbase.test',true),
      ($3,'AUTO04 Viewer','auto04-viewer@sheetbase.test',true),
      ($4,'AUTO04 Outsider','auto04-outsider@sheetbase.test',true)`,
    [OWNER, STEWARD, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'auto04','AUTO04'),($2,'auto04-other','AUTO04 Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$2,'owner'),($1,$3,'steward'),($1,$4,'viewer'),($5,$6,'owner')`,
    [WS, OWNER, STEWARD, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO internal.api_credentials(
      id,workspace_id,name,display_prefix,secret_hash,scopes,created_by_user_id
    ) VALUES
      ($1,$2,'AUTO04 credential','sb_auto04','auto04-hash',ARRAY['agent_operations:read','agent_operations:write','datasets:write','schema:write'],$3),
      ($4,$2,'AUTO04 limited credential','sb_auto04_limited','auto04-limited-hash',ARRAY['agent_operations:read','agent_operations:write'],$3),
      ($5,$2,'AUTO04 no-agent credential','sb_auto04_no_agent','auto04-no-agent-hash',ARRAY['datasets:write'],$3),
      ($6,$2,'AUTO04 other credential','sb_auto04_other','auto04-other-hash',ARRAY['agent_operations:read','agent_operations:write','datasets:write'],$3)`,
    [
      CREDENTIAL,
      WS,
      OWNER,
      LIMITED_CREDENTIAL,
      NO_AGENT_CREDENTIAL,
      OTHER_CREDENTIAL,
    ],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('AUTO-04 agent-authored operations', () => {
  it('auto-executes a safe draft through the canonical schema RPC', async () => {
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
    expect(proposed.status).toBe('succeeded')
    expect(proposed.risk_class).toBe('safe_draft')
    expect(proposed.approval_policy).toBe('automatic')
    expect(proposed.executed_by_credential_id).toBeNull()
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
    expect(credentialProposal.status).toBe('succeeded')
    expect(credentialProposal.approval_policy).toBe('automatic')
    expect(credentialProposal.executed_by_credential_id).toBe(CREDENTIAL)

    const executed = await owner.query<{
      status: string
      revision: string
      result: {
        schema_definition_id: string
        schema_version_id: string
      }
    }>(
      `SELECT status,revision,result,executed_by_credential_id
         FROM api.agent_operation_proposals
        WHERE id=$1`,
      [proposed.id],
    )
    expect(executed.rows[0].status).toBe('succeeded')
    expect(executed.rows[0].revision).toBe('3')

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
    const sheetResult = await owner.query<{
      status: string
      result: {
        definition: { id: string }
        version: { lifecycle: string; configuration: Record<string, unknown> }
      }
    }>(`SELECT status,result FROM api.agent_operation_proposals WHERE id=$1`, [
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
    const pipelineResult = await owner.query<{
      status: string
      result: {
        definition_id: string
        lifecycle: string
        version: number
      }
    }>(`SELECT status,result FROM api.agent_operation_proposals WHERE id=$1`, [
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

    const stalePipeline = await propose(
      owner,
      {
        kind: 'pipeline_definition.create_version',
        workspaceId: WS,
        definitionId: definition.rows[0].id,
        expectedDefinitionRevision: Number(definition.rows[0].revision),
        configuration: {
          configVersion: 1,
          description:
            'This version must not be created from a stale revision.',
          parameters: [],
          inputs: [{ name: 'input', required: true }],
          transform: {
            language: 'sql',
            statement: 'SELECT * FROM input',
          },
          output: {
            mode: 'create',
            schemaVersionId: '90000000-0000-4000-8000-000000000001',
            datasetName: 'Stale pipeline output',
            datasetLabel: 'Stale pipeline output',
          },
        },
      },
      'auto04-pipeline-stale',
    )
    expect(stalePipeline).toMatchObject({
      status: 'failed',
      error_code: 'SB001',
    })
    const versionCount = await owner.query<{ count: string }>(
      `SELECT count(*) FROM api.pipeline_definition_versions WHERE definition_id=$1`,
      [definition.rows[0].id],
    )
    expect(versionCount.rows[0].count).toBe('1')
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
    expect(proposed.status).toBe('succeeded')
    const crossWorkspace = await outsider.query(
      `SELECT * FROM api.agent_operation_proposals WHERE id=$1`,
      [proposed.id],
    )
    expect(crossWorkspace.rowCount).toBe(0)
  })

  it('keeps Dataset writes human-required by default and records a scoped delegation', async () => {
    const owner = await actor(OWNER, WS)
    const steward = await actor(STEWARD, WS)
    const viewer = await actor(VIEWER, WS)
    const agent = await credential(WS)
    const dataset = await createDataset(
      owner,
      'policy_dataset',
      'Policy Dataset',
    )

    const defaultWrite = await propose(
      owner,
      {
        kind: 'dataset_rows.commit',
        datasetId: dataset.id,
        expectedRevision: 1,
        rows: [
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000011',
            values: { [dataset.fieldId]: 10 },
          },
        ],
      },
      'auto04-default-data-write',
    )
    expect(defaultWrite).toMatchObject({
      status: 'pending',
      risk_class: 'consequential_write',
      approval_policy: 'human_required',
      policy_id: null,
    })

    const policy = await createPolicy(steward, {
      name: 'Policy Dataset row delegation',
      targetType: 'dataset',
      targetId: dataset.id,
      maxAffectedRows: 1,
    })
    expect(policy.enabled).toBe(true)
    expect(policy.credential_id).toBe(CREDENTIAL)
    await expectDenied(
      viewer.query(
        `SELECT api.create_agent_operation_policy(
          $1,'viewer policy','dataset_rows.commit','dataset',$2,$3,'{"maxAffectedRows":1}'::jsonb
        )`,
        [WS, dataset.id, CREDENTIAL],
      ),
      '42501',
    )

    const delegated = await propose(
      agent,
      {
        kind: 'dataset_rows.commit',
        datasetId: dataset.id,
        expectedRevision: 1,
        rows: [
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000012',
            values: { [dataset.fieldId]: 11 },
          },
        ],
      },
      'auto04-delegated-data-write',
    )
    expect(delegated).toMatchObject({
      status: 'succeeded',
      approval_policy: 'delegated',
      policy_id: policy.id,
      executed_by_credential_id: CREDENTIAL,
    })
    expect(delegated.policy_limits).toEqual({ maxAffectedRows: 1 })
    expect(delegated.policy_evidence).toMatchObject({
      actorKind: 'credential',
      requiredScope: 'datasets:write',
      scopeSatisfied: true,
      targetMatched: true,
      createOnly: true,
      limitSatisfied: true,
    })
  })

  it('keeps non-matching targets and exceeded limits human-required', async () => {
    const owner = await actor(OWNER, WS)
    const agent = await credential(WS)
    const first = await createDataset(owner, 'policy_first', 'Policy First')
    const second = await createDataset(owner, 'policy_second', 'Policy Second')
    await createPolicy(owner, {
      name: 'First Dataset only',
      targetType: 'dataset',
      targetId: first.id,
      maxAffectedRows: 1,
    })

    const nonMatching = await propose(
      agent,
      {
        kind: 'dataset_rows.commit',
        datasetId: second.id,
        expectedRevision: 1,
        rows: [
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000013',
            values: { [second.fieldId]: 12 },
          },
        ],
      },
      'auto04-nonmatching-target',
    )
    expect(nonMatching).toMatchObject({
      status: 'pending',
      approval_policy: 'human_required',
      policy_id: null,
    })
    expect(nonMatching.policy_reason).toContain('human approval')

    const tooMany = await propose(
      agent,
      {
        kind: 'dataset_rows.commit',
        datasetId: first.id,
        expectedRevision: 1,
        rows: [
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000014',
            values: { [first.fieldId]: 13 },
          },
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000015',
            values: { [first.fieldId]: 14 },
          },
        ],
      },
      'auto04-limit-exceeded',
    )
    expect(tooMany).toMatchObject({
      status: 'pending',
      approval_policy: 'human_required',
      policy_id: expect.any(String),
      policy_limits: { maxAffectedRows: 1 },
    })
    expect(tooMany.policy_evidence).toMatchObject({
      targetMatched: true,
      affectedRows: 2,
      maxAffectedRows: 1,
      limitSatisfied: false,
    })
    expect(tooMany.policy_reason).toContain('limit')
  })

  it('keeps other credentials and Dataset updates human-required', async () => {
    const owner = await actor(OWNER, WS)
    const agent = await credential(WS)
    const other = await credential(WS, OTHER_CREDENTIAL)
    const dataset = await createDataset(
      owner,
      'policy_bound_dataset',
      'Policy Bound Dataset',
    )
    const policy = await createPolicy(owner, {
      name: 'Bound credential append',
      targetType: 'dataset',
      targetId: dataset.id,
      maxAffectedRows: 2,
    })
    const existingRowId = 'a0040000-0000-4000-8000-000000000019'
    await owner.query(
      `SELECT api.commit_dataset_row_batch($1,1,$2::jsonb,'auto04-bound-seed')`,
      [
        dataset.id,
        JSON.stringify([
          {
            operation: 'create',
            rowId: existingRowId,
            values: { [dataset.fieldId]: 19 },
          },
        ]),
      ],
    )

    const otherCredentialWrite = await propose(
      other,
      {
        kind: 'dataset_rows.commit',
        datasetId: dataset.id,
        expectedRevision: 2,
        rows: [
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000018',
            values: { [dataset.fieldId]: 20 },
          },
        ],
      },
      'auto04-other-credential',
    )
    expect(otherCredentialWrite).toMatchObject({
      status: 'pending',
      approval_policy: 'human_required',
      policy_id: null,
    })
    expect(otherCredentialWrite.policy_reason).toContain('credential-bound')

    const updateWrite = await propose(
      agent,
      {
        kind: 'dataset_rows.commit',
        datasetId: dataset.id,
        expectedRevision: 2,
        rows: [
          {
            operation: 'update',
            rowId: existingRowId,
            expectedRevision: 1,
            values: { [dataset.fieldId]: 21 },
          },
        ],
      },
      'auto04-update-write',
    )
    expect(updateWrite).toMatchObject({
      status: 'pending',
      approval_policy: 'human_required',
      policy_id: policy.id,
    })
    expect(updateWrite.policy_evidence).toMatchObject({
      targetMatched: true,
      createOnly: false,
    })
    expect(updateWrite.policy_reason).toContain('create and append')
  })

  it('enforces workspace isolation, credential scopes, and policy lifecycle', async () => {
    const owner = await actor(OWNER, WS)
    const steward = await actor(STEWARD, WS)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const limited = await credential(WS, LIMITED_CREDENTIAL, [
      'agent_operations:read',
      'agent_operations:write',
    ])
    const noAgent = await credential(WS, NO_AGENT_CREDENTIAL, [
      'datasets:write',
    ])
    const dataset = await createDataset(owner, 'scope_dataset', 'Scope Dataset')
    const policy = await createPolicy(owner, {
      name: 'Scope Dataset delegation',
      targetType: 'dataset',
      targetId: dataset.id,
      maxAffectedRows: 1,
    })

    const limitedProposal = await propose(
      limited,
      {
        kind: 'dataset_rows.commit',
        datasetId: dataset.id,
        expectedRevision: 1,
        rows: [
          {
            operation: 'create',
            rowId: 'a0040000-0000-4000-8000-000000000016',
            values: { [dataset.fieldId]: 15 },
          },
        ],
      },
      'auto04-missing-data-scope',
    )
    expect(limitedProposal).toMatchObject({
      status: 'pending',
      approval_policy: 'human_required',
    })
    expect(limitedProposal.policy_reason).toContain('datasets:write')
    expect(limitedProposal.policy_evidence).toMatchObject({
      requiredScope: 'datasets:write',
      scopeSatisfied: false,
    })

    await expectDenied(
      noAgent.query(
        `SELECT api.propose_agent_operation(
          $1,'No agent scope','No agent scope',$2::jsonb,
          '{"agentId":"scope-test","tool":{"name":"scope"},"model":{"provider":"test","name":"scope"},"invocationId":"scope-no-agent"}'::jsonb,'auto04-no-agent'
        )`,
        [
          WS,
          JSON.stringify({
            kind: 'dataset_rows.commit',
            datasetId: dataset.id,
            expectedRevision: 1,
            rows: [
              {
                operation: 'create',
                rowId: 'a0040000-0000-4000-8000-000000000017',
                values: { [dataset.fieldId]: 16 },
              },
            ],
          }),
        ],
      ),
      '42501',
    )

    const hidden = await outsider.query(
      `SELECT * FROM api.agent_operation_policies WHERE id=$1`,
      [policy.id],
    )
    expect(hidden.rowCount).toBe(0)
    await expectDenied(
      outsider.query(
        `SELECT api.create_agent_operation_policy(
          $1,'cross workspace','dataset_rows.commit','dataset',$2,$3,'{"maxAffectedRows":1}'::jsonb
        )`,
        [WS, dataset.id, CREDENTIAL],
      ),
      '42501',
    )

    const disabled = await steward.query(
      `SELECT * FROM api.disable_agent_operation_policy($1,$2)`,
      [WS, policy.id],
    )
    expect(disabled.rows[0].enabled).toBe(false)
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

  it('excludes publish, submit, sign, amend, lock, and attestation variants', async () => {
    const agent = await credential(WS)
    await expectDenied(
      propose(
        agent,
        {
          kind: 'publish',
          targetType: 'dataset',
          targetId: 'a0040000-0000-4000-8000-000000000099',
        },
        'auto04-attestation-excluded',
      ),
      '22023',
    )
  })
})
