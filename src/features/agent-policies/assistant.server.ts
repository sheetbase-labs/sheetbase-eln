/** Agent tools for the model: a read that answers, and cards that propose. */
import { defineAssistantServer } from '../define.server'
import {
  agentPolicyProposalDefs,
  buildAgentPolicyProposal,
  isAgentPolicyProposalTool,
} from './cards.server'
import {
  agentsReadDefs,
  isAgentsReadTool,
  runAgentsReadTool,
} from './read.server'

export const assistantServer = defineAssistantServer({
  readDefs: agentsReadDefs,
  isReadTool: isAgentsReadTool,
  runReadTool: runAgentsReadTool,
  proposalDefs: agentPolicyProposalDefs,
  isProposalTool: isAgentPolicyProposalTool,
  buildProposal: (name, args, context) =>
    isAgentPolicyProposalTool(name)
      ? buildAgentPolicyProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
