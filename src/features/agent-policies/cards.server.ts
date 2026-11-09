import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  AI_FEATURE_FLAGS,
  AI_FEATURE_FLAG_KEYS,
  readAiFeatureFlags,
} from '#/lib/ai-feature-flags'
import {
  AGENT_ACTIONS,
  agentActionAlwaysNever,
  agentActionByKey,
  describeAgentAction,
  resolveAgentActionLevel,
} from '#/lib/agent-action-policy'
import type {
  AgentActionPolicyRow,
  AgentActionRequestRow,
} from '#/lib/agent-action-policy'
import { likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import { parse, pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import {
  AGENT_OPERATION_POLICY_DISABLE_TOOL,
  AGENT_PERMISSION_SET_TOOL,
  AGENT_POLICY_PROPOSE_TOOL_NAMES,
  AGENT_REQUEST_DECIDE_TOOL,
  AGENT_SWITCH_TOOL,
  AI_FEATURES_SET_TOOL,
  proposeAgentPermissionSchema,
  proposeAgentRequestDecideSchema,
  proposeAgentSwitchSchema,
  proposeAiFeaturesSchema,
  proposeOperationPolicyDisableSchema,
} from './cards'
import type { AgentPolicyAction, AgentPolicyProposeToolName } from './cards'
import { agentActionAlwaysAsk } from './feature'

/**
 * Cards for agent permissions (see `cards.ts`). Each builder finds the
 * action, agent, policy or request the model named, under the signed-in
 * person's own access, and returns a card that says exactly what changes.
 * Nothing is written here; the button runs the ordinary RPC as the person.
 */

export type AgentPolicyOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

const SETTINGS = '/settings/workspace/ai'
const AGENTS = '/pipelines/agents'
const INBOX = '/inbox'

const LEVEL_WORDS: Record<string, string> = {
  auto: 'Auto: runs straight away',
  ask: 'Ask: waits for a person',
  never: 'Never',
}

export function isAgentPolicyProposalTool(
  name: string,
): name is AgentPolicyProposeToolName {
  return AGENT_POLICY_PROPOSE_TOOL_NAMES.includes(name)
}

export function agentPolicyProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      AGENT_PERMISSION_SET_TOOL,
      `Propose setting what agents may do with one lab action: Auto (runs straight away), Ask (waits for a person) or Never, for everyone or one role. Signing, submitting for review, amending, locking and deleting are always Never, and changes to agent permissions are never Auto. For people who manage the AI settings. ${NOTE}`,
      proposeAgentPermissionSchema,
    ),
    toolDef(
      AGENT_SWITCH_TOOL,
      `Propose switching an agent on the Agents page on or off. For its owner, an admin or a steward. ${NOTE}`,
      proposeAgentSwitchSchema,
    ),
    toolDef(
      AGENT_OPERATION_POLICY_DISABLE_TOOL,
      `Propose turning off a policy that lets a service credential run a kind of draft on its own; its drafts then wait for a person. For an admin or steward. ${NOTE}`,
      proposeOperationPolicyDisableSchema,
    ),
    toolDef(
      AGENT_REQUEST_DECIDE_TOOL,
      `Propose approving or rejecting an action an agent asked to take and is waiting for a person. Approving runs it as the person. Read the waiting requests first (sheetbase.lab.list, area agent_requests). ${NOTE}`,
      proposeAgentRequestDecideSchema,
    ),
    toolDef(
      AI_FEATURES_SET_TOOL,
      `Propose switching AI features on or off: this assistant, and what outside tools connected over MCP may do. For people who manage the AI settings. ${NOTE}`,
      proposeAiFeaturesSchema,
    ),
  ]
}

const fail = (message: string): AgentPolicyOutcome => ({ ok: false, message })

function card(
  tool: AgentPolicyProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: AgentPolicyAction
  },
): AgentPolicyOutcome {
  return {
    ok: true,
    proposal: { tool, title: input.title, summary: input.summary, ...rest },
  }
}

/** An action agents can be given a setting for, by its key or what it does. */
function findAction(text: string): Lookup<{ key: string; label: string }> {
  const wanted = text.trim().toLowerCase()
  const byKey = agentActionByKey(wanted.replace(/\s+/g, '_'))
  if (byKey) return { ok: true, value: { key: byKey.key, label: byKey.label } }
  if (agentActionAlwaysNever(wanted.replace(/\s+/g, '_'))) {
    return {
      ok: false,
      message:
        'That action is always a person’s own: an agent can never do it, whatever is set.',
    }
  }
  const words = wanted.split(/\s+/).filter(Boolean)
  const matches = AGENT_ACTIONS.filter((entry) =>
    words.every((word) =>
      `${entry.label} ${entry.key.replace(/_/g, ' ')}`
        .toLowerCase()
        .includes(word),
    ),
  )
  return pick(
    matches.map((entry) => ({ key: entry.key, label: entry.label })),
    text,
    'action',
    (row) => row.label,
    (row) => row.label.toLowerCase() === wanted,
  )
}

interface AgentRow {
  id: string
  display_id: string
  name: string
  enabled: boolean
}

