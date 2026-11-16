import { z } from 'zod'

import { DATA_IN_OPERATIONS } from './operations'
import { assistantToolsFrom } from '#/lib/operations/descriptor'

/**
 * Put a dataset in a sheet, from the assistant. The model names the dataset
 * (and the experiment) the way the lab does, the server finds them and sends
 * back a card, and nothing happens until the person presses the button, which
 * calls the ordinary RPC as them.
 */

export const SHEET_OPEN_DATASET_TOOL = 'sheetbase.sheet.open_dataset'

export const DATA_IN_PROPOSE_TOOL_NAMES: readonly string[] = assistantToolsFrom(
  DATA_IN_OPERATIONS,
  'propose',
)

export type DataInProposeToolName = typeof SHEET_OPEN_DATASET_TOOL

export const openDatasetInSheetSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  dataset: z
    .string()
    .min(1)
    .max(200)
    .describe('The dataset, by name or ID such as DS-0311.'),
  experiment: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The experiment to put the sheet in, by ID such as EXP-12 or title. Leave out for a sheet that belongs to no notebook.',
    ),
  name: z.string().min(1).max(200).optional().describe('The sheet’s name.'),
})

export type DataInAction = {
  kind: 'sheet.open_dataset'
  datasetId: string
  notebookRecordId: string | null
  name: string | null
}

const KINDS: readonly string[] = ['sheet.open_dataset']

export function isDataInAction(action: {
  kind: string
}): action is DataInAction {
  return KINDS.includes(action.kind)
}
