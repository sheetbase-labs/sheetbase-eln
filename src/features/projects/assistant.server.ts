/** Projects tools for the model: a read that answers, and cards that propose. */
import {
  buildProjectsProposal,
  isProjectsProposalTool,
  projectsProposalDefs,
} from './cards.server'
import {
  isProjectsReadTool,
  projectsReadDefs,
  runProjectsReadTool,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: projectsReadDefs,
  isReadTool: isProjectsReadTool,
  runReadTool: runProjectsReadTool,
  proposalDefs: projectsProposalDefs,
  isProposalTool: isProjectsProposalTool,
  buildProposal: (name, args, context) =>
    isProjectsProposalTool(name)
      ? buildProjectsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
