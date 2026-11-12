/** Pipeline connection tools for the model: a read that answers, and cards that propose. */
import { defineAssistantServer } from '../define.server'
import {
  buildPipelineConnectionProposal,
  isPipelineConnectionProposalTool,
  pipelineConnectionProposalDefs,
} from './cards.server'
import {
  isPipelineConnectionsReadTool,
  pipelineConnectionsReadDefs,
  runPipelineConnectionsReadTool,
} from './read.server'

export const assistantServer = defineAssistantServer({
  readDefs: pipelineConnectionsReadDefs,
  isReadTool: isPipelineConnectionsReadTool,
  runReadTool: runPipelineConnectionsReadTool,
  proposalDefs: pipelineConnectionProposalDefs,
  isProposalTool: isPipelineConnectionProposalTool,
  buildProposal: (name, args, context) =>
    isPipelineConnectionProposalTool(name)
      ? buildPipelineConnectionProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
