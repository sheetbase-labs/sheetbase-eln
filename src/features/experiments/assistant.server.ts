/** Experiment, alias, plan and label template cards the model can propose. */
import {
  buildExperimentProposal,
  experimentProposalDefs,
  isExperimentProposalTool,
} from '#/lib/assistant-experiments.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: experimentProposalDefs,
  isProposalTool: isExperimentProposalTool,
  buildProposal: (name, args, context) =>
    isExperimentProposalTool(name)
      ? buildExperimentProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
