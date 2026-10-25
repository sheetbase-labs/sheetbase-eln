/**
 * AUTO-04 typed contract for agent-authored operation proposals.
 *
 * The proposal envelope is durable, but execution always delegates to the
 * existing canonical RPC named by the operation variant. Safe draft changes
 * can run automatically; consequential writes use human approval or an
 * explicit bounded policy. Publish, submit, sign, amend, lock, and multi-step
 * workflow actions are intentionally absent.
 */
import type { DataClient } from './data-client'
import type { DatasetCommitRow } from './dataset-product'
import type { DatasetSchemaFieldInput } from './dataset-schema-definition-rpc'
import type { SheetDefinitionConfiguration } from './sheet-definition'
import type { PipelineConfig } from './pipelines/config'

export interface AgentProvenance {
  agentId: string
  agentName?: string
  tool: {
    name: string
    version?: string
  }
  model: {
    provider: string
    name: string
    version?: string
  }
  invocationId: string
}

export type AgentOperation =
  | {
      kind: 'dataset_schema.create'
      workspaceId: string
      key: string
      name: string
      description?: string | null
      fields: DatasetSchemaFieldInput[]
    }
  | {
      kind: 'sheet_definition.create'
      workspaceId: string
      key: string
      name: string
      description?: string | null
      configuration: SheetDefinitionConfiguration
    }
  | {
      kind: 'sheet_definition.update_draft'
      versionId: string
      expectedRevision: number
      configuration: SheetDefinitionConfiguration
    }
  | {
      kind: 'pipeline_definition.create'
      workspaceId: string
      key: string
      name: string
      description?: string | null
    }
  | {
      kind: 'pipeline_definition.create_version'
      workspaceId: string
      definitionId: string
      expectedDefinitionRevision: number
      configuration: PipelineConfig
    }
  | {
      kind: 'pipeline_definition.update_draft'
      workspaceId: string
      versionId: string
      expectedRevision: number
      configuration: PipelineConfig
    }
  | {
      kind: 'dataset_rows.commit'
      datasetId: string
      expectedRevision: number
      rows: DatasetCommitRow[]
    }
  | {
      kind: 'notebook_block.insert'
      recordId: string
      afterBlockId?: string | null
      block: {
        type: string
        payload: Record<string, unknown>
        payloadSchemaVersion?: number
      }
      expectedRevision: number
    }
  | {
      kind: 'notebook_block.update'
      blockId: string
      expectedVersion: number
      payload: Record<string, unknown>
      payloadSchemaVersion?: number
    }
  | {
      kind: 'notebook_block.move'
      blockId: string
      expectedStructureVersion: number
      afterBlockId?: string | null
      beforeBlockId?: string | null
    }
  | {
      kind: 'notebook_block.delete'
      blockId: string
      expectedStructureVersion: number
    }
  | {
      kind: 'record.create'
      workspaceId: string
      projectId?: string | null
      recordKind: string
      title: string
      status?: string
      tags?: string[]
      properties?: Record<string, unknown>
    }
  | {
      kind: 'record.custom_fields.update'
      recordId: string
      expectedMetadataVersion: number
      values: Record<string, unknown>
    }
  | {
      kind: 'sheet_instance.create'
      workspaceId: string
      name: string
      description?: string | null
      sourceDefinitionVersionId: string
      projectId?: string | null
      notebookRecordId?: string | null
      state: Record<string, unknown>
      parameterInputs?: Record<string, unknown>
    }
  | {
      kind: 'sheet_instance.update'
      instanceId: string
      expectedRevision: number
      state: Record<string, unknown>
    }
  | {
      kind: 'sheet_instance.archive'
      instanceId: string
      expectedRevision: number
    }
  | {
      kind: 'sheet_instance.restore'
      instanceId: string
      expectedRevision: number
    }
  | {
      kind: 'template.instantiate'
      templateRecordId: string
      targetProjectId: string
      targetKind: 'experiment' | 'protocol_template'
      title?: string | null
    }
  | {
      kind: 'template.upgrade'
      recordId: string
      expectedStructureVersion: number
      targetVersionId: string
      decisions: Record<string, unknown>[]
      parameterInputs: Record<string, unknown>[]
    }
  | {
      kind: 'record.comment.create'
      recordId: string
      targetKind: 'record' | 'block'
      target?: { blockId?: string } | null
      body: string
      mentions?: string[]
    }
  | {
      kind: 'model_field.create'
      workspaceId: string
      modelKey: string
      fieldName: string
      label: string
      logicalType:
        | 'text'
        | 'integer'
        | 'decimal'
        | 'boolean'
        | 'date'
        | 'timestamp'
        | 'category'
        | 'reference'
      nullable?: boolean
      defaultValue?: unknown
      validation?: Record<string, unknown>
      unit?: Record<string, unknown> | null
      description?: string | null
    }
  | {
      kind: 'model_field.update'
      definitionId: string
      patch: Record<string, unknown>
    }
  | {
      kind: 'model_field.activate'
      definitionId: string
    }
  | {
      kind: 'sheet_instance.materialize'
      instanceId: string
      expectedRevision: number
      outputName: string
      outputSchemaVersionId?: string | null
      previewDigest: string
    }
  | {
      kind: 'workspace_ai_settings.update'
      workspaceId: string
      enabled: boolean
      providerProfile?: string | null
      model: 'sheetbase-assist-1' | 'sheetbase-summarise-1'
      cloudEgressEnabled: boolean
      maxTokensPerCall: number
      maxCostMicrousdPerCall: number
    }

