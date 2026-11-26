/** The tools the model gets for reports: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildReportsProposal,
  isReportsProposalTool,
  reportsProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: reportsProposalDefs,
  isProposalTool: isReportsProposalTool,
  buildProposal: (name, args, context) =>
    isReportsProposalTool(name)
      ? buildReportsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
