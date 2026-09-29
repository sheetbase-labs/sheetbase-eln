/**
 * AUTO-PLUS-03 database evaluation suite.
 *
 * Repeatable semantic/security evals for agentic scientific work, run
 * against local PostgreSQL (`pnpm test:db agent-evaluations`):
 *
 * - correctness: a representative multi-step workflow produces the
 *   expected canonical effects, with the full run → step → proposal →
 *   version-pin chain readable as one inspectable join;
 * - permission isolation: the agent actor cannot exceed its credential
 *   scope — every human-only or cross-principal path fails closed at
 *   the database layer (42501), never in UI code;
 * - failure behaviour: rejected, failed-exhaustion, and cancelled runs
 *   stay inspectable (statuses, actors, reasons, event timelines).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0030000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0030000-0000-4000-8000-000000000002'
const OWNER = 'auto03-owner'
const VIEWER = 'auto03-viewer'
const OUTSIDER = 'auto03-outsider'
const CREDENTIAL = 'a0030000-0000-4000-8000-000000000003'
const OTHER_CREDENTIAL = 'a0030000-0000-4000-8000-000000000004'
const READ_CREDENTIAL = 'a0030000-0000-4000-8000-000000000005'
const DATA_CREDENTIAL = 'a0030000-0000-4000-8000-000000000006'

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
  workspaceId: string,
  credentialId: string,
  scopes: string[],
): Promise<Client> {
  const key = `credential:${workspaceId}:${credentialId}:${scopes.join(',')}`
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

const agent = () =>
  credential(WS, CREDENTIAL, [
    'agent_operations:read',
    'agent_operations:write',
  ])
const dataAgent = () =>
  credential(WS, DATA_CREDENTIAL, [
    'agent_operations:read',
    'agent_operations:write',
    'datasets:write',
    'schema:write',
  ])

const provenance = {
  agentId: 'eval-harness',
  agentName: 'AUTO-PLUS-03 eval harness',
  tool: { name: 'sheetbase.workflow', version: '1' },
  model: { provider: 'test', name: 'sheetbase-assist-1' },
  invocationId: 'auto03-eval-invocation',
}

/** Schema + dataset + immutable version pin for workflow input refs. */
async function pinnedDataset(owner: Client, suffix: string) {
  const schema = await owner.query<{
    result: { schema_version_id: string }
  }>(
    `SELECT api.create_dataset_schema_definition(
      $1,$2,$3,NULL,
      '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb
    ) result`,
    [WS, `auto03_${suffix}_schema`, `AUTO03 ${suffix}`],
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
     VALUES($1,$2,$3,$4) RETURNING id`,
    [WS, schemaVersionId, `AUTO03 ${suffix} target`, OWNER],
  )
  const version = await owner.query<{ id: string }>(
    `SELECT id FROM api.snapshot_dataset($1,1,'AUTO03 immutable input')`,
    [dataset.rows[0].id],
  )
  return {
    datasetId: dataset.rows[0].id,
    fieldId: field.rows[0].field_id,
    versionId: version.rows[0].id,
  }
}

async function createWorkflow(
  client: Client,
  key: string,
  plan: unknown,
  budget = {
    maxOperations: 4,
    maxTokens: 10_000,
    maxCostMicrousd: 500_000,
  },
) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_agent_workflow(
      $1::uuid,$2::text,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::text
    )`,
    [
      WS,
      'Prepare governed scientific operations in sequence.',
      JSON.stringify(plan),
      JSON.stringify(budget),
      JSON.stringify({ tokens: 100, costMicrousd: 5_000 }),
      JSON.stringify(provenance),
      key,
    ],
  )
  return rows[0] as {
    id: string
    status: string
    revision: string
    plan_digest: string
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified") VALUES
      ($1,'AUTO03 Owner','auto03-owner@sheetbase.test',true),
      ($2,'AUTO03 Viewer','auto03-viewer@sheetbase.test',true),
      ($3,'AUTO03 Outsider','auto03-outsider@sheetbase.test',true)`,
    [OWNER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'auto03','AUTO03'),($2,'auto03-other','AUTO03 Other')`,
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
    ) VALUES
      ($1,$2,'AUTO03 agent','sb_auto03','auto03-hash',
        ARRAY['agent_operations:read','agent_operations:write'],$3),
      ($4,$2,'AUTO03 other agent','sb_auto03_other','auto03-other-hash',
        ARRAY['agent_operations:read','agent_operations:write'],$3),
      ($5,$2,'AUTO03 reader','sb_auto03_read','auto03-read-hash',
        ARRAY['agent_operations:read'],$3),
      ($6,$2,'AUTO03 data agent','sb_auto03_data','auto03-data-hash',
        ARRAY['agent_operations:read','agent_operations:write','datasets:write','schema:write'],$3)`,
    [CREDENTIAL, WS, OWNER, OTHER_CREDENTIAL, READ_CREDENTIAL, DATA_CREDENTIAL],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('AUTO-PLUS-03 eval: correctness', () => {
  it('a representative two-step run produces canonical effects with a joinable provenance chain', async () => {
    const owner = await actor(OWNER, WS)
    const agentClient = await dataAgent()
    const pinned = await pinnedDataset(owner, 'correctness')
    const rowId = 'a0030000-0000-4000-8000-000000000021'
    const plan = {
      formatVersion: 1,
      steps: [
        {
          key: 'draft_pipe',
          title: 'Draft governed Pipeline',
          summary: 'Create one Pipeline Definition for human review.',
          tool: 'sheetbase.pipeline_definition.draft',
          operation: {
            kind: 'pipeline_definition.create',
            workspaceId: WS,
            key: 'auto03_eval_pipe',
            name: 'AUTO03 eval pipe',
            description: 'AUTO-PLUS-03 correctness fixture.',
          },
          inputReferences: [{ kind: 'dataset_version', id: pinned.versionId }],
        },
        {
          key: 'commit_value',
          title: 'Commit reviewed value',
          summary: 'Commit one reviewed Dataset row.',
          tool: 'sheetbase.dataset_rows.commit',
          operation: {
            kind: 'dataset_rows.commit',
            datasetId: pinned.datasetId,
            expectedRevision: 1,
            rows: [
              {
                operation: 'create',
                rowId,
                values: { [pinned.fieldId]: 42 },
              },
            ],
          },
          inputReferences: [{ kind: 'dataset_version', id: pinned.versionId }],
        },
      ],
    }
    const created = await createWorkflow(agentClient, 'correctness', plan)
    // Safe draft auto-succeeds; the Dataset write waits for a human.
    expect(created.status).toBe('waiting_approval')

    // Canonical effect 1: the draft Pipeline Definition exists.
    const definitions = await migrator.query<{ id: string; key: string }>(
      `SELECT id,key FROM api.pipeline_definitions
        WHERE workspace_id=$1 AND key='auto03_eval_pipe'`,
      [WS],
    )
    expect(definitions.rows).toHaveLength(1)

    // Human approves + executes the consequential write, then advances.
    const pending = await owner.query<{ id: string; revision: string }>(
      `SELECT p.id,p.revision FROM api.agent_workflow_steps s
         JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
        WHERE s.workflow_id=$1 AND s.position=(
          SELECT current_step FROM api.agent_workflows WHERE id=$1
        )`,
      [created.id],
    )
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
      [pending.rows[0].id],
    )
    await owner.query(`SELECT api.execute_agent_operation($1,2)`, [
      pending.rows[0].id,
    ])
    const current = await agentClient.query<{ revision: string }>(
      `SELECT revision FROM api.agent_workflows WHERE id=$1`,
      [created.id],
    )
    const finished = await agentClient.query<{ status: string }>(
      `SELECT status FROM api.advance_agent_workflow($1,$2)`,
      [created.id, current.rows[0].revision],
    )
    expect(finished.rows[0].status).toBe('succeeded')
    const values = await migrator.query<{ integer_value: string }>(
      `SELECT integer_value FROM api.dataset_row_values
        WHERE row_id=$1 AND field_id=$2`,
      [rowId, pinned.fieldId],
    )
    expect(values.rows).toHaveLength(1)
    expect(Number(values.rows[0].integer_value)).toBe(42)

    // One inspectable join: run → steps → proposals → version pins,
    // with actor and policy decisions on every row.
    const chain = await owner.query<{
      position: number
      step_status: string
      attempt: number
      proposal_status: string
      approval_policy: string
      input_references: Array<{ kind: string; id: string }>
      proposed_by_credential_id: string | null
      executed_by_user_id: string | null
      invocation: string
    }>(
      `SELECT s.position,s.status AS step_status,s.attempt,
              p.status AS proposal_status,p.approval_policy,
              s.input_references,
              p.proposed_by_credential_id,p.executed_by_user_id,
              p.provenance->>'invocationId' AS invocation
         FROM api.agent_workflows w
         JOIN api.agent_workflow_steps s ON s.workflow_id=w.id
         JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
        WHERE w.id=$1
        ORDER BY s.position`,
      [created.id],
    )
    expect(chain.rows).toHaveLength(2)
    expect(chain.rows[0]).toMatchObject({
      position: 0,
      step_status: 'succeeded',
      attempt: 1,
      proposal_status: 'succeeded',
      approval_policy: 'automatic',
      proposed_by_credential_id: DATA_CREDENTIAL,
      invocation: 'auto03-eval-invocation',
    })
    expect(chain.rows[1]).toMatchObject({
      position: 1,
      step_status: 'succeeded',
      proposal_status: 'succeeded',
      approval_policy: 'human_required',
      executed_by_user_id: OWNER,
    })
    for (const row of chain.rows) {
      expect(row.input_references).toEqual([
        { kind: 'dataset_version', id: pinned.versionId },
      ])
    }
    // Output reference honesty: the draft step result pins the created
    // definition id — the same id a client projection would surface.
    const result = await owner.query<{ result: { id: string } }>(
      `SELECT result FROM api.agent_operation_proposals p
         JOIN api.agent_workflow_steps s ON s.proposal_id=p.id
        WHERE s.workflow_id=$1 AND s.position=0`,
      [created.id],
    )
    expect(result.rows[0].result.id).toBe(definitions.rows[0].id)
  })
})

describe('AUTO-PLUS-03 eval: permission isolation', () => {
  it('holds the agent actor inside its credential scope', async () => {
    const owner = await actor(OWNER, WS)
    const agentClient = await agent()
    const pinned = await pinnedDataset(owner, 'isolation')
    const plan = {
      formatVersion: 1,
      steps: [1, 2].map((number) => ({
        key: `isolated_${number}`,
        title: `Isolated draft ${number}`,
        summary: 'Safe draft for isolation proof.',
        tool: 'sheetbase.pipeline_definition.draft',
        operation: {
          kind: 'pipeline_definition.create',
          workspaceId: WS,
          key: `auto03_isolated_${number}`,
          name: `AUTO03 isolated ${number}`,
        },
        inputReferences: [],
      })),
    }

    // Read-only credential cannot create a workflow.
    const reader = await credential(WS, READ_CREDENTIAL, [
      'agent_operations:read',
    ])
    await expectDenied(
      createWorkflow(reader, 'isolation_reader', plan),
      '42501',
    )

    // Non-writer workspace member cannot create a workflow.
    const viewer = await actor(VIEWER, WS)
    await expectDenied(
      createWorkflow(viewer, 'isolation_viewer', plan),
      '42501',
    )

    // Cross-workspace actor cannot create in this workspace.
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expectDenied(
      createWorkflow(outsider, 'isolation_outsider', plan),
      '42501',
    )

    // The agent cannot approve, execute, or resume — human session only.
    const created = await createWorkflow(agentClient, 'isolation', plan)
    const proposalRow = await owner.query<{ id: string }>(
      `SELECT proposal_id AS id FROM api.agent_workflow_steps
        WHERE workflow_id=$1 AND position=0`,
      [created.id],
    )
    const proposalId = proposalRow.rows[0].id
    await expectDenied(
      agentClient.query(
        `SELECT api.decide_agent_operation($1,1,'approve',NULL)`,
        [proposalId],
      ),
      '42501',
    )
    await expectDenied(
      agentClient.query(`SELECT api.execute_agent_operation($1,1)`, [
        proposalId,
      ]),
      '42501',
    )
    await expectDenied(
      agentClient.query(`SELECT api.resume_agent_workflow($1,2)`, [created.id]),
      '42501',
    )

    // A different credential cannot advance or report usage on this run.
    const other = await credential(WS, OTHER_CREDENTIAL, [
      'agent_operations:read',
      'agent_operations:write',
    ])
    await expectDenied(
      other.query(`SELECT api.advance_agent_workflow($1,2)`, [created.id]),
      '42501',
    )
    await expectDenied(
      other.query(`SELECT api.report_agent_workflow_usage($1,2,10,100)`, [
        created.id,
      ]),
      '42501',
    )

    // RLS: the outsider workspace sees none of this workspace's runs.
    const hidden = await outsider.query(
      `SELECT id FROM api.agent_workflows WHERE id=$1`,
      [created.id],
    )
    expect(hidden.rows).toHaveLength(0)
    void pinned
  })
})

describe('AUTO-PLUS-03 eval: failure behaviour', () => {
  it('rejection pauses the run and stays inspectable, then resumes the same pinned operation', async () => {
    const owner = await actor(OWNER, WS)
    const agentClient = await dataAgent()
    const pinned = await pinnedDataset(owner, 'failure')
    const plan = {
      formatVersion: 1,
      steps: [1, 2].map((number) => ({
        key: `reviewed_${number}`,
        title: `Reviewed write ${number}`,
        summary: 'Human-gated Dataset write for failure proof.',
        tool: 'sheetbase.dataset_rows.commit',
        operation: {
          kind: 'dataset_rows.commit',
          datasetId: pinned.datasetId,
          expectedRevision: 1,
          rows: [
            {
              operation: 'create',
              rowId: `a0030000-0000-4000-8000-0000000000${30 + number}`,
              values: { [pinned.fieldId]: number },
            },
          ],
        },
        inputReferences: [],
      })),
    }
    const created = await createWorkflow(agentClient, 'failure', plan)
    const current = await owner.query<{
      id: string
      operation: unknown
    }>(
      `SELECT p.id,p.operation FROM api.agent_workflow_steps s
         JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
        WHERE s.workflow_id=$1 AND s.position=(
          SELECT current_step FROM api.agent_workflows WHERE id=$1
        )`,
      [created.id],
    )
    await owner.query(
      `SELECT api.decide_agent_operation($1,1,'reject','Value needs re-check.')`,
      [current.rows[0].id],
    )
    const paused = await agentClient.query<{
      status: string
      revision: string
    }>(`SELECT status,revision FROM api.advance_agent_workflow($1,2)`, [
      created.id,
    ])
    expect(paused.rows[0].status).toBe('paused')

    // Inspectable paused state: step + proposal + reason + timeline.
    const state = await owner.query<{
      step_status: string
      attempt: number
      proposal_status: string
      rejection_reason: string | null
      rejected_by: string | null
    }>(
      `SELECT s.status AS step_status,s.attempt,p.status AS proposal_status,
              p.rejection_reason,p.rejected_by_user_id AS rejected_by
         FROM api.agent_workflow_steps s
         JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
        WHERE s.workflow_id=$1 AND s.position=0`,
      [created.id],
    )
    expect(state.rows[0]).toMatchObject({
      step_status: 'rejected',
      attempt: 1,
      proposal_status: 'rejected',
      rejection_reason: 'Value needs re-check.',
      rejected_by: OWNER,
    })
    const events = await owner.query<{ event_type: string }>(
      `SELECT event_type FROM api.agent_workflow_events
        WHERE workflow_id=$1 ORDER BY sequence`,
      [created.id],
    )
    expect(events.rows.map((event) => event.event_type)).toContain('paused')

    // Resume retries the same pinned operation as a new attempt.
    const resumed = await owner.query<{
      revision: string
      status: string
    }>(`SELECT revision,status FROM api.resume_agent_workflow($1,3)`, [
      created.id,
    ])
    expect(resumed.rows[0].status).toBe('waiting_approval')
    const retried = await owner.query<{
      attempt: number
      proposal_id: string
      operation: unknown
    }>(
      `SELECT attempt,proposal_id,operation FROM api.agent_workflow_steps
        WHERE workflow_id=$1 AND position=0`,
      [created.id],
    )
    expect(retried.rows[0].attempt).toBe(2)
    expect(retried.rows[0].proposal_id).not.toBe(current.rows[0].id)
    const retriedProposal = await owner.query<{ operation: unknown }>(
      `SELECT operation FROM api.agent_operation_proposals WHERE id=$1`,
      [retried.rows[0].proposal_id],
    )
    expect(retriedProposal.rows[0].operation).toEqual(current.rows[0].operation)
  })

  it('budget exhaustion terminates the run but preserves the audit trail', async () => {
    const owner = await actor(OWNER, WS)
    const agentClient = await agent()
    const plan = {
      formatVersion: 1,
      steps: [1, 2].map((number) => ({
        key: `budgeted_${number}`,
        title: `Budgeted draft ${number}`,
        summary: 'Safe draft for budget proof.',
        tool: 'sheetbase.pipeline_definition.draft',
        operation: {
          kind: 'pipeline_definition.create',
          workspaceId: WS,
          key: `auto03_budget_${number}`,
          name: `AUTO03 budget ${number}`,
        },
        inputReferences: [],
      })),
    }
    const created = await createWorkflow(
      agentClient,
      'budget',
      { ...plan },
      { maxOperations: 4, maxTokens: 200, maxCostMicrousd: 500_000 },
    )
    // Push token usage past the budget: the pending proposal is
    // cancelled with budget_exhausted and the run terminates.
    const exhausted = await agentClient.query<{ status: string }>(
      `SELECT status FROM api.report_agent_workflow_usage($1,2,150,1000)`,
      [created.id],
    )
    expect(exhausted.rows[0].status).toBe('budget_exhausted')

    const proposalState = await owner.query<{
      proposal_status: string
      error_code: string | null
    }>(
      `SELECT p.status AS proposal_status,p.error_code
         FROM api.agent_workflow_steps s
         JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
        WHERE s.workflow_id=$1 AND s.position=0`,
      [created.id],
    )
    expect(proposalState.rows[0]).toMatchObject({
      proposal_status: 'cancelled',
      error_code: 'budget_exhausted',
    })
    const events = await owner.query<{ event_type: string }>(
      `SELECT event_type FROM api.agent_workflow_events
        WHERE workflow_id=$1 ORDER BY sequence`,
      [created.id],
    )
    expect(events.rows.map((event) => event.event_type)).toContain(
      'budget_exhausted',
    )
    // Terminal runs reject further control but stay readable.
    await expectDenied(
      agentClient.query(`SELECT api.advance_agent_workflow($1,3)`, [
        created.id,
      ]),
      'SB001',
    )
    const readable = await owner.query(
      `SELECT w.status,s.position,p.status AS proposal_status
         FROM api.agent_workflows w
         JOIN api.agent_workflow_steps s ON s.workflow_id=w.id
         JOIN api.agent_operation_proposals p ON p.id=s.proposal_id
        WHERE w.id=$1 ORDER BY s.position`,
      [created.id],
    )
    expect(readable.rows.length).toBeGreaterThan(0)
  })

  it('cancellation keeps completed work and records the reason', async () => {
    const owner = await actor(OWNER, WS)
    const agentClient = await dataAgent()
    const pinned = await pinnedDataset(owner, 'cancel')
    const plan = {
      formatVersion: 1,
      steps: [
        {
          key: 'cancel_draft',
          title: 'Draft for cancel proof',
          summary: 'Auto-succeeding safe draft.',
          tool: 'sheetbase.pipeline_definition.draft',
          operation: {
            kind: 'pipeline_definition.create',
            workspaceId: WS,
            key: 'auto03_cancel_pipe',
            name: 'AUTO03 cancel pipe',
          },
          inputReferences: [],
        },
        {
          key: 'cancel_write',
          title: 'Write for cancel proof',
          summary: 'Human-gated write cancelled before approval.',
          tool: 'sheetbase.dataset_rows.commit',
          operation: {
            kind: 'dataset_rows.commit',
            datasetId: pinned.datasetId,
            expectedRevision: 1,
            rows: [
              {
                operation: 'create',
                rowId: 'a0030000-0000-4000-8000-000000000039',
                values: { [pinned.fieldId]: 9 },
              },
            ],
          },
          inputReferences: [],
        },
      ],
    }
    const created = await createWorkflow(agentClient, 'cancel', plan)
    const live = await owner.query<{ revision: string }>(
      `SELECT revision FROM api.agent_workflows WHERE id=$1`,
      [created.id],
    )
    const cancelled = await owner.query<{
      status: string
      cancellation_reason: string
    }>(
      `SELECT status,cancellation_reason
         FROM api.cancel_agent_workflow($1,$2,'Reviewed source withdrawn.')`,
      [created.id, live.rows[0].revision],
    )
    expect(cancelled.rows[0]).toMatchObject({
      status: 'cancelled',
      cancellation_reason: 'Reviewed source withdrawn.',
    })
    const steps = await owner.query<{ position: number; status: string }>(
      `SELECT position,status FROM api.agent_workflow_steps
        WHERE workflow_id=$1 ORDER BY position`,
      [created.id],
    )
    expect(steps.rows).toEqual([
      { position: 0, status: 'succeeded' },
      { position: 1, status: 'cancelled' },
    ])
    const definitions = await migrator.query(
      `SELECT id FROM api.pipeline_definitions
        WHERE workspace_id=$1 AND key='auto03_cancel_pipe'`,
      [WS],
    )
    expect(definitions.rows).toHaveLength(1)
  })
})