export type AgentOperationKind = AgentOperation['kind']
export type AgentOperationRiskClass = 'safe_draft' | 'consequential_write'
export type AgentOperationApprovalPolicy =
  'automatic' | 'human_required' | 'delegated'
export type AgentProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type AgentOperationPolicyTargetType =
  | 'workspace'
  | 'project'
  | 'record'
  | 'dataset'
  | 'pipeline_definition'
  | 'dataset_schema'
  | 'sheet_definition'
  | 'sheet_definition_version'

export interface AgentOperationPolicy {
  id: string
  workspace_id: string
  name: string
  credential_id: string
  operation_kind: AgentOperationKind
  target_type: AgentOperationPolicyTargetType
  target_id: string | null
  limits: Record<string, unknown>
  enabled: boolean
  reason: string | null
  signed_by_user_id: string | null
  signed_meaning: string | null
  signed_at: string | null
  created_by_user_id: string
  updated_by_user_id: string
  created_at: string
  updated_at: string
}

export interface AgentOperationTarget {
  type: string
  id: string | null
  label: string
}

export interface AgentOperationChange {
  path: string
  before: unknown
  after: unknown
}

export interface AgentOperationPreview {
  formatVersion: 1
  kind: AgentOperationKind
  target: AgentOperationTarget
  expectedRevision?: number
  currentRevision?: number
  changes: AgentOperationChange[]
}

export interface AgentOperationImpact {
  formatVersion: 1
  mutationClass: 'configuration' | 'content' | 'data'
  target: AgentOperationTarget
  createsDraft: boolean
  affectedRows: number
  destructive: boolean
  validation?: unknown
}

export interface AgentOperationProposal {
  id: string
  workspace_id: string
  title: string
  summary: string
  operation_kind: AgentOperationKind
  operation: AgentOperation
  preview: AgentOperationPreview
  impact: AgentOperationImpact
  risk_class: AgentOperationRiskClass
  approval_policy: AgentOperationApprovalPolicy
  policy_id: string | null
  policy_reason: string
  policy_limits: Record<string, unknown>
  policy_target: Record<string, unknown>
  policy_evidence: Record<string, unknown>
  status: AgentProposalStatus
  revision: number | string
  idempotency_key: string
  request_digest: string
  provenance: AgentProvenance
  proposed_by_user_id: string | null
  proposed_by_credential_id: string | null
  approved_by_user_id: string | null
  approved_at: string | null
  rejected_by_user_id: string | null
  rejected_at: string | null
  rejection_reason: string | null
  executed_by_user_id: string | null
  executed_by_credential_id: string | null
  executed_at: string | null
  result: unknown
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface AgentOperationEvent {
  id: string
  proposal_id: string
  sequence: number
  event_type:
    | 'proposed'
    | 'approved'
    | 'rejected'
    | 'execution_started'
    | 'execution_succeeded'
    | 'execution_failed'
    | 'cancelled'
  actor_user_id: string | null
  actor_credential_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

const PROPOSAL_FIELDS =
  'id,workspace_id,title,summary,operation_kind,operation,preview,impact,risk_class,approval_policy,policy_id,policy_reason,policy_limits,policy_target,policy_evidence,status,revision,idempotency_key,request_digest,provenance,proposed_by_user_id,proposed_by_credential_id,approved_by_user_id,approved_at,rejected_by_user_id,rejected_at,rejection_reason,executed_by_user_id,executed_by_credential_id,executed_at,result,error_code,error_message,created_at,updated_at'

export async function proposeAgentOperation(
  client: DataClient,
  input: {
    workspaceId: string
    title: string
    summary: string
    operation: AgentOperation
    provenance: AgentProvenance
    idempotencyKey: string
  },
): Promise<AgentOperationProposal> {
  return client.rpc('propose_agent_operation', {
    p_workspace_id: input.workspaceId,
    p_title: input.title,
    p_summary: input.summary,
    p_operation: input.operation,
    p_provenance: input.provenance,
    p_idempotency_key: input.idempotencyKey,
  })
}

export async function listAgentOperationProposals(
  client: DataClient,
): Promise<AgentOperationProposal[]> {
  return client.list(
    'agent_operation_proposals',
    `?select=${PROPOSAL_FIELDS}&order=created_at.desc`,
  )
}

/**
 * Read one proposal by id (PIPE-03 notebook proposal block). Returns null when
 * the row is absent or not readable for the caller rather than throwing, so a
 * block linked to a withdrawn proposal renders an honest "not available" state.
 */
export async function fetchAgentOperationProposal(
  client: DataClient,
  proposalId: string,
): Promise<AgentOperationProposal | null> {
  const rows = await client.list<AgentOperationProposal>(
    'agent_operation_proposals',
    `?select=${PROPOSAL_FIELDS}&id=eq.${encodeURIComponent(proposalId)}`,
  )
  return rows.at(0) ?? null
}

export async function listAgentOperationPolicies(
  client: DataClient,
): Promise<AgentOperationPolicy[]> {
  return client.list(
    'agent_operation_policies',
    '?select=id,workspace_id,name,credential_id,operation_kind,target_type,target_id,limits,enabled,reason,signed_by_user_id,signed_meaning,signed_at,created_by_user_id,updated_by_user_id,created_at,updated_at&order=created_at.desc',
  )
}

export async function createAgentOperationPolicy(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    operationKind: AgentOperationKind
    credentialId: string
    targetType: AgentOperationPolicyTargetType
    targetId: string | null
    maxAffectedRows: number
    reason: string
    meaning: string
  },
): Promise<AgentOperationPolicy> {
  return client.rpc('create_agent_operation_policy', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_operation_kind: input.operationKind,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_credential_id: input.credentialId,
    p_limits: { maxAffectedRows: input.maxAffectedRows },
    p_reason: input.reason,
    p_meaning: input.meaning,
  })
}

