import { z } from 'zod'

import type { AgentActionRequestRow } from '#/lib/agent-action-policy'
import { assistantToolsFrom } from '#/lib/operations/descriptor'

import { AGENT_POLICY_OPERATIONS } from './operations'

/**
 * Agent permissions from the assistant: set what agents may do with an action,
 * switch an agent on or off, turn off an operation policy, switch an AI
 * feature on or off, and approve or reject what an agent asked to do.
 *
 * Every one is a card. Nothing happens until the person presses its button,
 * which calls the ordinary RPC in their own browser session, so the person
 * (not the assistant) is the one acting: giving agents more room is allowed
 * there, as it is on the settings page, and refused anywhere else.
 */

export const AGENT_PERMISSION_SET_TOOL = 'sheetbase.agent_permission.set'
export const AGENT_SWITCH_TOOL = 'sheetbase.agent.switch'

export const AGENT_OPERATION_POLICY_DISABLE_TOOL =
  'sheetbase.agent_operation_policy.disable'

export const AGENT_REQUEST_DECIDE_TOOL = 'sheetbase.agent_request.decide'
export const AI_FEATURES_SET_TOOL = 'sheetbase.ai_features.set'

export const AGENT_POLICY_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(AGENT_POLICY_OPERATIONS, 'propose')

export type AgentPolicyProposeToolName =
  | typeof AGENT_PERMISSION_SET_TOOL
  | typeof AGENT_SWITCH_TOOL
  | typeof AGENT_OPERATION_POLICY_DISABLE_TOOL
  | typeof AGENT_REQUEST_DECIDE_TOOL
  | typeof AI_FEATURES_SET_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeAgentPermissionSchema = z.strictObject({
  title,
  summary,
  action: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The action, by what it does (such as "place a reagent order") or its key.',
    ),
  level: z
    .enum(['auto', 'ask', 'never', 'default'])
    .describe(
      'auto runs straight away, ask waits for a person, never refuses; default goes back to Ask.',
    ),
  role: z
    .string()
    .max(40)
    .optional()
    .describe('Only for this role, such as scientist. Leave out for everyone.'),
})

export const proposeAgentSwitchSchema = z.strictObject({
  title,
  summary,
  agent: z
    .string()
    .min(1)
    .max(200)
    .describe('The agent, by its name or its AG- number.'),
  enabled: z
    .boolean()
    .describe('true to switch it on, false to switch it off.'),
})

export const proposeOperationPolicyDisableSchema = z.strictObject({
  title,
  summary,
  policy: z.string().min(1).max(200).describe('The policy, by its name.'),
})

export const proposeAgentRequestDecideSchema = z.strictObject({
  title,
  summary,
  request: z
    .string()
    .min(1)
    .max(400)
    .describe('The waiting request, by what it asks for or its id.'),
  approve: z.boolean(),
  reason: z.string().max(400).optional(),
})

export const AI_FEATURES = [
  'assistant',
  'mcp_read',
  'mcp_draft',
  'mcp_workflow',
  'mcp_admin_read',
  'mcp_admin_propose',
  'mcp_lab',
] as const

export type AiFeature = (typeof AI_FEATURES)[number]

// SAFETY: Each AI_FEATURES key becomes exactly one optional boolean schema.
export const proposeAiFeaturesSchema = z.strictObject({
  title,
  summary,
  features: z
    .strictObject(
      Object.fromEntries(
        AI_FEATURES.map((key) => [key, z.boolean().optional()]),
      ) as Record<AiFeature, z.ZodOptional<z.ZodBoolean>>,
    )
    .describe(
      'The switches to change, each true or false: assistant (this assistant), mcp_read (outside tools may read), mcp_draft (draft changes), mcp_workflow (run workflows), mcp_admin_read (read admin settings), mcp_admin_propose (propose admin changes), mcp_lab (take lab actions). Leave out what stays.',
    ),
})

export type AgentPolicyAction =
  | {
      kind: 'agent_permission.set'
      workspaceId: string
      actionKey: string
      level: 'auto' | 'ask' | 'never' | 'default'
      role: string | null
    }
  | { kind: 'agent.switch'; definitionId: string; enabled: boolean }
  | {
      kind: 'agent_operation_policy.disable'
      workspaceId: string
      policyId: string
    }
  | {
      kind: 'agent_request.decide'
      requestId: string
      actionKey: string
      arguments: AgentActionRequestRow['arguments']
      approve: boolean
      reason: string | null
    }
  | {
      kind: 'ai_features.set'
      workspaceId: string
      features: Record<string, boolean>
    }

const KINDS: readonly string[] = [
  'agent_permission.set',
  'agent.switch',
  'agent_operation_policy.disable',
  'agent_request.decide',
  'ai_features.set',
]

export function isAgentPolicyAction(action: {
  kind: string
}): action is AgentPolicyAction {
  return KINDS.includes(action.kind)
}
