/** Analysis tools for the model: a read that answers with numbers, and a card that proposes. */
import {
  analysisProposalDefs,
  analysisReadDefs,
  buildAnalysisProposal,
  isAnalysisProposalTool,
  isAnalysisReadTool,
  runAnalysisReadTool,
} from '#/lib/results-analysis.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: analysisReadDefs,
  isReadTool: isAnalysisReadTool,
  runReadTool: runAnalysisReadTool,
  proposalDefs: analysisProposalDefs,
  isProposalTool: isAnalysisProposalTool,
  buildProposal: (name, args, context) =>
    buildAnalysisProposal(name, args, context),
})