async function findAgent(
  client: DataClient,
  text: string,
): Promise<Lookup<AgentRow>> {
  const like = likeValue(text)
  const rows = await client.list<AgentRow>(
    'agent_definitions',
    `?or=(name.ilike.${like},display_id.ilike.${like})&select=id,display_id,name,enabled&order=display_id.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'agent',
    (row) => `${row.name} (${row.display_id})`,
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id.toLowerCase() === lower,
  )
}

async function findOperationPolicy(
  client: DataClient,
  text: string,
): Promise<Lookup<{ id: string; name: string; enabled: boolean }>> {
  const rows = await client.list<{
    id: string
    name: string
    enabled: boolean
  }>(
    'agent_operation_policies',
    `?enabled=is.true&name=ilike.${likeValue(text)}&select=id,name,enabled&order=name.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'policy that is on',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findRequest(
  client: DataClient,
  text: string,
): Promise<Lookup<AgentActionRequestRow>> {
  const wanted = text.trim()
  const filter = UUID.test(wanted)
    ? `id=eq.${wanted}`
    : `or=(summary.ilike.${likeValue(wanted)},action_key.ilike.${likeValue(wanted.replace(/\s+/g, '_'))})`
  const rows = await client.list<AgentActionRequestRow>(
    'agent_action_requests',
    `?status=eq.pending&${filter}&select=*&order=created_at.desc&limit=6`,
  )
  return pick(
    rows,
    text,
    'waiting request',
    (row) => row.summary,
    (row) =>
      row.id === wanted || row.summary.toLowerCase() === wanted.toLowerCase(),
  )
}

export async function buildAgentPolicyProposal(
  name: AgentPolicyProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<AgentPolicyOutcome> {
  const { client, workspaceId } = context
  switch (name) {
    case AGENT_PERMISSION_SET_TOOL: {
      const parsed = parse(proposeAgentPermissionSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const action = findAction(input.action)
      if (!action.ok) return fail(action.message)
      if (input.level === 'auto' && agentActionAlwaysAsk(action.value.key)) {
        return fail(
          'Changes to what agents may do always wait for a person, so they cannot be set to Auto. Ask or Never are possible.',
        )
      }
      const role = input.role?.trim().toLowerCase() || null
      const policies = await client.list<AgentActionPolicyRow>(
        'agent_action_policies',
        `?action_key=eq.${encodeURIComponent(action.value.key)}&select=*`,
      )
      const before = resolveAgentActionLevel(policies, action.value.key, {
        role,
      })
      const after = input.level === 'default' ? 'ask' : input.level
      return card(name, input, {
        target: role ? `${action.value.label} · ${role}` : action.value.label,
        deepLink: SETTINGS,
        changes: [
          {
            label: role ? `Agents acting for a ${role}` : 'Agents',
            before: LEVEL_WORDS[before],
            after: LEVEL_WORDS[after],
          },
        ],
        action: {
          kind: 'agent_permission.set',
          workspaceId,
          actionKey: action.value.key,
          level: input.level,
          role,
        },
      })
    }

    case AGENT_SWITCH_TOOL: {
      const parsed = parse(proposeAgentSwitchSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const agent = await findAgent(client, input.agent)
      if (!agent.ok) return fail(agent.message)
      if (agent.value.enabled === input.enabled) {
        return fail(
          `${agent.value.name} is already ${input.enabled ? 'on' : 'off'}.`,
        )
      }
      return card(name, input, {
        target: `${agent.value.display_id} · ${agent.value.name}`,
        deepLink: AGENTS,
        changes: [
          {
            label: 'Agent',
            before: agent.value.enabled ? 'On' : 'Off',
            after: input.enabled ? 'On' : 'Off',
          },
        ],
        action: {
          kind: 'agent.switch',
          definitionId: agent.value.id,
          enabled: input.enabled,
        },
      })
    }

    case AGENT_OPERATION_POLICY_DISABLE_TOOL: {
      const parsed = parse(proposeOperationPolicyDisableSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const policy = await findOperationPolicy(client, input.policy)
      if (!policy.ok) return fail(policy.message)
      return card(name, input, {
        target: policy.value.name,
        deepLink: AGENTS,
        changes: [
          {
            label: 'Policy',
            before: 'On: drafts run on their own',
            after: 'Off: drafts wait for a person',
          },
        ],
        action: {
          kind: 'agent_operation_policy.disable',
          workspaceId,
          policyId: policy.value.id,
        },
      })
    }

    case AGENT_REQUEST_DECIDE_TOOL: {
      const parsed = parse(proposeAgentRequestDecideSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const request = await findRequest(client, input.request)
      if (!request.ok) return fail(request.message)
      const row = request.value
      return card(name, input, {
        target: row.summary,
        deepLink: INBOX,
        changes: [
          {
            label: 'Agent asks to',
            before: null,
            after: describeAgentAction(row.action_key, row.arguments),
          },
          {
            label: 'Request',
            before: 'Waiting',
            after: input.approve ? 'Approved and run as you' : 'Rejected',
          },
        ],
        action: {
          kind: 'agent_request.decide',
          requestId: row.id,
          actionKey: row.action_key,
          arguments: row.arguments,
          approve: input.approve,
          reason: input.reason?.trim() || null,
        },
      })
    }

    case AI_FEATURES_SET_TOOL: {
      const parsed = parse(proposeAiFeaturesSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const current = await readAiFeatureFlags(client, workspaceId)
      const next = { ...current }
      const changes: ProposalChange[] = []
      for (const key of AI_FEATURE_FLAG_KEYS) {
        const wanted = input.features[key]
        if (wanted === undefined || wanted === current[key]) continue
        next[key] = wanted
        const label =
          AI_FEATURE_FLAGS.find((flag) => flag.key === key)?.label ?? key
        changes.push({
          label,
          before: current[key] ? 'On' : 'Off',
          after: wanted ? 'On' : 'Off',
        })
      }
      if (changes.length === 0) {
        return fail('Those switches are already set that way.')
      }
      return card(name, input, {
        target: 'AI features',
        deepLink: SETTINGS,
        changes,
        action: { kind: 'ai_features.set', workspaceId, features: next },
      })
    }
  }
}
