/**
 * Agent action permissions.
 *
 * For each action an agent can take in the lab, an admin sets Auto (it runs
 * straight away), Ask (it waits for a person) or Never. The setting can be for
 * everyone, one role or one service credential; the most specific one wins and
 * the default is Ask. Signing, submitting for review, amending, locking and
 * deleting are always Never.
 *
 * The actions are the lab RPCs on the external allowlist (`lab-api-surface.ts`)
 * that change something. Reaching them through an agent, the rule is the same
 * whichever door it used, so a new lab action appears here with no extra
 * wiring. The database makes the same decision (`api.request_agent_action`);
 * this module is the copy the screens and the MCP tool read.
 */
import { LAB_RPCS } from './lab-api-surface'
import type { LabRpc } from './lab-api-surface'
import type { DataClient } from './data-client'

export const AGENT_ACTION_LEVELS = ['auto', 'ask', 'never'] as const
export type AgentActionLevel = (typeof AGENT_ACTION_LEVELS)[number]

export const AGENT_ACTION_DEFAULT_LEVEL: AgentActionLevel = 'ask'

export const AGENT_ACTION_ROLES = [
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const
export type AgentActionRole = (typeof AGENT_ACTION_ROLES)[number]

/** Same rule as `internal.agent_action_always_never` in the database. */
export function agentActionAlwaysNever(key: string): boolean {
  return (
    /(^|_)(sign|amend|lock|unlock|delete|destroy|purge)(_|$)/.test(key) ||
    /^submit_(experiment|record|review|notebook|for_review)/.test(key) ||
    [
      'submit_for_review',
      'decide_review',
      'release_sample',
      'approve_signature',
    ].includes(key)
  )
}

/** Which part of the lab an action belongs to, for grouping the list. */
export const AGENT_ACTION_AREAS = [
  'Orders and stock',
  'Samples',
  'Instruments',
  'Experiments',
  'Plates',
  'Shipments and requests',
  'Registry',
  'Studies and planning',
  'Reports and analysis',
  'Compliance',
  'Notebook',
  'People and workspace',
  'Other',
] as const
export type AgentActionArea = (typeof AGENT_ACTION_AREAS)[number]

export function agentActionArea(key: string): AgentActionArea {
  if (
    /invitation|(change|suspend|reinstate|remove)_member|set_member_|member_absence|hand_over_member|project_access|project_member|workspace_|client|settings_access|project_settings|user_session|study_task_client/.test(
      key,
    )
  )
    return 'People and workspace'
  if (/reagent|stocktake|material|solution|replacement_lot/.test(key))
    return 'Orders and stock'
  if (/sample|pool_/.test(key)) return 'Samples'
  if (/instrument|storage_reading|feed|recurring/.test(key))
    return 'Instruments'
  if (/study|dependency|task_resource|deliverable|workstream/.test(key))
    return 'Studies and planning'
  if (/report|analysis|chart/.test(key)) return 'Reports and analysis'
  if (/step|series|experiment/.test(key)) return 'Experiments'
  if (/plate/.test(key)) return 'Plates'
  if (/shipment|request/.test(key)) return 'Shipments and requests'
  if (/registry/.test(key)) return 'Registry'
  if (/legal_hold|retention|field_spec/.test(key)) return 'Compliance'
  if (/comment|file|protocol|approval/.test(key)) return 'Notebook'
  return 'Other'
}

export interface AgentActionEntry {
  key: string
  label: string
  area: AgentActionArea
  /** What it does, in a sentence. */
  description: string
  rpc: LabRpc
}

/**
 * The two calls that are how a request is made and closed, not things an agent
 * does in the lab, so they have no setting.
 */
const REQUEST_PLUMBING: ReadonlySet<string> = new Set([
  'request_agent_action',
  'finish_agent_action',
])

/** Every action an agent can ask to take: the lab RPCs that change something. */
export const AGENT_ACTIONS: readonly AgentActionEntry[] = Object.freeze(
  Object.entries(LAB_RPCS)
    .filter(
      ([key, rpc]) =>
        rpc.scope === 'lab:write' &&
        !REQUEST_PLUMBING.has(key) &&
        !agentActionAlwaysNever(key),
    )
    .map(([key, rpc]) => ({
      key,
      label: rpc.summary,
      area: agentActionArea(key),
      description: rpc.description,
      rpc,
    }))
    .sort(
      (a, b) =>
        AGENT_ACTION_AREAS.indexOf(a.area) -
          AGENT_ACTION_AREAS.indexOf(b.area) || a.label.localeCompare(b.label),
    ),
)

export function agentActionByKey(key: string): AgentActionEntry | undefined {
  return AGENT_ACTIONS.find((entry) => entry.key === key)
}

/** The actions that exist but can never be opened to an agent, for the list. */
export const AGENT_ACTIONS_ALWAYS_OFF: readonly {
  label: string
  reason: string
}[] = Object.freeze([
  { label: 'Sign', reason: 'A signature is always a person’s own act.' },
  {
    label: 'Submit for review',
    reason: 'Sending work for review is always a person’s call.',
  },
  { label: 'Amend', reason: 'Changing signed work stays with a person.' },
  {
    label: 'Lock',
    reason: 'Locking or unlocking a record stays with a person.',
  },
  { label: 'Delete', reason: 'Nothing an agent does can delete work.' },
])

export interface AgentActionPolicyRow {
  id: string
  workspace_id: string
  action_key: string
  subject_kind: 'everyone' | 'role' | 'credential'
  role: string | null
  credential_id: string | null
  level: AgentActionLevel
  updated_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface PolicySubject {
  role?: string | null
  credentialId?: string | null
}

/**
 * The level that applies, from the rows on file: a setting for the credential
 * beats one for the role, which beats the one for everyone, and with none the
 * answer is Ask. Mirrors `api.resolve_agent_action_level`.
 */
export function resolveAgentActionLevel(
  policies: readonly Pick<
    AgentActionPolicyRow,
    'action_key' | 'subject_kind' | 'role' | 'credential_id' | 'level'
  >[],
  actionKey: string,
  subject: PolicySubject = {},
): AgentActionLevel {
  if (agentActionAlwaysNever(actionKey)) return 'never'
  const forKey = policies.filter((row) => row.action_key === actionKey)
  const byCredential = subject.credentialId
    ? forKey.find(
        (row) =>
          row.subject_kind === 'credential' &&
          row.credential_id === subject.credentialId,
      )
    : undefined
  if (byCredential) return byCredential.level
  const byRole = subject.role
    ? forKey.find(
        (row) => row.subject_kind === 'role' && row.role === subject.role,
      )
    : undefined
  if (byRole) return byRole.level
  const everyone = forKey.find((row) => row.subject_kind === 'everyone')
  return everyone?.level ?? AGENT_ACTION_DEFAULT_LEVEL
}

export type AgentActionRequestStatus =
  'pending' | 'approved' | 'rejected' | 'succeeded' | 'failed' | 'refused'

export interface AgentActionRequestRow {
  id: string
  workspace_id: string
  action_key: string
  arguments: Record<string, unknown>
  summary: string
  level: AgentActionLevel
  status: AgentActionRequestStatus
  requested_by_user_id: string | null
  requested_by_credential_id: string | null
  provenance: Record<string, unknown>
  idempotency_key: string
  decided_by_user_id: string | null
  decided_at: string | null
  decision_reason: string | null
  executed_at: string | null
  result: unknown
  error: string | null
  created_at: string
  updated_at: string
}

export const agentActionKeys = {
  policies: ['agent-actions', 'policies'] as const,
  requests: ['agent-actions', 'requests'] as const,
}

export async function fetchAgentActionPolicies(
  client: Pick<DataClient, 'list'>,
): Promise<AgentActionPolicyRow[]> {
  return client.list<AgentActionPolicyRow>(
    'agent_action_policies',
    '?select=*&order=action_key.asc',
  )
}

export async function setAgentActionPolicy(
  client: Pick<DataClient, 'rpc'>,
  input: {
    workspaceId: string
    actionKey: string
    level: AgentActionLevel | 'default'
    role?: string | null
    credentialId?: string | null
  },
): Promise<AgentActionPolicyRow> {
  return client.rpc<AgentActionPolicyRow>('set_agent_action_policy', {
    p_workspace_id: input.workspaceId,
    p_action_key: input.actionKey,
    p_level: input.level,
    p_subject_kind: input.credentialId
      ? 'credential'
      : input.role
        ? 'role'
        : 'everyone',
    p_role: input.role ?? null,
    p_credential_id: input.credentialId ?? null,
  })
}

export async function fetchAgentActionRequests(
  client: Pick<DataClient, 'list'>,
  limit = 50,
): Promise<AgentActionRequestRow[]> {
  return client.list<AgentActionRequestRow>(
    'agent_action_requests',
    `?select=*&order=created_at.desc&limit=${limit}`,
  )
}

export async function fetchAgentActionRequest(
  client: Pick<DataClient, 'list'>,
  id: string,
): Promise<AgentActionRequestRow | null> {
  const rows = await client.list<AgentActionRequestRow>(
    'agent_action_requests',
    `?select=*&id=eq.${encodeURIComponent(id)}`,
  )
  return rows.at(0) ?? null
}

/** A plain-words line for an action and its arguments, for the approval card. */
export function describeAgentAction(
  actionKey: string,
  args: Record<string, unknown>,
): string {
  const entry = agentActionByKey(actionKey)
  const label = entry?.label ?? actionKey.replace(/_/g, ' ')
  const parts = Object.entries(args)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([name, value]) =>
        `${name.replace(/^p_/, '').replace(/_/g, ' ')}: ${
          typeof value === 'object' ? JSON.stringify(value) : String(value)
        }`,
    )
  return parts.length > 0 ? `${label} (${parts.join(', ')})` : label
}

/** A request a plugin operation made through MCP (see mcp/extensions.ts). */
export function isExtensionActionKey(key: string): boolean {
  return key.startsWith('plugin.')
}

/** Runs an approved plugin request on the server, as the person who approved. */
async function runExtensionRequest(
  args: Record<string, unknown>,
): Promise<unknown> {
  // The person pressed the button for this operation, so what it does inside
  // the app (`host_call`) is covered by that same yes.
  const { runPluginOperation } = await import('#/lib/extensions/run-client')
  const answer = await runPluginOperation<{ output?: unknown }>(
    {
      extensionKey: String(args.extensionKey),
      operationId: String(args.operationId),
      input: (args.input ?? {}) as Record<string, unknown>,
    },
    async () => true,
    'The plugin could not do that.',
  )
  return answer.output ?? null
}

export class AgentActionRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentActionRefusedError'
  }
}

