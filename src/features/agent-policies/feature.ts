/**
 * Agent permissions: what agents may do on their own (Auto, Ask or Never), the
 * agents on the Agents page, their signed policies, operation policies, the
 * requests agents make and the AI switches.
 *
 * The rule across every surface: away from the app (a token, MCP, a plugin
 * without a person's confirmation, a pipeline) what agents may do can only be
 * tightened. Widening is asked for with `request_agent_action`, and those
 * requests always wait for a person; the database enforces this
 * (`internal.agent_action_always_ask`, `internal.is_person_in_app`).
 */
import { defineFeature } from '../define'
import { AGENT_POLICY_LAB_TABLES } from './api-tables'
import { AGENT_POLICY_EVENT_LABELS, AGENT_POLICY_EVENTS } from './events'
import { AGENT_POLICY_OPERATIONS } from './operations'

/**
 * Actions that change what agents may do. An agent may ask for them but the
 * request always waits for someone who manages the AI settings: they cannot be
 * set to Auto. Same list as `internal.agent_action_always_ask`.
 */
export const AGENT_PERMISSION_ACTIONS: readonly string[] = Object.freeze([
  'set_agent_action_policy',
  'set_agent_definition_enabled',
  'disable_agent_operation_policy',
  'update_workspace_ai_feature_flags',
  'update_workspace_ai_settings',
])

/** Lists agents, their settings and policies; answers in the reply. */
export const AGENTS_READ_TOOL = 'sheetbase.agents.list'

export function agentActionAlwaysAsk(key: string): boolean {
  return AGENT_PERMISSION_ACTIONS.includes(key)
}

/**
 * What stays off the token API, and why. Each is a person's own act in the
 * app: an approval or a signature.
 */
const NOT_EXPOSED: Readonly<Record<string, string>> = {
  decide_agent_action:
    'Approving or rejecting what an agent asked to do is a person’s decision in the app; tokens and pipelines are refused, so an agent never approves its own request. The assistant offers it as a card the person presses.',
  decide_agent_operation:
    'Approving or rejecting an agent’s proposal is a person’s decision in the app; credentials are refused.',
  execute_agent_operation:
    'Running an approved proposal is done by the person who approved it, in the app; agents never run proposals for a person.',
  sign_agent_operation:
    'An electronic signature on a proposal is always a person’s own act.',
  change_agent_policy:
    'Changing an agent’s policy is signed by a policy manager in the app. To tighten an agent from a token, switch it off with set_agent_definition_enabled.',
  create_agent_operation_policy:
    'Letting a credential run drafts on its own widens what agents may do and is signed in the app. Turning one off is open: disable_agent_operation_policy.',
  resume_agent_workflow:
    'Resuming a paused workflow lets it carry on spending and acting; a person does it in the app. Pausing and cancelling are open.',
  can_run_ai_evals:
    'Tells the AI settings page whether this person may run the assistant checks; finished runs are on ai_eval_runs.',
  agent_admin_credentials:
    'Lists service credentials with their prefixes for the admin MCP tool, which is gated on its own; tokens read agent permissions per credential on agent_action_policies.',
}

export const feature = defineFeature({
  name: 'agent-policies',
  operations: AGENT_POLICY_OPERATIONS,
  events: AGENT_POLICY_EVENTS,
  eventLabels: AGENT_POLICY_EVENT_LABELS,
  labTables: AGENT_POLICY_LAB_TABLES,
  notExposed: NOT_EXPOSED,
  // Before the built-in groups and People: `update_workspace_ai_settings`
  // would otherwise land under the workspace, and requests under Shipments.
  agentArea: {
    area: 'Agents and AI',
    match: /(^|_)agents?(_|$)|watcher|^update_workspace_ai_/,
    beforeCore: true,
  },
  assistantReadTools: [AGENTS_READ_TOOL],
})
