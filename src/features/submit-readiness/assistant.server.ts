/** The tool the model gets for submit readiness: a card that proposes, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildSubmitReadinessProposal,
  isSubmitReadinessProposalTool,
  submitReadinessProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: submitReadinessProposalDefs,
  isProposalTool: isSubmitReadinessProposalTool,
  buildProposal: (name, args, context) =>
    isSubmitReadinessProposalTool(name)
      ? buildSubmitReadinessProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
