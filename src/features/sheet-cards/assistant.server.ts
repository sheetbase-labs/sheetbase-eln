/** The tools the model gets for sheets: cards that propose, nothing else. */
import { rpcFamily } from '#/lib/assistant-rpc-cards.server'

import { defineAssistantServer } from '../define.server'
import { SHEET_CARD_SPECS } from './cards.server'

const family = rpcFamily(SHEET_CARD_SPECS)

export const assistantServer = defineAssistantServer({
  proposalDefs: family.defs,
  isProposalTool: family.is,
  buildProposal: family.build,
})
