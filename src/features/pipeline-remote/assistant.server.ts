/** Tools for the model: a read that answers, and a card that proposes. */
import {
  buildPipelineRemoteProposal,
  isPipelineRemoteProposalTool,
  pipelineRemoteProposalDefs,
} from './cards.server'
import {
  isPipelineRemoteReadTool,
  pipelineRemoteReadDefs,
  runPipelineRemoteReadTool,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: pipelineRemoteReadDefs,
  isReadTool: isPipelineRemoteReadTool,
  runReadTool: runPipelineRemoteReadTool,
  proposalDefs: pipelineRemoteProposalDefs,
  isProposalTool: isPipelineRemoteProposalTool,
  buildProposal: (name, args, context) =>
    isPipelineRemoteProposalTool(name)
      ? buildPipelineRemoteProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
