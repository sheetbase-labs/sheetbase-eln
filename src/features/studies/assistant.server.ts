/** The tools the model gets for studies and the planner: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildStudiesProposal,
  isStudiesProposalTool,
  studiesProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: studiesProposalDefs,
  isProposalTool: isStudiesProposalTool,
  buildProposal: (name, args, context) =>
    isStudiesProposalTool(name)
      ? buildStudiesProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
