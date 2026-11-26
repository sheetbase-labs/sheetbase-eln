/** The tools the model gets for automation: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildAutomationAdminProposal,
  automationAdminProposalDefs,
  isAutomationAdminProposalTool,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: automationAdminProposalDefs,
  isProposalTool: isAutomationAdminProposalTool,
  buildProposal: (name, args, context) =>
    isAutomationAdminProposalTool(name)
      ? buildAutomationAdminProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
