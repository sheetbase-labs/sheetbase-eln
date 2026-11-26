/** The tools the model gets for project access: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildProjectAccessProposal,
  isProjectAccessProposalTool,
  projectAccessProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: projectAccessProposalDefs,
  isProposalTool: isProjectAccessProposalTool,
  buildProposal: (name, args, context) =>
    isProjectAccessProposalTool(name)
      ? buildProjectAccessProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
