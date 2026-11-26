/**
 * Datasets, measurement tables and column promotion from the assistant: add
 * rows to a dataset, make a dataset from a list of columns, add columns to
 * it, and move a sheet's own column or calculation into a dataset or record
 * type. The calls are declared with the datasets feature; this folder holds
 * the cards.
 */
import { defineFeature } from '../define'
import { DATASET_CARDS } from './cards'

export const feature = defineFeature({
  name: 'dataset-cards',
  assistantProposeTools: DATASET_CARDS.map((card) => card.tool),
  assistantCardActions: Object.fromEntries(
    DATASET_CARDS.map((card) => [card.tool, card.does]),
  ),
  assistantCovers: Object.fromEntries(
    DATASET_CARDS.flatMap((card) => card.covers.map((rpc) => [rpc, card.tool])),
  ),
})
