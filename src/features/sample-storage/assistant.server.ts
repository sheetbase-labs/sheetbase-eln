/** The tools the model gets for samples and storage: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildSampleStorageProposal,
  isSampleStorageProposalTool,
  sampleStorageProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: sampleStorageProposalDefs,
  isProposalTool: isSampleStorageProposalTool,
  buildProposal: (name, args, context) =>
    isSampleStorageProposalTool(name)
      ? buildSampleStorageProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
