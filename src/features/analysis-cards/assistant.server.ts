/** The tools the model gets for analyses and charts: cards that propose, nothing else. */
import { rpcFamily } from '#/lib/assistant-rpc-cards.server'

import { defineAssistantServer } from '../define.server'
import { ANALYSIS_CARD_SPECS } from './cards.server'

const family = rpcFamily(ANALYSIS_CARD_SPECS)

export const assistantServer = defineAssistantServer({
  proposalDefs: family.defs,
  isProposalTool: family.is,
  buildProposal: family.build,
})