export async function disableAgentOperationPolicy(
  client: DataClient,
  input: { workspaceId: string; policyId: string },
): Promise<AgentOperationPolicy> {
  return client.rpc('disable_agent_operation_policy', {
    p_workspace_id: input.workspaceId,
    p_policy_id: input.policyId,
  })
}

export async function listAgentOperationEvents(
  client: DataClient,
  proposalId: string,
): Promise<AgentOperationEvent[]> {
  return client.list(
    'agent_operation_events',
    `?proposal_id=eq.${encodeURIComponent(proposalId)}&order=sequence.asc`,
  )
}

export async function decideAgentOperation(
  client: DataClient,
  input: {
    proposalId: string
    expectedRevision: number
    decision: 'approve' | 'reject'
    reason?: string | null
  },
): Promise<AgentOperationProposal> {
  return client.rpc('decide_agent_operation', {
    p_proposal_id: input.proposalId,
    p_expected_revision: input.expectedRevision,
    p_decision: input.decision,
    p_reason: input.reason ?? null,
  })
}

export async function executeAgentOperation(
  client: DataClient,
  input: { proposalId: string; expectedRevision: number },
): Promise<AgentOperationProposal> {
  return client.rpc('execute_agent_operation', {
    p_proposal_id: input.proposalId,
    p_expected_revision: input.expectedRevision,
  })
}

export const agentOperationQueryKeys = {
  proposals: ['agent-operations', 'proposals'] as const,
  proposal: (proposalId: string) =>
    ['agent-operations', 'proposals', proposalId] as const,
  policies: ['agent-operations', 'policies'] as const,
  events: (proposalId: string) =>
    ['agent-operations', 'proposals', proposalId, 'events'] as const,
}

export function agentOperationLabel(kind: AgentOperationKind): string {
  switch (kind) {
    case 'dataset_schema.create':
      return 'Create Dataset Schema draft'
    case 'sheet_definition.create':
      return 'Create Sheet Definition draft'
    case 'sheet_definition.update_draft':
      return 'Update Sheet Definition draft'
    case 'pipeline_definition.create':
      return 'Create Pipeline Definition'
    case 'pipeline_definition.create_version':
      return 'Create Pipeline draft version'
    case 'pipeline_definition.update_draft':
      return 'Update Pipeline draft version'
    case 'dataset_rows.commit':
      return 'Commit Dataset rows'
    case 'notebook_block.insert':
      return 'Insert notebook block'
    case 'notebook_block.update':
      return 'Update notebook block'
    case 'notebook_block.move':
      return 'Move notebook block'
    case 'notebook_block.delete':
      return 'Delete notebook block'
    case 'record.create':
      return 'Create record'
    case 'record.custom_fields.update':
      return 'Update record fields'
    case 'sheet_instance.create':
      return 'Create Sheet Instance'
    case 'sheet_instance.update':
      return 'Update Sheet Instance'
    case 'sheet_instance.archive':
      return 'Archive Sheet Instance'
    case 'sheet_instance.restore':
      return 'Restore Sheet Instance'
    case 'template.instantiate':
      return 'Instantiate protocol template'
    case 'template.upgrade':
      return 'Upgrade notebook template'
    case 'record.comment.create':
      return 'Add notebook comment'
    case 'model_field.create':
      return 'Create model field'
    case 'model_field.update':
      return 'Update model field'
    case 'model_field.activate':
      return 'Activate model field'
    case 'sheet_instance.materialize':
      return 'Materialize Sheet Instance'
    case 'workspace_ai_settings.update':
      return 'Update workspace AI settings'
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function proposalRevision(proposal: AgentOperationProposal): number {
  return Number(proposal.revision)
}
