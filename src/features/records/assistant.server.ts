/** The tools the model gets for records: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildRecordsProposal,
  isRecordsProposalTool,
  recordsProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: recordsProposalDefs,
  isProposalTool: isRecordsProposalTool,
  buildProposal: (name, args, context) =>
    isRecordsProposalTool(name)
      ? buildRecordsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
