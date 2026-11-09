/** People and workspace cards the model can propose. */
import {
  buildPeopleProposal,
  isPeopleProposalTool,
  peopleProposalDefs,
} from '#/lib/assistant-people.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: peopleProposalDefs,
  isProposalTool: isPeopleProposalTool,
  buildProposal: (name, args, context) =>
    isPeopleProposalTool(name)
      ? buildPeopleProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
