/**
 * The agent registry the Agents page shows: the workflows (named automations
 * with a trigger, an owner and a policy), their runs, the numbered revisions of
 * the policy, and how a proposal reads from a person's point of view.
 */
import { formatInstant } from './display-time-zone'
import type { DataClient } from './data-client'
import type { AgentOperationProposal } from './agent-operations'

export type PolicyMode =
  'never' | 'allowed' | 'needs_approval' | 'needs_signature'
export type PolicyKey =
  'read' | 'notebook_blocks' | 'dataset_flags' | 'create_records' | 'messages'
export type AgentPolicy = Record<PolicyKey, PolicyMode>

export const POLICY_COLUMNS: ReadonlyArray<{ key: PolicyKey; label: string }> =
  [
    { key: 'read', label: 'Read data' },
    { key: 'notebook_blocks', label: 'Notebook blocks' },
    { key: 'dataset_flags', label: 'Dataset flags' },
    { key: 'create_records', label: 'Create records' },
    { key: 'messages', label: 'Messages' },
  ]

export const POLICY_MODES: ReadonlyArray<{
  mode: PolicyMode
  label: string
  help: string
}> = [
  {
    mode: 'never',
    label: 'Never',
    help: 'The workflow can’t do this at all.',
  },
  {
    mode: 'needs_approval',
    label: 'Needs approval',
    help: 'A person with edit access to the record approves each proposal.',
  },
  {
    mode: 'needs_signature',
    label: 'Needs e-signature',
    help: 'Approval is an electronic signature: password and meaning, 21 CFR Part 11.',
  },
  {
    mode: 'allowed',
    label: 'Allowed',
    help: 'Runs without asking. Every action is still in the audit log.',
  },
]

export function policyModeLabel(mode: PolicyMode): string {
  return POLICY_MODES.find((m) => m.mode === mode)?.label ?? mode
}

export interface AgentDefinition {
  id: string
  workspace_id: string
  display_id: string
  name: string
  kind: 'ai' | 'rule'
  description: string
  trigger_label: string
  /** Empty means every project. */
  project_ids: string[]
  owner_user_id: string | null
  model_label: string | null
  reads: string[]
  proposes: string | null
  enabled: boolean
  policy: AgentPolicy
  updated_at: string
}

export interface AgentRun {
  id: string
  definition_id: string
  run_number: number
  outcome: 'proposed' | 'no_change' | 'sent' | 'failed'
  /** The headline in the workflow list. */
  summary: string
  /** The line in the run history. */
  detail: string
  proposal_id: string | null
  started_at: string
}

export interface AgentPolicyRevision {
  id: string
  revision: number
  summary: string
  change_ref: string | null
  reason: string
  changed_by_user_id: string | null
  changed_at: string
}

export interface WorkspaceMember {
  user_id: string
  name: string
  role: string
}

export const agentRegistryQueryKeys = {
  definitions: ['agent-registry', 'definitions'] as const,
  runs: ['agent-registry', 'runs'] as const,
  revisions: ['agent-registry', 'revisions'] as const,
  members: ['agent-registry', 'members'] as const,
  projects: ['agent-registry', 'projects'] as const,
}

export function listAgentDefinitions(
  client: DataClient,
): Promise<AgentDefinition[]> {
  return client.list(
    'agent_definitions',
    '?select=id,workspace_id,display_id,name,kind,description,trigger_label,project_ids,owner_user_id,model_label,reads,proposes,enabled,policy,updated_at&order=display_id.asc',
  )
}

export function listAgentRuns(client: DataClient): Promise<AgentRun[]> {
  return client.list(
    'agent_runs',
    '?select=id,definition_id,run_number,outcome,summary,detail,proposal_id,started_at&order=started_at.desc&limit=500',
  )
}

export function listAgentPolicyRevisions(
  client: DataClient,
): Promise<AgentPolicyRevision[]> {
  return client.list(
    'agent_policy_revisions',
    '?select=id,revision,summary,change_ref,reason,changed_by_user_id,changed_at&order=revision.desc',
  )
}

export function listWorkspaceMembers(
  client: DataClient,
): Promise<WorkspaceMember[]> {
  return client.rpc<WorkspaceMember[]>('workspace_members_list', {})
}

export function listAgentProjects(
  client: DataClient,
): Promise<Array<{ id: string; title: string }>> {
  return client.list('projects', '?select=id,title')
}

export function setAgentDefinitionEnabled(
  client: DataClient,
  input: { definitionId: string; enabled: boolean },
): Promise<AgentDefinition> {
  return client.rpc('set_agent_definition_enabled', {
    p_definition_id: input.definitionId,
    p_enabled: input.enabled,
  })
}

export function changeAgentPolicy(
  client: DataClient,
  input: {
    definitionId: string
    policy: AgentPolicy
    changeRef: string | null
    reason: string
    meaning: string
  },
): Promise<AgentPolicyRevision> {
  return client.rpc('change_agent_policy', {
    p_definition_id: input.definitionId,
    p_policy: input.policy,
    p_change_ref: input.changeRef,
    p_reason: input.reason,
    p_meaning: input.meaning,
  })
}

