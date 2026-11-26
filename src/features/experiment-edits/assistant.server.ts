/** The tools the model gets for editing experiments: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildExperimentEditsProposal,
  experimentEditsProposalDefs,
  isExperimentEditsProposalTool,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: experimentEditsProposalDefs,
  isProposalTool: isExperimentEditsProposalTool,
  buildProposal: (name, args, context) =>
    isExperimentEditsProposalTool(name)
      ? buildExperimentEditsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