/**
 * Approve a waiting request and run it as the person pressing the button. The
 * ordinary RPC runs with their own access, so what they are not allowed to do
 * still fails; the outcome is recorded on the request either way.
 */
export async function approveAndRunAgentAction(
  client: Pick<DataClient, 'rpc'>,
  request: Pick<AgentActionRequestRow, 'id' | 'action_key' | 'arguments'>,
): Promise<AgentActionRequestRow> {
  if (
    !isExtensionActionKey(request.action_key) &&
    !agentActionByKey(request.action_key)
  ) {
    throw new AgentActionRefusedError(
      'This is not an action the lab can run for an agent.',
    )
  }
  await client.rpc('decide_agent_action', {
    p_request_id: request.id,
    p_decision: 'approve',
  })
  return runApprovedAgentAction(client, request)
}

/** Actions whose answer holds a one-time secret that must not be kept in the request record. */
const SECRET_RESULT_KEYS: Readonly<
  Record<string, readonly string[] | undefined>
> = {
  create_invitation: ['token'],
  reissue_invitation: ['token'],
}

/** What of an action's answer may be written to its request record. */
export function recordableResult(action: string, result: unknown): unknown {
  const keys = SECRET_RESULT_KEYS[action]
  if (!keys || typeof result !== 'object' || result === null) return result
  const kept = { ...(result as Record<string, unknown>) }
  for (const key of keys) delete kept[key]
  return kept
}