export function signAgentOperation(
  client: DataClient,
  input: { proposalId: string; expectedRevision: number; meaning: string },
): Promise<AgentOperationProposal> {
  return client.rpc('sign_agent_operation', {
    p_proposal_id: input.proposalId,
    p_expected_revision: input.expectedRevision,
    p_meaning: input.meaning,
  })
}

/** "25 Sep 10:12", the short stamp the board uses. */
export function shortStamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: undefined,
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value] as const),
  )
  const stamp = formatInstant(iso, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const month = (parts.get('month') ?? '').slice(0, 3)
  const match = /^(\d+)\s+\S+,?\s+(?:at\s+)?(\d{2}:\d{2})$/.exec(stamp)
  return match ? `${match[1]} ${month} ${match[2]}` : stamp
}

/** "22 Sep", or "Yesterday" for the day before `now`. */
export function shortDay(iso: string, now: Date): string {
  const day = new Date(iso)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return formatInstant(iso, { day: 'numeric', month: 'short' }).replace(
    'Sept',
    'Sep',
  )
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function runsThisWeek(
  runs: readonly AgentRun[],
  definitionId: string,
  now: Date,
): number {
  return runs.filter(
    (r) =>
      r.definition_id === definitionId &&
      now.getTime() - Date.parse(r.started_at) <= WEEK_MS,
  ).length
}

export function actionLabel(kind: string): string {
  if (kind.startsWith('notebook_block.')) return 'Propose notebook blocks'
  if (kind === 'record.create') return 'Create records'
  if (kind === 'record.comment.create') return 'Post a message'
  if (kind === 'dataset_rows.commit') return 'Change dataset values'
  if (kind.startsWith('pipeline_definition.')) return 'Change a pipeline'
  if (
    kind.startsWith('dataset_schema.') ||
    kind.startsWith('sheet_definition.')
  )
    return 'Draft a schema'
  return kind.replace(/[._]/g, ' ')
}

export type Risk = 'high' | 'medium' | 'low'

export function proposalRisk(proposal: AgentOperationProposal): Risk {
  const stated = (proposal.policy_evidence as { risk?: unknown }).risk
  if (stated === 'high' || stated === 'medium' || stated === 'low')
    return stated
  return proposal.risk_class === 'safe_draft' ? 'low' : 'medium'
}

export type ProposalStage = 'needs' | 'waiting' | 'decided'

/** Where a proposal sits for this person. A pending proposal is theirs when it
 * is routed to them, or to nobody in particular and they may approve it. */
export function proposalStage(
  proposal: AgentOperationProposal,
  me: { userId: string | null; canApprove: boolean },
): ProposalStage {
  if (proposal.status !== 'pending') return 'decided'
  if (proposal.approver_user_id)
    return proposal.approver_user_id === me.userId || me.canApprove
      ? proposal.approver_user_id === me.userId
        ? 'needs'
        : 'waiting'
      : 'waiting'
  return me.canApprove ? 'needs' : 'waiting'
}

export function proposalStatusLabel(
  proposal: AgentOperationProposal,
  stage: ProposalStage,
  nameOf: (userId: string | null) => string | null,
): string {
  switch (proposal.status) {
    case 'pending':
      if (stage === 'needs')
        return proposal.signature_required
          ? 'Needs your signature'
          : 'Needs your approval'
      return `Waiting on ${nameOf(proposal.approver_user_id) ?? 'an approver'}`
    case 'approved':
      return 'Approved'
    case 'executing':
      return 'Executing'
    case 'succeeded':
      return proposal.approved_by_user_id ? 'Approved · executed' : 'Executed'
    case 'rejected':
      return 'Rejected'
    case 'failed':
      return 'Execution failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return proposal.status
  }
}

/** "PR-0412" for a proposal, falling back to nothing when it has no number. */
export function proposalNumber(proposal: AgentOperationProposal): string {
  return proposal.display_id ?? ''
}

export interface ProposalEvidence {
  evidence: Array<{ label: string; value: string; href?: string }>
  confidence: { level: string; note: string } | null
  approverRole: string | null
}

export function proposalEvidence(
  proposal: AgentOperationProposal,
): ProposalEvidence {
  const raw = proposal.policy_evidence as Partial<{
    evidence: ProposalEvidence['evidence']
    confidence: ProposalEvidence['confidence']
    approverRole: string
  }>
  return {
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    confidence: raw.confidence ?? null,
    approverRole: raw.approverRole ?? null,
  }
}

export interface RenderedChange {
  sections: Array<{
    kind: 'unchanged' | 'added' | 'changed' | 'removed'
    title: string
    subtitle?: string
    table?: { columns: string[]; rows: string[][] }
    caption?: string
  }>
  footer?: string
}

/** What the agent says the change looks like, when it said. */
export function proposalRendered(
  proposal: AgentOperationProposal,
): RenderedChange | null {
  const rendered = (
    proposal.preview as unknown as { rendered?: RenderedChange }
  ).rendered
  return rendered && Array.isArray(rendered.sections) ? rendered : null
}

export interface ProposalSubject {
  identifier: string | null
  context: string | null
  label: string | null
}

export function proposalSubject(
  proposal: AgentOperationProposal,
): ProposalSubject {
  const target = proposal.policy_target as Partial<{
    identifier: string
    context: string
    label: string
  }>
  return {
    identifier: target.identifier ?? null,
    context: target.context ?? null,
    label: target.label ?? proposal.impact.target.label,
  }
}

/** "Revision 14 · Anna B. (QA)" style lines for the policy changes list. */
export function revisionTitle(
  revision: AgentPolicyRevision,
  nameOf: (userId: string | null) => string | null,
): string {
  const who = nameOf(revision.changed_by_user_id)
  return who
    ? `Revision ${revision.revision} · ${who}`
    : `Revision ${revision.revision}`
}

/** The word and tone a run shows, from its proposal when it made one. */
export function runStatus(
  run: AgentRun,
  proposal: AgentOperationProposal | undefined,
): { label: string; tone: 'review' | 'ok' | 'bad' | 'stored' } {
  if (proposal) {
    switch (proposal.status) {
      case 'pending':
        return { label: 'Proposed', tone: 'review' }
      case 'approved':
      case 'executing':
      case 'succeeded':
        return { label: 'Approved', tone: 'ok' }
      case 'rejected':
        return { label: 'Rejected', tone: 'bad' }
      case 'failed':
        return { label: 'Failed', tone: 'bad' }
      default:
        return { label: 'Cancelled', tone: 'stored' }
    }
  }
  switch (run.outcome) {
    case 'no_change':
      return { label: 'No change', tone: 'stored' }
    case 'sent':
      return { label: 'Sent', tone: 'ok' }
    case 'failed':
      return { label: 'Failed', tone: 'bad' }
    default:
      return run.summary === 'Rejected'
        ? { label: 'Rejected', tone: 'bad' }
        : { label: 'Approved', tone: 'ok' }
  }
}

/** The run's own line in the history: "#31 · PR-0412 · waiting for you". */
export function runLine(
  run: AgentRun,
  proposal: AgentOperationProposal | undefined,
  me: { userId: string | null; canApprove: boolean },
  nameOf: (userId: string | null) => string | null,
): string {
  const waiting =
    proposal?.status === 'pending'
      ? proposalStage(proposal, me) === 'needs'
        ? 'waiting for you'
        : `waiting on ${nameOf(proposal.approver_user_id) ?? 'an approver'}`
      : null
  return [`#${run.run_number}`, proposal?.display_id, waiting ?? run.detail]
    .filter(Boolean)
    .join(' · ')
}

/** What the Last run column says about the workflow. */
export function lastRunLabel(
  definition: AgentDefinition,
  last: AgentRun | undefined,
  proposal: AgentOperationProposal | undefined,
  me: { userId: string | null; canApprove: boolean },
  nameOf: (userId: string | null) => string | null,
): { label: string; tone: 'review' | 'ok' | 'bad' | 'stored' | 'warn' } | null {
  if (!definition.enabled) return { label: 'Paused', tone: 'warn' }
  if (!last) return null
  if (proposal?.status === 'pending') {
    return proposalStage(proposal, me) === 'needs'
      ? { label: last.summary || '1 proposal', tone: 'review' }
      : {
          label: `Waiting on ${nameOf(proposal.approver_user_id) ?? 'an approver'}`,
          tone: 'review',
        }
  }
  const status = runStatus(last, proposal)
  return { label: last.summary || status.label, tone: status.tone }
}

/** "10:12" today, "Yesterday", or "22 Sep". */
export function lastRunTime(iso: string, now: Date): string {
  const at = new Date(iso)
  if (at.toDateString() === now.toDateString())
    return formatInstant(iso, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  return shortDay(iso, now)
}

/** A short phrase for what a workflow's policy asks for, e.g. "Blocks need approval". */
export function policySummary(policy: AgentPolicy): string {
  const writes: Array<[string, PolicyMode]> = [
    ['Blocks', policy.notebook_blocks],
    ['Flags', policy.dataset_flags],
    ['Records', policy.create_records],
    ['Messages', policy.messages],
  ]
  const phrases = writes.flatMap(([name, mode]) =>
    mode === 'needs_approval'
      ? [`${name.toLowerCase()} need approval`]
      : mode === 'needs_signature'
        ? [`${name.toLowerCase()} need e-signature`]
        : [],
  )
  if (phrases.length === 0)
    return writes.some(([, mode]) => mode === 'allowed')
      ? 'Runs without asking'
      : 'Read-only'
  const text = phrases.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
