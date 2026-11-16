/**
 * Getting data into an experiment: open a dataset in a sheet, drop any
 * instrument file and see what it becomes. The first piece is the sheet that
 * shows a dataset's own columns, so "Open in a sheet" never needs a steward.
 */
import { defineFeature } from '../define'
import { DATA_IN_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'data-in',
  operations: DATA_IN_OPERATIONS,
})
