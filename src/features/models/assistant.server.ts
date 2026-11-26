/** The tools the model gets for record types and their fields: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildModelsProposal,
  isModelsProposalTool,
  modelsProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: modelsProposalDefs,
  isProposalTool: isModelsProposalTool,
  buildProposal: (name, args, context) =>
    isModelsProposalTool(name)
      ? buildModelsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
