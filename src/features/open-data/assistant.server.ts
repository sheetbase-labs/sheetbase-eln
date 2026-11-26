/** The tools the model gets for ontology links and publishing: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildOpenDataProposal,
  isOpenDataProposalTool,
  openDataProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: openDataProposalDefs,
  isProposalTool: isOpenDataProposalTool,
  buildProposal: (name, args, context) =>
    isOpenDataProposalTool(name)
      ? buildOpenDataProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
