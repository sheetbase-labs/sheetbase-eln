/** The plan tool for the model: one card that carries several steps. */
import { defineAssistantServer } from '../define.server'
import {
  buildPlanProposal,
  isPlanProposalTool,
  planProposalDefs,
} from './plan.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: planProposalDefs,
  isProposalTool: isPlanProposalTool,
  buildProposal: (name, args, context) =>
    isPlanProposalTool(name)
      ? buildPlanProposal(args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
