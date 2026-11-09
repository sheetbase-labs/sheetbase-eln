import {
  approveAndRunAgentAction,
  rejectAgentAction,
} from '#/lib/agent-action-policy'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { AgentPolicyAction } from './cards'

/**
 * Runs an agent permissions card's action. Loaded only in the browser, when a
 * button is pressed, so it runs in the person's own session: they, not the
 * assistant, are the one acting.
 */
export async function runAgentPolicyAction(
  client: DataClient,
  action: AgentPolicyAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'agent_permission.set':
      await client.rpc('set_agent_action_policy', {
        p_workspace_id: action.workspaceId,
        p_action_key: action.actionKey,
        p_level: action.level,
        p_subject_kind: action.role ? 'role' : 'everyone',
        p_role: action.role,
        p_credential_id: null,
      })

      return { openHref: '/settings/workspace/ai' }
    case 'agent.switch':
      await client.rpc('set_agent_definition_enabled', {
        p_definition_id: action.definitionId,
        p_enabled: action.enabled,
      })

      return { openHref: '/pipelines/agents' }
    case 'agent_operation_policy.disable':
      await client.rpc('disable_agent_operation_policy', {
        p_workspace_id: action.workspaceId,
        p_policy_id: action.policyId,
      })

      return { openHref: '/pipelines/agents' }
    case 'agent_request.decide':
      if (action.approve) {
        const done = await approveAndRunAgentAction(client, {
          id: action.requestId,
          action_key: action.actionKey,
          arguments: action.arguments,
        })

        if (done.status === 'failed') {
          throw new Error(done.error ?? 'The action failed.')
        }
      } else {
        await rejectAgentAction(
          client,
          action.requestId,
          action.reason ?? undefined,
        )
      }

      return { openHref: '/inbox' }
    case 'ai_features.set':
      await client.rpc('update_workspace_ai_feature_flags', {
        p_workspace_id: action.workspaceId,
        p_feature_flags: action.features,
      })

      return { openHref: '/settings/workspace/ai' }
  }
}
