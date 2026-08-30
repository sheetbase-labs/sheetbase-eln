/**
 * AUTO-05 database proof.
 *
 * Workflows pin a bounded sequential plan, expose usage, and emit one AUTO-04
 * proposal at a time. AUTO-04 policy can auto-complete a step; human-required
 * operations still pause until a human session approves and executes them.
 * exhaustion invalidate proposals that have not executed.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0050000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0050000-0000-4000-8000-000000000002'
const OWNER = 'auto05-owner'
const VIEWER = 'auto05-viewer'
const OUTSIDER = 'auto05-outsider'
const CREDENTIAL = 'a0050000-0000-4000-8000-000000000003'
const OTHER_CREDENTIAL = 'a0050000-0000-4000-8000-000000000004'
const DRAFT_CREDENTIAL = 'a0050000-0000-4000-8000-000000000005'
const DATA_CREDENTIAL = 'a0050000-0000-4000-8000-000000000006'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
const actorClients = new Map<string, Client>()

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const key = `user:${workspaceId}:${userId}`
  const existing = actorClients.get(key)
  if (existing) return existing
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId)
  actorClients.set(key, client)
  return client
}

async function credential(
  workspaceId = WS,
  credentialId = CREDENTIAL,
  scopes = ['agent_operations:read', 'agent_operations:write'],
): Promise<Client> {
  const key = `credential:${workspaceId}:${credentialId}`
  const existing = actorClients.get(key)
  if (existing) return existing
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
  await setActorJwt(client, '', workspaceId, {
    role: 'api_client',
    sub: null,
    credential_id: credentialId,
    scopes,
  })
  actorClients.set(key, client)
  return client
}

const provenance = {
  agentId: 'assay-workflow-helper',
  agentName: 'Assay workflow helper',
  tool: { name: 'sheetbase.workflow', version: '1' },
  model: { provider: 'openai', name: 'gpt-5.6', version: '2026-08' },
  invocationId: 'auto05-invocation',
}

function pipelinePlan(suffix: string) {
  return {
    formatVersion: 1,
    steps: [1, 2].map((number) => ({
      key: `draft_${number}`,
      title: `Draft reviewed Pipeline ${number}`,
      summary: 'Create one governed Pipeline Definition for human review.',
      tool: 'sheetbase.pipeline_definition.draft',
      operation: {
        kind: 'pipeline_definition.create',
        workspaceId: WS,
        key: `auto05_${suffix}_${number}`,
        name: `AUTO05 ${suffix} ${number}`,
        description: 'Pinned AUTO-05 recovery fixture.',
      },
      inputReferences: [],
    })),
  }
}

async function createWorkflow(
  client: Client,
  input: {
    key: string
    plan?: ReturnType<typeof pipelinePlan>
    maxOperations?: number
    maxTokens?: number
    maxCostMicrousd?: number
    initialTokens?: number
  },
) {
  const plan = input.plan ?? pipelinePlan(input.key)
  const { rows } = await client.query(
    `SELECT * FROM api.create_agent_workflow(
      $1::uuid,$2::text,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::text
    )`,
    [
      WS,
      'Prepare two governed scientific data operations in sequence.',
      JSON.stringify(plan),
      JSON.stringify({
        maxOperations: input.maxOperations ?? 4,
        maxTokens: input.maxTokens ?? 10_000,
        maxCostMicrousd: input.maxCostMicrousd ?? 500_000,
      }),
      JSON.stringify({
        tokens: input.initialTokens ?? 500,
        costMicrousd: 20_000,
      }),
      JSON.stringify(provenance),
      input.key,
    ],
  )
  return rows[0] as {
    id: string
    status: string
    revision: string
    plan_digest: string
    used_operations: number
    used_tokens: string
  }
}

async function currentProposal(client: Client, workflowId: string) {
  const { rows } = await client.query(
    `SELECT p.id,p.status,p.revision,p.provenance,s.attempt
       FROM api.agent_workflow_steps s
       JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
      WHERE s.workflow_id=$1
        AND s.position=(
          SELECT current_step FROM api.agent_workflows WHERE id=$1
        )`,
    [workflowId],
  )
  return rows[0] as {
    id: string
    status: string
    revision: string
    provenance: typeof provenance
    attempt: number
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified") VALUES
      ($1,'AUTO05 Owner','auto05-owner@sheetbase.test',true),
      ($2,'AUTO05 Viewer','auto05-viewer@sheetbase.test',true),
      ($3,'AUTO05 Outsider','auto05-outsider@sheetbase.test',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'auto05','AUTO05'),($2,'auto05-other','AUTO05 Other')`,
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
    ) VALUES (
      $1,$2,'AUTO05 agent','sb_auto05','auto05-hash',
      ARRAY['agent_operations:read','agent_operations:write'],$3
    ),(
      $4,$2,'AUTO05 other agent','sb_auto05_other','auto05-other-hash',
      ARRAY['agent_operations:read','agent_operations:write'],$3
    ),(
      $5,$2,'AUTO05 draft agent','sb_auto05_draft','auto05-draft-hash',
      ARRAY['agent_operations:read','agent_operations:write','schema:write'],$3
    ),(
      $6,$2,'AUTO05 data agent','sb_auto05_data','auto05-data-hash',
      ARRAY['agent_operations:read','agent_operations:write','datasets:write'],$3
    )`,
    [
      CREDENTIAL,
      WS,
      OWNER,
      OTHER_CREDENTIAL,
      DRAFT_CREDENTIAL,
      DATA_CREDENTIAL,
    ],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('AUTO-05 agentic scientific workflows', () => {
  it('advances a pinned plan only after each AUTO-04 proposal succeeds', async () => {
    const agent = await credential()
    const owner = await actor(OWNER, WS)
    const schema = await owner.query<{
      result: { schema_version_id: string }
    }>(
      `SELECT api.create_dataset_schema_definition(
        $1,'auto05_evidence','AUTO05 evidence',NULL,
        '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
      ) result`,
      [WS],
    )
    await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schema.rows[0].result.schema_version_id,
    ])
    const dataset = await owner.query<{ id: string }>(
      `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       VALUES($1,$2,'AUTO05 pinned input',$3) RETURNING id`,
      [WS, schema.rows[0].result.schema_version_id, OWNER],
    )
    const version = await owner.query<{ id: string }>(
      `SELECT id FROM api.snapshot_dataset($1,1,'AUTO05 immutable input')`,
      [dataset.rows[0].id],
    )
    const plan = pipelinePlan('sequential')
    plan.steps = plan.steps.map((step) => ({
      ...step,
      inputReferences: [{ kind: 'dataset_version', id: version.rows[0].id }],
    }))
    const created = await createWorkflow(agent, {
      key: 'sequential',
      plan,
    })
    expect(created).toMatchObject({
      status: 'waiting_approval',
      revision: '2',
      used_operations: 1,
    })
    expect(created.plan_digest).toMatch(/^[0-9a-f]{64}$/)

    const first = await currentProposal(owner, created.id)
    expect(first).toMatchObject({
      status: 'pending',
      attempt: 1,
      provenance,
    })
    const pinned = await owner.query<{ input_references: unknown }>(
      `SELECT input_references FROM api.agent_workflow_steps
        WHERE workflow_id=$1 ORDER BY position`,
      [created.id],
    )
    expect(pinned.rows).toEqual([
      {
        input_references: [{ kind: 'dataset_version', id: version.rows[0].id }],
      },
      {
        input_references: [{ kind: 'dataset_version', id: version.rows[0].id }],
      },
    ])
    await expectDenied(
      agent.query(`SELECT api.decide_agent_operation($1,1,'approve',NULL)`, [
        first.id,
      ]),
      '42501',
    )
    const unchanged = await agent.query<{ revision: string; status: string }>(
      `SELECT revision,status FROM api.advance_agent_workflow($1,2)`,
      [created.id],
    )
    expect(unchanged.rows[0]).toEqual({
      revision: '2',
      status: 'waiting_approval',
    })

    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
      [first.id],
    )
    await owner.query(`SELECT api.execute_agent_operation($1,2)`, [first.id])
    const advanced = await agent.query<{
      revision: string
      status: string
      current_step: number
      used_operations: number
    }>(
      `SELECT revision,status,current_step,used_operations
         FROM api.advance_agent_workflow($1,2)`,
      [created.id],
    )
    expect(advanced.rows[0]).toEqual({
      revision: '4',
      status: 'waiting_approval',
      current_step: 1,
      used_operations: 2,
    })

    const second = await currentProposal(owner, created.id)
    expect(second.id).not.toBe(first.id)
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
      [second.id],
    )
    await owner.query(`SELECT api.execute_agent_operation($1,2)`, [second.id])
    const completed = await agent.query<{
      revision: string
      status: string
      completed_at: Date
    }>(
      `SELECT revision,status,completed_at
         FROM api.advance_agent_workflow($1,4)`,
      [created.id],
    )
    expect(completed.rows[0].status).toBe('succeeded')
    expect(completed.rows[0].revision).toBe('6')
    expect(completed.rows[0].completed_at).toBeInstanceOf(Date)

    const evidence = await owner.query<{
      event_type: string
      detail: Record<string, unknown>
    }>(
      `SELECT event_type,detail FROM api.agent_workflow_events
        WHERE workflow_id=$1 ORDER BY sequence`,
      [created.id],
    )
    expect(evidence.rows.map((event) => event.event_type)).toEqual([
      'created',
      'step_proposed',
      'step_succeeded',
      'step_proposed',
      'step_succeeded',
      'succeeded',
    ])
    expect(evidence.rows[0].detail).toMatchObject({
      planDigest: created.plan_digest,
      initialUsage: { tokens: 500, costMicrousd: 20_000 },
    })
    const replay = await createWorkflow(agent, {
      key: 'sequential',
      plan,
    })
    expect(replay).toMatchObject({
      id: created.id,
      status: 'succeeded',
      plan_digest: created.plan_digest,
    })
  })

  it('auto-advances safe drafts when the credential has schema:write', async () => {
    const agent = await credential(WS, DRAFT_CREDENTIAL, [
      'agent_operations:read',
      'agent_operations:write',
      'schema:write',
    ])
    const owner = await actor(OWNER, WS)
    const created = await createWorkflow(agent, { key: 'auto_drafts' })
    expect(created).toMatchObject({
      status: 'succeeded',
      used_operations: 2,
    })
    const steps = await owner.query<{
      status: string
      proposal_status: string
      approval_policy: string
    }>(
      `SELECT s.status, p.status AS proposal_status, p.approval_policy
         FROM api.agent_workflow_steps s
         JOIN api.agent_operation_proposals p ON p.id = s.proposal_id
        WHERE s.workflow_id=$1
        ORDER BY s.position`,
      [created.id],
    )
    expect(steps.rows).toEqual([
      {
        status: 'succeeded',
        proposal_status: 'succeeded',
        approval_policy: 'automatic',
      },
      {
        status: 'succeeded',
        proposal_status: 'succeeded',
        approval_policy: 'automatic',
      },
    ])
  })

  it('pauses a mixed plan on a human-required Dataset write', async () => {
    const agent = await credential(WS, DATA_CREDENTIAL, [
      'agent_operations:read',
      'agent_operations:write',
      'datasets:write',
      'schema:write',
    ])
    const owner = await actor(OWNER, WS)
    await migrator.query(
      `UPDATE internal.api_credentials
          SET scopes = ARRAY[
            'agent_operations:read','agent_operations:write',
            'datasets:write','schema:write'
          ]
        WHERE id=$1`,
      [DATA_CREDENTIAL],
    )
    const schema = await owner.query<{
      result: { schema_version_id: string }
    }>(
      `SELECT api.create_dataset_schema_definition(
        $1,'auto05_mixed','AUTO05 mixed',NULL,
        '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
      ) result`,
      [WS],
    )
    await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schema.rows[0].result.schema_version_id,
    ])
    const field = await migrator.query<{ field_id: string }>(
      `SELECT field_id FROM api.dataset_schema_version_fields
        WHERE schema_version_id=$1`,
      [schema.rows[0].result.schema_version_id],
    )
    const dataset = await owner.query<{ id: string }>(
      `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       VALUES($1,$2,'AUTO05 mixed target',$3) RETURNING id`,
      [WS, schema.rows[0].result.schema_version_id, OWNER],
    )
    const plan = {
      formatVersion: 1,
      steps: [
        {
          key: 'draft_pipeline',
          title: 'Draft Pipeline',
          summary: 'Create one governed Pipeline Definition.',
          tool: 'sheetbase.pipeline_definition.draft',
          operation: {
            kind: 'pipeline_definition.create',
            workspaceId: WS,
            key: 'auto05_mixed_pipe',
            name: 'AUTO05 mixed pipe',
          },
          inputReferences: [],
        },
        {
          key: 'append_row',
          title: 'Append Dataset row',
          summary: 'Create one Dataset row through the canonical commit RPC.',
          tool: 'sheetbase.dataset_rows.commit',
          operation: {
            kind: 'dataset_rows.commit',
            datasetId: dataset.rows[0].id,
            expectedRevision: 1,
            rows: [
              {
                operation: 'create',
                rowId: 'a0050000-0000-4000-8000-000000000020',
                values: { [field.rows[0].field_id]: 7 },
              },
            ],
          },
          inputReferences: [],
        },
      ],
    }
    const created = await createWorkflow(agent, {
      key: 'mixed_policy',
      plan,
    })
    expect(created.status).toBe('waiting_approval')
    expect(created.used_operations).toBe(2)
    const first = await owner.query<{ status: string }>(
      `SELECT status FROM api.agent_workflow_steps
        WHERE workflow_id=$1 AND position=0`,
      [created.id],
    )
    expect(first.rows[0].status).toBe('succeeded')
    const second = await currentProposal(owner, created.id)
    expect(second).toMatchObject({
      status: 'pending',
      attempt: 1,
    })
  })

  it('auto-completes delegated Dataset create steps for the bound credential', async () => {
    const agent = await credential(WS, DATA_CREDENTIAL, [
      'agent_operations:read',
      'agent_operations:write',
      'datasets:write',
    ])
    const owner = await actor(OWNER, WS)
    const schema = await owner.query<{
      result: { schema_version_id: string }
    }>(
      `SELECT api.create_dataset_schema_definition(
        $1,'auto05_delegated','AUTO05 delegated',NULL,
        '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
      ) result`,
      [WS],
    )
    await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schema.rows[0].result.schema_version_id,
    ])
    const field = await migrator.query<{ field_id: string }>(
      `SELECT field_id FROM api.dataset_schema_version_fields
        WHERE schema_version_id=$1`,
      [schema.rows[0].result.schema_version_id],
    )
    const dataset = await owner.query<{ id: string }>(
      `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       VALUES($1,$2,'AUTO05 delegated target',$3) RETURNING id`,
      [WS, schema.rows[0].result.schema_version_id, OWNER],
    )
    await owner.query(
      `SELECT api.create_agent_operation_policy(
        $1,'AUTO05 append','dataset_rows.commit','dataset',$2,$3,
        '{"maxAffectedRows":2}'::jsonb
      )`,
      [WS, dataset.rows[0].id, DATA_CREDENTIAL],
    )
    const plan = {
      formatVersion: 1,
      steps: [0, 1].map((index) => ({
        key: `append_${index + 1}`,
        title: `Append row ${index + 1}`,
        summary: 'Create one Dataset row through the canonical commit RPC.',
        tool: 'sheetbase.dataset_rows.commit',
        operation: {
          kind: 'dataset_rows.commit',
          datasetId: dataset.rows[0].id,
          expectedRevision: index + 1,
          rows: [
            {
              operation: 'create',
              rowId: `a0050000-0000-4000-8000-00000000003${index}`,
              values: { [field.rows[0].field_id]: index + 1 },
            },
          ],
        },
        inputReferences: [],
      })),
    }
    const created = await createWorkflow(agent, {
      key: 'delegated_appends',
      plan,
    })
    expect(created).toMatchObject({
      status: 'succeeded',
      used_operations: 2,
    })
  })

  it('revalidates future steps after prior Dataset writes change the revision', async () => {
    const agent = await credential()
    const owner = await actor(OWNER, WS)
    const schema = await owner.query<{
      result: { schema_version_id: string }
    }>(
      `SELECT api.create_dataset_schema_definition(
        $1,'auto05_sequential_data','AUTO05 sequential data',NULL,
        '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
      ) result`,
      [WS],
    )
    const schemaVersionId = schema.rows[0].result.schema_version_id
    await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schemaVersionId,
    ])
    const field = await migrator.query<{ field_id: string }>(
      `SELECT field_id FROM api.dataset_schema_version_fields
        WHERE schema_version_id=$1`,
      [schemaVersionId],
    )
    const dataset = await owner.query<{ id: string }>(
      `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       VALUES($1,$2,'AUTO05 sequential target',$3) RETURNING id`,
      [WS, schemaVersionId, OWNER],
    )
    const rowIds = [
      'a0050000-0000-4000-8000-000000000010',
      'a0050000-0000-4000-8000-000000000011',
    ]
    await owner.query(
      `SELECT api.commit_dataset_row_batch($1,1,$2::jsonb,'auto05-sequential-seed')`,
      [
        dataset.rows[0].id,
        JSON.stringify(
          rowIds.map((rowId, index) => ({
            operation: 'create',
            rowId,
            values: { [field.rows[0].field_id]: index + 1 },
          })),
        ),
      ],
    )
    const version = await owner.query<{ id: string }>(
      `SELECT id FROM api.snapshot_dataset($1,2,'AUTO05 sequential input')`,
      [dataset.rows[0].id],
    )
    const plan = {
      formatVersion: 1,
      steps: rowIds.map((rowId, index) => ({
        key: `correct_${index + 1}`,
        title: `Apply reviewed correction ${index + 1}`,
        summary: 'Apply one reviewed result through the canonical Dataset RPC.',
        tool: 'sheetbase.dataset_rows.commit',
        operation: {
          kind: 'dataset_rows.commit',
          datasetId: dataset.rows[0].id,
          expectedRevision: index + 2,
          rows: [
            {
              operation: 'update',
              rowId,
              expectedRevision: 1,
              values: { [field.rows[0].field_id]: (index + 1) * 10 },
            },
          ],
        },
        inputReferences: [{ kind: 'dataset_version', id: version.rows[0].id }],
      })),
    }
    const workflow = await createWorkflow(agent, {
      key: 'sequential_data',
      plan,
    })

    for (const expectedWorkflowRevision of [2, 4]) {
      const proposal = await currentProposal(owner, workflow.id)
      await owner.query(
        `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
        [proposal.id],
      )
      await owner.query(`SELECT api.execute_agent_operation($1,2)`, [
        proposal.id,
      ])
      await agent.query(`SELECT api.advance_agent_workflow($1,$2)`, [
        workflow.id,
        expectedWorkflowRevision,
      ])
    }

    const completed = await owner.query<{ status: string }>(
      `SELECT status FROM api.agent_workflows WHERE id=$1`,
      [workflow.id],
    )
    expect(completed.rows[0].status).toBe('succeeded')
    const values = await owner.query<{
      result: { rows: Array<{ values: Record<string, unknown> }> }
    }>(`SELECT api.query_dataset_rows($1,'{}'::jsonb,100,0) result`, [
      dataset.rows[0].id,
    ])
    expect(
      values.rows[0].result.rows
        .map((row) => Number(row.values[field.rows[0].field_id]))
        .sort((a, b) => a - b),
    ).toEqual([10, 20])
  })

  it('pauses rejected work, requires a human resume, and cancels the retried proposal', async () => {
    const agent = await credential()
    const owner = await actor(OWNER, WS)
    const created = await createWorkflow(agent, { key: 'recovery' })
    const first = await currentProposal(owner, created.id)
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'reject','Source not verified')`,
      [first.id],
    )
    const paused = await agent.query<{ status: string; revision: string }>(
      `SELECT status,revision FROM api.advance_agent_workflow($1,2)`,
      [created.id],
    )
    expect(paused.rows[0]).toEqual({ status: 'paused', revision: '3' })
    await expectDenied(
      agent.query(`SELECT api.resume_agent_workflow($1,3)`, [created.id]),
      '42501',
    )

    const resumed = await owner.query<{
      status: string
      revision: string
      used_operations: number
    }>(
      `SELECT status,revision,used_operations
         FROM api.resume_agent_workflow($1,3)`,
      [created.id],
    )
    expect(resumed.rows[0]).toEqual({
      status: 'waiting_approval',
      revision: '4',
      used_operations: 2,
    })
    const retry = await currentProposal(owner, created.id)
    expect(retry).toMatchObject({ status: 'pending', attempt: 2 })

    const cancelled = await agent.query<{
      status: string
      cancellation_reason: string
    }>(
      `SELECT status,cancellation_reason
         FROM api.cancel_agent_workflow($1,4,'Source review withdrawn')`,
      [created.id],
    )
    expect(cancelled.rows[0]).toEqual({
      status: 'cancelled',
      cancellation_reason: 'Source review withdrawn',
    })
    const cancelledProposal = await currentProposal(owner, created.id)
    expect(cancelledProposal.status).toBe('cancelled')
    await expect(
      owner.query(`SELECT api.decide_agent_operation($1,1,'approve',NULL)`, [
        retry.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('stops before mutation when operation, token, or cost budgets are exhausted', async () => {
    const agent = await credential()
    const owner = await actor(OWNER, WS)
    const operationLimited = await createWorkflow(agent, {
      key: 'operation_budget',
      maxOperations: 2,
    })
    let proposal = await currentProposal(owner, operationLimited.id)
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'reject','Retry fixture')`,
      [proposal.id],
    )
    await agent.query(`SELECT api.advance_agent_workflow($1,2)`, [
      operationLimited.id,
    ])
    await owner.query(`SELECT api.resume_agent_workflow($1,3)`, [
      operationLimited.id,
    ])
    proposal = await currentProposal(owner, operationLimited.id)
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'reject','Still not acceptable')`,
      [proposal.id],
    )
    await agent.query(`SELECT api.advance_agent_workflow($1,4)`, [
      operationLimited.id,
    ])
    const exhaustedOperations = await owner.query<{
      status: string
      used_operations: number
    }>(
      `SELECT status,used_operations
         FROM api.resume_agent_workflow($1,5)`,
      [operationLimited.id],
    )
    expect(exhaustedOperations.rows[0]).toEqual({
      status: 'budget_exhausted',
      used_operations: 2,
    })

    const usageLimited = await createWorkflow(agent, {
      key: 'usage_budget',
      maxTokens: 600,
      maxCostMicrousd: 25_000,
      initialTokens: 590,
    })
    const exhaustedUsage = await agent.query<{
      status: string
      revision: string
      used_tokens: string
      used_cost_microusd: string
    }>(
      `SELECT status,revision,used_tokens,used_cost_microusd
         FROM api.report_agent_workflow_usage($1,2,20,6000)`,
      [usageLimited.id],
    )
    expect(exhaustedUsage.rows[0]).toEqual({
      status: 'budget_exhausted',
      revision: '4',
      used_tokens: '610',
      used_cost_microusd: '26000',
    })
    expect((await currentProposal(owner, usageLimited.id)).status).toBe(
      'cancelled',
    )
  })

  it('enforces workspace isolation and rejects unbounded or attestation tools', async () => {
    const agent = await credential()
    const otherAgent = await credential(WS, OTHER_CREDENTIAL)
    const viewer = await actor(VIEWER, WS)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const created = await createWorkflow(agent, { key: 'isolation' })
    await expectDenied(
      viewer.query(
        `SELECT api.cancel_agent_workflow($1,2,'Viewer cannot cancel')`,
        [created.id],
      ),
      '42501',
    )
    await expectDenied(
      otherAgent.query(
        `SELECT api.cancel_agent_workflow($1,2,'Other agent cannot cancel')`,
        [created.id],
      ),
      '42501',
    )
    const hidden = await outsider.query(
      `SELECT id FROM api.agent_workflows WHERE id=$1`,
      [created.id],
    )
    expect(hidden.rowCount).toBe(0)
    await expectDenied(
      outsider.query(`SELECT api.advance_agent_workflow($1,2)`, [created.id]),
      '42501',
    )

    const invalidPlan = pipelinePlan('invalid')
    invalidPlan.steps[0] = {
      ...invalidPlan.steps[0],
      tool: 'sheetbase.notebook.sign',
      operation: {
        kind: 'notebook.sign',
        workspaceId: WS,
      },
    }
    await expect(
      createWorkflow(agent, {
        key: 'invalid_tool',
        plan: invalidPlan,
      }),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
