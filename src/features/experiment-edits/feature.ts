/**
 * Editing an experiment from the assistant: parts, gates and plans, blocks,
 * series, quality control, favourites, legal holds, record types and protocol
 * import. The operations themselves are declared with the other experiment
 * operations; this folder holds the cards.
 */
import { defineFeature } from '../define'
import {
  EXPERIMENT_EDITS_CARD_ACTIONS,
  EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES,
} from './cards'

export const feature = defineFeature({
  name: 'experiment-edits',
  assistantProposeTools: EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES,
  assistantCardActions: EXPERIMENT_EDITS_CARD_ACTIONS,
})
