import type { DataClient } from './data-client'
import type { AgentOperation, AgentProvenance } from './agent-operations'

export const AGENT_WORKFLOW_TOOLS = [
  'sheetbase.dataset_schema.draft',
  'sheetbase.sheet_definition.draft',
  'sheetbase.sheet_definition.update_draft',
  'sheetbase.pipeline_definition.draft',
  'sheetbase.pipeline_definition.version_draft',
  'sheetbase.pipeline_definition.update_draft',
  'sheetbase.dataset_rows.commit',
] as const

export type AgentWorkflowTool = (typeof AGENT_WORKFLOW_TOOLS)[number]

export type AgentWorkflowInputReference =
  | { kind: 'dataset_version'; id: string }
  | { kind: 'pipeline_definition_version'; id: string }

export interface AgentWorkflowPlanStep {
  key: string
  title: string
  summary: string
  tool: AgentWorkflowTool
  operation: AgentOperation
  inputReferences: AgentWorkflowInputReference[]
}

export interface AgentWorkflowPlan {
  formatVersion: 1
  steps: AgentWorkflowPlanStep[]
}

export interface AgentWorkflowBudget {
  maxOperations: number
  maxTokens: number
  maxCostMicrousd: number
}

export interface AgentWorkflowUsage {
  tokens: number
  costMicrousd: number
}

export type AgentWorkflowStatus =
  'waiting_approval' | 'paused' | 'succeeded' | 'cancelled' | 'budget_exhausted'

export interface AgentWorkflow {
  id: string
  workspace_id: string
  goal: string
  status: AgentWorkflowStatus
  revision: number | string
  plan: AgentWorkflowPlan
  plan_digest: string
  provenance: AgentProvenance
  idempotency_key: string
  max_operations: number
  max_tokens: number | string
  max_cost_microusd: number | string
  used_operations: number
  used_tokens: number | string
  used_cost_microusd: number | string
  current_step: number
  created_by_user_id: string | null
  created_by_credential_id: string | null
  cancelled_by_user_id: string | null
  cancelled_by_credential_id: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type AgentWorkflowStepStatus =
  | 'planned'
  | 'waiting_approval'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'cancelled'

export interface AgentWorkflowStep {
  id: string
  workflow_id: string
  position: number
  step_key: string
  title: string
  summary: string
  tool_name: AgentWorkflowTool
  operation: AgentOperation
  input_references: AgentWorkflowInputReference[]
  status: AgentWorkflowStepStatus
  attempt: number
  proposal_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentWorkflowEvent {
  id: string
  workflow_id: string
  sequence: number
  event_type:
    | 'created'
    | 'step_proposed'
    | 'step_succeeded'
    | 'paused'
    | 'resumed'
    | 'usage_reported'
    | 'budget_exhausted'
    | 'cancelled'
    | 'succeeded'
  actor_user_id: string | null
  actor_credential_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

const WORKFLOW_FIELDS =
  'id,workspace_id,goal,status,revision,plan,plan_digest,provenance,idempotency_key,max_operations,max_tokens,max_cost_microusd,used_operations,used_tokens,used_cost_microusd,current_step,created_by_user_id,created_by_credential_id,cancelled_by_user_id,cancelled_by_credential_id,cancelled_at,cancellation_reason,completed_at,created_at,updated_at'

export async function createAgentWorkflow(
  client: DataClient,
  input: {
    workspaceId: string
    goal: string
    plan: AgentWorkflowPlan
    budget: AgentWorkflowBudget
    initialUsage: AgentWorkflowUsage
    provenance: AgentProvenance
    idempotencyKey: string
  },
): Promise<AgentWorkflow> {
  return client.rpc('create_agent_workflow', {
    p_workspace_id: input.workspaceId,
    p_goal: input.goal,
    p_plan: input.plan,
    p_budget: input.budget,
    p_initial_usage: input.initialUsage,
    p_provenance: input.provenance,
    p_idempotency_key: input.idempotencyKey,
  })
}

export async function listAgentWorkflows(
  client: DataClient,
): Promise<AgentWorkflow[]> {
  return client.list(
    'agent_workflows',
    `?select=${WORKFLOW_FIELDS}&order=created_at.desc`,
  )
}

export async function listAgentWorkflowSteps(
  client: DataClient,
  workflowId: string,
): Promise<AgentWorkflowStep[]> {
  return client.list(
    'agent_workflow_steps',
    `?workflow_id=eq.${encodeURIComponent(workflowId)}&order=position.asc`,
  )
}

export async function listAgentWorkflowEvents(
  client: DataClient,
  workflowId: string,
): Promise<AgentWorkflowEvent[]> {
  return client.list(
    'agent_workflow_events',
    `?workflow_id=eq.${encodeURIComponent(workflowId)}&order=sequence.asc`,
  )
}

export async function advanceAgentWorkflow(
  client: DataClient,
  workflow: AgentWorkflow,
): Promise<AgentWorkflow> {
  return client.rpc('advance_agent_workflow', {
    p_workflow_id: workflow.id,
    p_expected_revision: workflowRevision(workflow),
  })
}

export async function resumeAgentWorkflow(
  client: DataClient,
  workflow: AgentWorkflow,
): Promise<AgentWorkflow> {
  return client.rpc('resume_agent_workflow', {
    p_workflow_id: workflow.id,
    p_expected_revision: workflowRevision(workflow),
  })
}

export async function reportAgentWorkflowUsage(
  client: DataClient,
  input: {
    workflow: AgentWorkflow
    usage: AgentWorkflowUsage
  },
): Promise<AgentWorkflow> {
  return client.rpc('report_agent_workflow_usage', {
    p_workflow_id: input.workflow.id,
    p_expected_revision: workflowRevision(input.workflow),
    p_tokens: input.usage.tokens,
    p_cost_microusd: input.usage.costMicrousd,
  })
}

export async function cancelAgentWorkflow(
  client: DataClient,
  input: { workflow: AgentWorkflow; reason: string },
): Promise<AgentWorkflow> {
  return client.rpc('cancel_agent_workflow', {
    p_workflow_id: input.workflow.id,
    p_expected_revision: workflowRevision(input.workflow),
    p_reason: input.reason,
  })
}

export function workflowRevision(workflow: AgentWorkflow): number {
  return Number(workflow.revision)
}

export function workflowCostUsd(workflow: AgentWorkflow): string {
  return (Number(workflow.used_cost_microusd) / 1_000_000).toFixed(4)
}

export const agentWorkflowQueryKeys = {
  workflows: ['agent-operations', 'workflows'] as const,
  steps: (workflowId: string) =>
    ['agent-operations', 'workflows', workflowId, 'steps'] as const,
  events: (workflowId: string) =>
    ['agent-operations', 'workflows', workflowId, 'events'] as const,
}
