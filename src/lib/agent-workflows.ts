import {
  AGENT_OPERATION_TOOL_NAMES,
  describeAgentTool,
} from './agent-tool-catalogue'
import type { AgentToolMode } from './agent-tool-catalogue'
import type { DataClient } from './data-client'
import type {
  AgentOperation,
  AgentOperationImpact,
  AgentOperationKind,
  AgentOperationPreview,
  AgentOperationProposal,
  AgentOperationRiskClass,
  AgentProvenance,
} from './agent-operations'

/**
 * Allowlisted workflow tools. Single authority: the AUTO-PLUS-01 tool
 * catalogue (`AGENT_OPERATION_TOOL_NAMES`); re-exported here so existing
 * imports keep working. The drift test in `agent-tool-catalogue.test.ts`
 * pins the agreement with the AI gateway allowlist.
 */
export const AGENT_WORKFLOW_TOOLS = AGENT_OPERATION_TOOL_NAMES

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

/**
 * AUTO-PLUS-02 — Plans, approval & safe execution.
 *
 * Everything below is a read-only derived view over the AUTO-04/05
 * canonical state. There is no second engine and no new RPC: dry-run
 * previews join stored proposal preview/impact rows, approval gates
 * observe the AUTO-04 decide/policy decision on each step's proposal, and
 * resume/retry/cancellation reuse the existing workflow RPCs. Approval
 * itself stays human-only (`decide_agent_operation`); agents cannot
 * sign or attest.
 */

/**
 * Approval-gate state of one workflow step. `pending-approval`,
 * `approved`, and `rejected` mirror the human decide path; `flowing`
 * covers safe drafts and delegated writes moving without a human click.
 */
export type AgentWorkflowStepGate =
  | 'planned'
  | 'flowing'
  | 'pending-approval'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'succeeded'

/**
 * Risk class of a workflow step's pinned operation. Mirrors the server
 * mapping in `internal.agent_operation_policy_evaluate`: Dataset row
 * commits and notebook block inserts are consequential writes; every other
 * allowlisted operation drafts reversible configuration.
 */
export function workflowStepRiskClass(step: {
  operation: AgentOperation
}): AgentOperationRiskClass {
  return step.operation.kind === 'dataset_rows.commit' ||
    step.operation.kind === 'notebook_block.insert' ||
    step.operation.kind === 'record.create' ||
    step.operation.kind === 'record.custom_fields.update' ||
    step.operation.kind === 'sheet_instance.create' ||
    step.operation.kind === 'template.instantiate'
    ? 'consequential_write'
    : 'safe_draft'
}

/** Catalogue mode of a workflow tool (`read` never mutates, `draft` proposes, `mutate` writes). */
export function workflowStepMode(tool: AgentWorkflowTool): AgentToolMode {
  return describeAgentTool(tool)?.mode ?? 'mutate'
}

/**
 * Whether a step needs explicit human approval through the decide path.
 * With a live proposal this observes the stored AUTO-04 policy decision;
 * without one it predicts from the risk class (consequential writes stay
 * human-required unless a delegation policy matches at propose time).
 */
export function requiresExplicitApproval(
  step: { operation: AgentOperation },
  proposal?: Pick<AgentOperationProposal, 'approval_policy'> | null,
): boolean {
  if (proposal) return proposal.approval_policy === 'human_required'
  return workflowStepRiskClass(step) === 'consequential_write'
}

/**
 * Derive a step's approval gate from its stored proposal. The proposal is
 * the gate: `pending` + `human_required` waits for a human click,
 * `approved`/`executing` has passed the gate and awaits execution,
 * `rejected` is terminal for that attempt (resume retries, never revives).
 * Without proposal data the gate fails closed from the step status: a
 * proposed-but-unloaded step reads as `pending-approval` until its
 * proposal proves otherwise.
 */
export function workflowStepGate(
  step: Pick<AgentWorkflowStep, 'status'>,
  proposal?: Pick<AgentOperationProposal, 'status' | 'approval_policy'> | null,
): AgentWorkflowStepGate {
  if (!proposal) {
    if (step.status === 'failed') return 'failed'
    if (step.status === 'cancelled') return 'cancelled'
    if (step.status === 'succeeded') return 'succeeded'
    if (step.status === 'rejected') return 'rejected'
    if (step.status === 'waiting_approval') return 'pending-approval'
    return 'planned'
  }
  switch (proposal.status) {
    case 'pending':
      return proposal.approval_policy === 'human_required'
        ? 'pending-approval'
        : 'flowing'
    case 'approved':
    case 'executing':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'succeeded':
      return 'succeeded'
  }
}

