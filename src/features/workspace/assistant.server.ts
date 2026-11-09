/** Workspace tools for the model: a read that answers, and cards that propose. */
import {
  buildWorkspaceProposal,
  isWorkspaceProposalTool,
  workspaceProposalDefs,
} from './cards.server'
import {
  isWorkspaceReadTool,
  runWorkspaceReadTool,
  workspaceReadDefs,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: workspaceReadDefs,
  isReadTool: isWorkspaceReadTool,
  runReadTool: runWorkspaceReadTool,
  proposalDefs: workspaceProposalDefs,
  isProposalTool: isWorkspaceProposalTool,
  buildProposal: (name, args, context) =>
    isWorkspaceProposalTool(name)
      ? buildWorkspaceProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
