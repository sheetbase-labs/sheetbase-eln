/** Agent permission cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isAgentPolicyAction } from './cards'
import type { AgentPolicyAction, AgentPolicyProposeToolName } from './cards'

const words = (key: string) => `features.agentPolicies.cards.${key}`

export const assistant = defineAssistant<
  AgentPolicyAction,
  AgentPolicyProposeToolName
>()({
  isAction: isAgentPolicyAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed, in the person's session.
    const { runAgentPolicyAction } = await import('./cards-run')

    return runAgentPolicyAction(client, action)
  },
  cardWords: {
    'agent_permission.set': words('setAgentPermission'),
    'agent.switch': words('switchAgent'),
    'agent_operation_policy.disable': words('turnOffAgentPolicy'),
    'agent_request.decide': words('decideAgentRequest'),
    'ai_features.set': words('setAiFeatures'),
  },
})
