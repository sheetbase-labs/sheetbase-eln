/** The tool the model gets for start rules: a card that proposes, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildStartRulesProposal,
  isStartRulesProposalTool,
  startRulesProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: startRulesProposalDefs,
  isProposalTool: isStartRulesProposalTool,
  buildProposal: (name, args, context) =>
    isStartRulesProposalTool(name)
      ? buildStartRulesProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
