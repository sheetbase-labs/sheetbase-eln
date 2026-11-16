/** Undo tools for the model: a read that finds what can be undone, and the card that undoes it. */
import {
  buildChangesProposal,
  changesProposalDefs,
  changesReadDefs,
  isChangesProposalTool,
  isChangesReadTool,
  runChangesReadTool,
} from './cards.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: changesReadDefs,
  isReadTool: isChangesReadTool,
  runReadTool: runChangesReadTool,
  proposalDefs: changesProposalDefs,
  isProposalTool: isChangesProposalTool,
  buildProposal: (name, args, context) =>
    isChangesProposalTool(name)
      ? buildChangesProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
