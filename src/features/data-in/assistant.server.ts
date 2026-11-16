/** The tool that puts a dataset in a sheet, offered to the model as a card. */
import {
  buildDataInProposal,
  dataInProposalDefs,
  isDataInProposalTool,
} from './cards.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: dataInProposalDefs,
  isProposalTool: isDataInProposalTool,
  buildProposal: (name, args, context) =>
    buildDataInProposal(name, args, context),
})
