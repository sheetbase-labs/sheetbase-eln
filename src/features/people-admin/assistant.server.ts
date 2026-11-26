/** The tools the model gets for people and clients: cards that propose, nothing else. */
import { defineAssistantServer } from '../define.server'
import {
  buildPeopleAdminProposal,
  isPeopleAdminProposalTool,
  peopleAdminProposalDefs,
} from './cards.server'

export const assistantServer = defineAssistantServer({
  proposalDefs: peopleAdminProposalDefs,
  isProposalTool: isPeopleAdminProposalTool,
  buildProposal: (name, args, context) =>
    isPeopleAdminProposalTool(name)
      ? buildPeopleAdminProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
