/** The plate-in-experiment card for the model: one proposal tool, no reads. */
import {
  buildPlateExperimentProposal,
  isPlateExperimentProposalTool,
  plateExperimentProposalDefs,
} from '#/lib/plate-experiment.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: plateExperimentProposalDefs,
  isProposalTool: isPlateExperimentProposalTool,
  buildProposal: (name, args, context) =>
    buildPlateExperimentProposal(name, args, context),
})
