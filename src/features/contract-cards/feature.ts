/**
 * Data contracts and lineage targets from the assistant: save, import and
 * delete a contract, remove one of its rules, and set up, delete or retry a
 * lineage target. The calls are declared with the data contract and
 * provenance operations; this folder holds the cards.
 */
import { defineFeature } from '../define'
import { CONTRACT_CARDS } from './cards'

export const feature = defineFeature({
  name: 'contract-cards',
  assistantProposeTools: CONTRACT_CARDS.map((card) => card.tool),
  assistantCardActions: Object.fromEntries(
    CONTRACT_CARDS.map((card) => [card.tool, card.does]),
  ),
  assistantCovers: Object.fromEntries(
    CONTRACT_CARDS.flatMap((card) =>
      card.covers.map((rpc) => [rpc, card.tool]),
    ),
  ),
})
