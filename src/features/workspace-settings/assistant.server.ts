/** The tools the model gets for workspace settings: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildWorkspaceSettingsProposal,
  isWorkspaceSettingsProposalTool,
  workspaceSettingsProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: workspaceSettingsProposalDefs,
  isProposalTool: isWorkspaceSettingsProposalTool,
  buildProposal: (name, args, context) =>
    isWorkspaceSettingsProposalTool(name)
      ? buildWorkspaceSettingsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
