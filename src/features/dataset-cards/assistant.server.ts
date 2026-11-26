/** The tools the model gets for datasets: cards that propose, nothing else. */
import { rpcFamily } from '#/lib/assistant-rpc-cards.server'

import { defineAssistantServer } from '../define.server'
import { DATASET_CARD_SPECS } from './cards.server'

const family = rpcFamily(DATASET_CARD_SPECS)

export const assistantServer = defineAssistantServer({
  proposalDefs: family.defs,
  isProposalTool: family.is,
  buildProposal: family.build,
})