/** Run an approved request and record how it ended. */
export async function runApprovedAgentAction(
  client: Pick<DataClient, 'rpc'>,
  request: Pick<AgentActionRequestRow, 'id' | 'action_key' | 'arguments'>,
): Promise<AgentActionRequestRow> {
  let result: unknown = null
  try {
    result = isExtensionActionKey(request.action_key)
      ? await runExtensionRequest(request.arguments)
      : await client.rpc(request.action_key, request.arguments)
  } catch (error) {
    return client.rpc<AgentActionRequestRow>('finish_agent_action', {
      p_request_id: request.id,
      p_ok: false,
      p_result: null,
      p_error: error instanceof Error ? error.message : 'The action failed.',
    })
  }
  return client.rpc<AgentActionRequestRow>('finish_agent_action', {
    p_request_id: request.id,
    p_ok: true,
    p_result:
      result === undefined
        ? null
        : recordableResult(request.action_key, result),
    p_error: null,
  })
}

export async function rejectAgentAction(
  client: Pick<DataClient, 'rpc'>,
  requestId: string,
  reason?: string,
): Promise<AgentActionRequestRow> {
  return client.rpc<AgentActionRequestRow>('decide_agent_action', {
    p_request_id: requestId,
    p_decision: 'reject',
    p_reason: reason ?? null,
  })
}
