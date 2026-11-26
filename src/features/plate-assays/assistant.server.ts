/** The tools the model gets for plates: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildPlateAssaysProposal,
  isPlateAssaysProposalTool,
  plateAssaysProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: plateAssaysProposalDefs,
  isProposalTool: isPlateAssaysProposalTool,
  buildProposal: (name, args, context) =>
    isPlateAssaysProposalTool(name)
      ? buildPlateAssaysProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
