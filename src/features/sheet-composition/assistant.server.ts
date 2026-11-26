/** The tools the model gets for sheet saves and layout updates: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildSheetCompositionProposal,
  isSheetCompositionProposalTool,
  sheetCompositionProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: sheetCompositionProposalDefs,
  isProposalTool: isSheetCompositionProposalTool,
  buildProposal: (name, args, context) =>
    isSheetCompositionProposalTool(name)
      ? buildSheetCompositionProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