/** One step of a plan dry-run: static prediction joined with live proposal state. */
export interface AgentWorkflowStepDryRun {
  position: number
  stepKey: string
  title: string
  tool: AgentWorkflowTool
  mode: AgentToolMode
  operationKind: AgentOperationKind
  riskClass: AgentOperationRiskClass
  requiresExplicitApproval: boolean
  gate: AgentWorkflowStepGate
  proposalId: string | null
  attempt: number
  /** Stored PostgreSQL preview where the step has been proposed; null for planned steps. */
  preview: AgentOperationPreview | null
  /** Stored PostgreSQL impact where the step has been proposed; null for planned steps. */
  impact: AgentOperationImpact | null
}

/**
 * Preview every step of a plan WITHOUT advancing state. Pure join over
 * already-loaded workflow steps and proposals — it issues no RPC and
 * touches no revision, budget, or proposal. Steps already proposed carry
 * their stored PostgreSQL preview/impact/risk; planned steps carry the
 * catalogue prediction (mode, risk, predicted gate).
 */
export function dryRunAgentWorkflow(
  steps: AgentWorkflowStep[],
  proposalsById:
    | Map<string, AgentOperationProposal>
    | Record<string, AgentOperationProposal>,
): AgentWorkflowStepDryRun[] {
  const lookup = (id: string): AgentOperationProposal | undefined =>
    proposalsById instanceof Map ? proposalsById.get(id) : proposalsById[id]
  return [...steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => {
      const proposal = step.proposal_id ? lookup(step.proposal_id) : undefined
      return {
        position: step.position,
        stepKey: step.step_key,
        title: step.title,
        tool: step.tool_name,
        mode: workflowStepMode(step.tool_name),
        operationKind: step.operation.kind,
        riskClass: workflowStepRiskClass(step),
        requiresExplicitApproval: requiresExplicitApproval(
          step,
          proposal ?? null,
        ),
        gate: workflowStepGate(step, proposal ?? null),
        proposalId: step.proposal_id,
        attempt: step.attempt,
        preview: proposal?.preview ?? null,
        impact: proposal?.impact ?? null,
      }
    })
}

/** Plan-level approval rollup: per-step gates plus the consequential set. */
export interface AgentWorkflowApprovalSummary {
  total: number
  /** Step keys awaiting an explicit human decide (per-step gate). */
  pendingApproval: string[]
  /** Step keys the human has approved and not yet executed. */
  approved: string[]
  /** Step keys the human rejected (resume retries; the rejection stands). */
  rejected: string[]
  /** Step keys flowing via automatic/delegated policy or already terminal. */
  flowing: string[]
  /** Step keys not yet proposed. */
  planned: string[]
  /** Every step requiring explicit approval, decided or not (per-plan gate). */
  consequential: string[]
}

/** Roll up a dry-run into per-step and per-plan approval gates. */
export function summarizeWorkflowApprovals(
  dryRun: AgentWorkflowStepDryRun[],
): AgentWorkflowApprovalSummary {
  const summary: AgentWorkflowApprovalSummary = {
    total: dryRun.length,
    pendingApproval: [],
    approved: [],
    rejected: [],
    flowing: [],
    planned: [],
    consequential: [],
  }
  for (const step of dryRun) {
    if (step.requiresExplicitApproval) summary.consequential.push(step.stepKey)
    switch (step.gate) {
      case 'pending-approval':
        summary.pendingApproval.push(step.stepKey)
        break
      case 'approved':
        summary.approved.push(step.stepKey)
        break
      case 'rejected':
        summary.rejected.push(step.stepKey)
        break
      case 'planned':
        summary.planned.push(step.stepKey)
        break
      default:
        summary.flowing.push(step.stepKey)
        break
    }
  }
  return summary
}

/**
 * Step-execution idempotency key. Parity with
 * `internal.agent_workflow_propose_step`: each attempt proposes under
 * `workflow:{workflowId}:{stepKey}:{attempt}` with a 1-based attempt, so
 * resume (attempt + 1) never reuses — and never double-executes — a prior
 * attempt's key. Reusing a key with different content fails 23505.
 */
export function workflowStepIdempotencyKey(
  workflowId: string,
  stepKey: string,
  attempt: number,
): string {
  return `workflow:${workflowId}:${stepKey}:${attempt}`
}

/**
 * Bounded retry budget: every proposal attempt consumes one operation, so
 * retries are bounded by the remaining operation budget. No separate
 * retry counter — the durable budget is the bound. Resume proposes the
 * next attempt as `step.attempt + 1` under a fresh idempotency key.
 */
export function workflowRetriesRemaining(workflow: AgentWorkflow): number {
  return Math.max(0, workflow.max_operations - workflow.used_operations)
}

/**
 * Whether a human resume may retry this step: the workflow is paused on a
 * failed or rejected step and the operation budget still has room for a
 * new attempt. Completed steps are never retried; cancelled workflows are
 * terminal.
 */
