/** The tools the model gets for instrument set-up: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildInstrumentSetupProposal,
  instrumentSetupProposalDefs,
  isInstrumentSetupProposalTool,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: instrumentSetupProposalDefs,
  isProposalTool: isInstrumentSetupProposalTool,
  buildProposal: (name, args, context) =>
    isInstrumentSetupProposalTool(name)
      ? buildInstrumentSetupProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
