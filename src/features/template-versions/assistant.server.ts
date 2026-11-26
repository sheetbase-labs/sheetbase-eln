/** The tools the model gets for template versions: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildTemplateVersionsProposal,
  isTemplateVersionsProposalTool,
  templateVersionsProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: templateVersionsProposalDefs,
  isProposalTool: isTemplateVersionsProposalTool,
  buildProposal: (name, args, context) =>
    isTemplateVersionsProposalTool(name)
      ? buildTemplateVersionsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