export function canRetryWorkflowStep(
  workflow: AgentWorkflow,
  step: Pick<AgentWorkflowStep, 'status'>,
): boolean {
  return (
    workflow.status === 'paused' &&
    (step.status === 'failed' || step.status === 'rejected') &&
    workflowRetriesRemaining(workflow) > 0
  )
}

/** Resume-after-partial-failure snapshot: what survives, what is retryable. */
export interface AgentWorkflowRecoverySummary {
  /** Steps already succeeded — results kept, never re-executed. */
  completed: { stepKey: string; proposalId: string | null }[]
  /** Step keys marked failed/rejected and retryable by human resume. */
  retryable: string[]
  /** Cancellation or budget exhaustion is terminal: resume is refused. */
  terminal: boolean
  retriesRemaining: number
}

/**
 * Summarize recovery state. Completed steps keep their canonical results;
 * the failed step is retryable as a new attempt of the same pinned
 * operation; cancelled/budget-exhausted workflows stay inspectable but
 * terminal — continue with a new plan.
 */
export function summarizeWorkflowRecovery(
  workflow: AgentWorkflow,
  steps: AgentWorkflowStep[],
): AgentWorkflowRecoverySummary {
  return {
    completed: steps
      .filter((step) => step.status === 'succeeded')
      .map((step) => ({
        stepKey: step.step_key,
        proposalId: step.proposal_id,
      })),
    retryable: steps
      .filter((step) => canRetryWorkflowStep(workflow, step))
      .map((step) => step.step_key),
    terminal:
      workflow.status === 'cancelled' ||
      workflow.status === 'budget_exhausted' ||
      workflow.status === 'succeeded',
    retriesRemaining: workflowRetriesRemaining(workflow),
  }
}

/**
 * AUTO-PLUS-03 — workflow run cost/latency rollup.
 *
 * Metrics decision: run-level rollups live here, on the workflow usage
 * reporting already stored per run (budgets, used tokens/cost, step
 * states, wall-clock timestamps) — not in the AI-03 gateway registry,
 * which stays scoped to per-model-call telemetry (calls, cost, latency
 * histograms). Gateway usage reaches a run through
 * `reportAgentWorkflowUsage`; this summary only reads stored run state,
 * so it never disagrees with the durable counters.
 */
export interface AgentWorkflowRunMetrics {
  operations: { used: number; max: number; remaining: number }
  tokens: { used: string; max: string }
  costMicrousd: { used: string; max: string }
  costUsd: { used: string; max: string }
  /** Wall latency completed_at − created_at; null until the run completes. */
  wallLatencyMs: number | null
  steps: {
    total: number
    succeeded: number
    failed: number
    rejected: number
    cancelled: number
    open: number
  }
  budgetExhausted: boolean
}

const MICROUSD_PER_USD = 1_000_000

export function summarizeWorkflowRunMetrics(
  workflow: AgentWorkflow,
  steps: Pick<AgentWorkflowStep, 'status'>[],
): AgentWorkflowRunMetrics {
  const count = (status: AgentWorkflowStep['status']) =>
    steps.filter((step) => step.status === status).length
  const latency =
    workflow.completed_at == null
      ? null
      : Date.parse(workflow.completed_at) - Date.parse(workflow.created_at)
  return {
    operations: {
      used: workflow.used_operations,
      max: workflow.max_operations,
      remaining: workflowRetriesRemaining(workflow),
    },
    tokens: {
      used: String(workflow.used_tokens),
      max: String(workflow.max_tokens),
    },
    costMicrousd: {
      used: String(workflow.used_cost_microusd),
      max: String(workflow.max_cost_microusd),
    },
    costUsd: {
      used: (Number(workflow.used_cost_microusd) / MICROUSD_PER_USD).toFixed(4),
      max: (Number(workflow.max_cost_microusd) / MICROUSD_PER_USD).toFixed(4),
    },
    wallLatencyMs:
      latency != null && Number.isFinite(latency) && latency >= 0
        ? latency
        : null,
    steps: {
      total: steps.length,
      succeeded: count('succeeded'),
      failed: count('failed'),
      rejected: count('rejected'),
      cancelled: count('cancelled'),
      open: count('planned') + count('waiting_approval'),
    },
    budgetExhausted: workflow.status === 'budget_exhausted',
  }
}

export const agentWorkflowQueryKeys = {
  workflows: ['agent-operations', 'workflows'] as const,
  steps: (workflowId: string) =>
    ['agent-operations', 'workflows', workflowId, 'steps'] as const,
  events: (workflowId: string) =>
    ['agent-operations', 'workflows', workflowId, 'events'] as const,
}
