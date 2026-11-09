/** Pipeline and plugin cards the model can propose. */
import {
  buildPipelinesProposal,
  isPipelinesProposalTool,
  pipelinesProposalDefs,
} from '#/lib/assistant-pipelines.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: pipelinesProposalDefs,
  isProposalTool: isPipelinesProposalTool,
  buildProposal: (name, args, context) =>
    isPipelinesProposalTool(name)
      ? buildPipelinesProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
