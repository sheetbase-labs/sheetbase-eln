/**
 * Saved analyses and notebook charts from the assistant: save an analysis
 * view or definition, compose one from a chart, decide what to do about newer
 * data, and freeze, unfreeze or pin a chart or analysis block in a notebook.
 * The calls are declared with the planning and reporting operations; this
 * folder holds the cards.
 */
import { defineFeature } from '../define'
import { ANALYSIS_CARDS } from './cards'

export const feature = defineFeature({
  name: 'analysis-cards',
  assistantProposeTools: ANALYSIS_CARDS.map((card) => card.tool),
  assistantCardActions: Object.fromEntries(
    ANALYSIS_CARDS.map((card) => [card.tool, card.does]),
  ),
  assistantCovers: Object.fromEntries(
    ANALYSIS_CARDS.flatMap((card) =>
      card.covers.map((rpc) => [rpc, card.tool]),
    ),
  ),
})
