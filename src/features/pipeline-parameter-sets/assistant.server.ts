/** Parameter set cards the model can propose. */
import { defineAssistantServer } from '../define.server'
import {
  buildParameterSetProposal,
  isParameterSetProposalTool,
  parameterSetProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: parameterSetProposalDefs,
  isProposalTool: isParameterSetProposalTool,
  buildProposal: (name, args, context) =>
    isParameterSetProposalTool(name)
      ? buildParameterSetProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
