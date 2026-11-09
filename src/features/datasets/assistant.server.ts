/** Dataset and measurement table cards for the model: each proposes, and changes nothing. */
import {
  buildDatasetsProposal,
  datasetsProposalDefs,
  isDatasetsProposalTool,
} from '#/lib/assistant-datasets.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: datasetsProposalDefs,
  isProposalTool: isDatasetsProposalTool,
  buildProposal: (name, args, context) =>
    isDatasetsProposalTool(name)
      ? buildDatasetsProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
