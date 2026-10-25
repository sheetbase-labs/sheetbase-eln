/**
 * AUTO-PLUS-03 — Scientific workflow provenance and evidence boundaries.
 *
 * A workflow run is already fully described by stored rows (workflow +
 * steps + proposals + events); this module only *projects* them into one
 * inspectable record. No new tables: every field below is a join over
 * existing AUTO-04/AUTO-05 columns, so the record can never disagree with
 * the authoritative rows. Audit timelines are not evidence — only pinned
 * version references and succeeded canonical results qualify for submitted
 * work, and even then only a human may submit or sign (agents cannot
 * attest; the submit/sign RPCs stay denied to agent credentials).
 */

import type {
  AgentOperation,
  AgentOperationProposal,
  AgentProvenance,
} from './agent-operations'
import type {
  AgentWorkflow,
  AgentWorkflowInputReference,
  AgentWorkflowStep,
} from './agent-workflows'

/** Stable identity a step consumed or produced, with its derivation. */
export interface AgentOutputReference {
  kind: string
  id: string
  source: 'operation' | 'result'
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ref(
  kind: string,
  id: unknown,
  source: AgentOutputReference['source'],
): AgentOutputReference | null {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  return { kind, id, source }
}

/** Result keys known to carry stable canonical ids, per operation kind. */
const RESULT_ID_KEYS: Record<string, Array<{ key: string; kind: string }>> = {
  'dataset_schema.create': [
    { key: 'schema_definition_id', kind: 'dataset_schema_definition' },
    { key: 'schema_version_id', kind: 'dataset_schema_version' },
  ],
  'pipeline_definition.create': [{ key: 'id', kind: 'pipeline_definition' }],
  'pipeline_definition.create_version': [
    { key: 'id', kind: 'pipeline_definition_version' },
  ],
  'sheet_definition.create': [{ key: 'id', kind: 'sheet_definition' }],
  'record.create': [{ key: 'id', kind: 'record' }],
  'record.custom_fields.update': [{ key: 'id', kind: 'record' }],
  'sheet_instance.create': [{ key: 'id', kind: 'sheet_instance' }],
  'sheet_instance.update': [{ key: 'id', kind: 'sheet_instance' }],
  'sheet_instance.archive': [{ key: 'id', kind: 'sheet_instance' }],
  'sheet_instance.restore': [{ key: 'id', kind: 'sheet_instance' }],
  'sheet_instance.materialize': [{ key: 'datasetId', kind: 'dataset' }],
  'pipeline_definition.update_draft': [
    { key: 'id', kind: 'pipeline_definition_version' },
  ],
  'sheet_definition.update_draft': [
    { key: 'id', kind: 'sheet_definition_version' },
  ],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Derive stable output/version references for a step. Operation-derived
 * refs are always computable from the pinned operation; result-derived
 * refs are extracted only from known identity keys holding UUIDs —
 * unknown result shapes yield no refs rather than guessed ones. Pass the
 * stored proposal `result` only for succeeded proposals.
 */
export function extractAgentOutputReferences(
  operation: AgentOperation,
  result: unknown,
): AgentOutputReference[] {
  const refs: AgentOutputReference[] = []
  // Fail closed on partial rows (e.g. test stubs or older clients): no
  // operation identity means no references, never a crash or a guess.
  if (!isRecord(operation) || typeof operation.kind !== 'string') return refs
  const push = (maybe: AgentOutputReference | null) => {
    if (maybe && !refs.some((r) => r.kind === maybe.kind && r.id === maybe.id))
      refs.push(maybe)
  }
  const op = operation as unknown as Record<string, unknown>
  switch (operation.kind) {
    case 'dataset_rows.commit':
      push(ref('dataset', op.datasetId, 'operation'))
      break
    case 'sheet_definition.update_draft':
      push(ref('sheet_definition_version', op.versionId, 'operation'))
      break
    case 'pipeline_definition.create_version':
      push(ref('pipeline_definition', op.definitionId, 'operation'))
      break
    case 'pipeline_definition.update_draft':
      push(ref('pipeline_definition_version', op.versionId, 'operation'))
      break
    case 'notebook_block.update':
    case 'notebook_block.move':
    case 'notebook_block.delete':
      push(ref('block', op.blockId, 'operation'))
      break
    case 'template.instantiate':
      if (isRecord(result) && isRecord(result.record)) {
        push(ref('record', result.record.id, 'result'))
      }
      break
    default:
      break
  }
  if (isRecord(result)) {
    for (const { key, kind } of RESULT_ID_KEYS[operation.kind] ?? [])
      push(ref(kind, result[key], 'result'))
  }
  return refs
}

/** One step of the provenance record: pinned plan joined to live state. */
export interface AgentProvenanceStepRecord {
  position: number
  stepKey: string
  title: string
  tool: string
  status: AgentWorkflowStep['status']
  attempt: number
  /** Immutable version pins from the plan (Dataset / Pipeline versions). */
  inputReferences: AgentWorkflowInputReference[]
  proposalId: string | null
  proposalStatus: AgentOperationProposal['status'] | null
  approvalPolicy: AgentOperationProposal['approval_policy'] | null
  policyReason: string | null
  riskClass: AgentOperationProposal['risk_class'] | null
  requestDigest: string | null
  provenance: AgentProvenance | null
  proposedBy: { userId: string | null; credentialId: string | null } | null
  decidedBy: { userId: string | null; reason: string | null } | null
  executedBy: { userId: string | null; credentialId: string | null } | null
  error: { code: string | null; message: string | null } | null
  outputReferences: AgentOutputReference[]
  completedAt: string | null
}

/**
 * One inspectable record for a run: workflow → step attempts → proposals
 * → input/output/version references + actor/policy decisions. Pure join;
 * a step without a stored proposal yet (planned, never proposed) carries
 * nulls rather than invented values.
 */
export interface AgentWorkflowProvenanceRecord {
  formatVersion: 1
  agentProduced: true
  workflow: {
    id: string
    goal: string
    status: AgentWorkflow['status']
    revision: string
    planDigest: string
    provenance: AgentProvenance
    createdBy: { userId: string | null; credentialId: string | null }
    budget: {
      maxOperations: number
      maxTokens: string
      maxCostMicrousd: string
    }
    usage: {
      usedOperations: number
      usedTokens: string
      usedCostMicrousd: string
    }
    currentStep: number
    createdAt: string
    completedAt: string | null
  }
  steps: AgentProvenanceStepRecord[]
}

type ProposalMap =
  Map<string, AgentOperationProposal> | Record<string, AgentOperationProposal>

function lookupProposals(
  proposalsById: ProposalMap,
  id: string,
): AgentOperationProposal | null {
  if (proposalsById instanceof Map) return proposalsById.get(id) ?? null
  return proposalsById[id] ?? null
}

export function buildWorkflowProvenanceRecord(
  workflow: AgentWorkflow,
  steps: AgentWorkflowStep[],
  proposalsById: ProposalMap,
): AgentWorkflowProvenanceRecord {
  const ordered = [...steps].sort((a, b) => a.position - b.position)
  return {
    formatVersion: 1,
    agentProduced: true,
    workflow: {
      id: workflow.id,
      goal: workflow.goal,
      status: workflow.status,
      revision: String(workflow.revision),
      planDigest: workflow.plan_digest,
      provenance: workflow.provenance,
      createdBy: {
        userId: workflow.created_by_user_id,
        credentialId: workflow.created_by_credential_id,
      },
      budget: {
        maxOperations: workflow.max_operations,
        maxTokens: String(workflow.max_tokens),
        maxCostMicrousd: String(workflow.max_cost_microusd),
      },
      usage: {
        usedOperations: workflow.used_operations,
        usedTokens: String(workflow.used_tokens),
        usedCostMicrousd: String(workflow.used_cost_microusd),
      },
      currentStep: workflow.current_step,
      createdAt: workflow.created_at,
      completedAt: workflow.completed_at,
    },
    steps: ordered.map((step) => {
      const proposal = step.proposal_id
        ? lookupProposals(proposalsById, step.proposal_id)
        : null
      const succeeded = proposal?.status === 'succeeded'
      return {
        position: step.position,
        stepKey: step.step_key,
        title: step.title,
        tool: step.tool_name,
        status: step.status,
        attempt: step.attempt,
        inputReferences: step.input_references,
        proposalId: proposal?.id ?? step.proposal_id,
        proposalStatus: proposal?.status ?? null,
        approvalPolicy: proposal?.approval_policy ?? null,
        policyReason: proposal?.policy_reason ?? null,
        riskClass: proposal?.risk_class ?? null,
        requestDigest: proposal?.request_digest ?? null,
        provenance: proposal?.provenance ?? null,
        proposedBy: proposal
          ? {
              userId: proposal.proposed_by_user_id,
              credentialId: proposal.proposed_by_credential_id,
            }
          : null,
        decidedBy: proposal
          ? {
              userId:
                proposal.approved_by_user_id ?? proposal.rejected_by_user_id,
              reason: proposal.rejection_reason,
            }
          : null,
        executedBy: proposal
          ? {
              userId: proposal.executed_by_user_id,
              credentialId: proposal.executed_by_credential_id,
            }
          : null,
        error: proposal
          ? { code: proposal.error_code, message: proposal.error_message }
          : null,
        outputReferences: extractAgentOutputReferences(
          step.operation,
          succeeded ? proposal.result : null,
        ),
        completedAt: step.completed_at,
      }
    }),
  }
}

/**
 * Evidence-boundary marking for an agent-produced output proposed for
 * submitted work. Every agent output is marked agent-produced; only a
 * *succeeded* proposal carries a canonical result worth pinning, and even
 * then a human must submit/sign — this marking is information, never
 * attestation.
 */
export interface AgentEvidenceMarking {
  agentProduced: true
  provenance: AgentProvenance
  qualifiesForSubmission: boolean
  qualification: string
  versionPins: AgentWorkflowInputReference[]
  outputReferences: AgentOutputReference[]
}

export function markProposalEvidence(
  proposal: AgentOperationProposal,
): AgentEvidenceMarking {
  const outputReferences = extractAgentOutputReferences(
    proposal.operation,
    proposal.status === 'succeeded' ? proposal.result : null,
  )
  const inputPins: AgentWorkflowInputReference[] = []
  const base = {
    agentProduced: true as const,
    provenance: proposal.provenance,
    versionPins: inputPins,
    outputReferences,
  }
  switch (proposal.status) {
    case 'succeeded':
      return {
        ...base,
        qualifiesForSubmission: true,
        qualification:
          'Succeeded through the canonical operation; result pins above may enter submitted work after human review.',
      }
    case 'pending':
    case 'approved':
    case 'executing':
      return {
        ...base,
        qualifiesForSubmission: false,
        qualification: `Not submittable while ${proposal.status}: no canonical result exists yet.`,
      }
    case 'rejected':
      return {
        ...base,
        qualifiesForSubmission: false,
        qualification: `Not submittable: rejected${proposal.rejection_reason ? ` — ${proposal.rejection_reason}` : ''}.`,
      }
    case 'failed':
      return {
        ...base,
        qualifiesForSubmission: false,
        qualification: `Not submittable: execution failed (${proposal.error_code ?? 'unknown'}).`,
      }
    case 'cancelled':
      return {
        ...base,
        qualifiesForSubmission: false,
        qualification: 'Not submittable: cancelled before a canonical result.',
      }
  }
}

export function markWorkflowStepEvidence(
  step: AgentWorkflowStep,
  proposal?: AgentOperationProposal | null,
): AgentEvidenceMarking {
  const resolved = proposal ?? null
  const provenance: AgentProvenance = resolved?.provenance ?? {
    agentId: 'unknown',
    tool: { name: step.tool_name },
    model: { provider: 'unknown', name: 'unknown' },
    invocationId: 'unknown',
  }
  const outputReferences = extractAgentOutputReferences(
    step.operation,
    resolved?.status === 'succeeded' ? resolved.result : null,
  )
  const base = {
    agentProduced: true as const,
    provenance,
    versionPins: step.input_references,
    outputReferences,
  }
  if (step.status === 'succeeded' && resolved?.status === 'succeeded') {
    return {
      ...base,
      qualifiesForSubmission: true,
      qualification:
        'Step succeeded with a canonical result; pins above may enter submitted work after human review.',
    }
  }
  if (!resolved) {
    return {
      ...base,
      qualifiesForSubmission: false,
      qualification: 'Not submittable: step has no proposal yet.',
    }
  }
  const proposalMarking = markProposalEvidence(resolved)
  return {
    ...base,
    outputReferences,
    qualifiesForSubmission: false,
    qualification: proposalMarking.qualification,
  }
}

export const AGENT_EVIDENCE_HUMAN_ATTESTATION_NOTE =
  'Agent-produced. Human submit/sign required — agents cannot attest.'
