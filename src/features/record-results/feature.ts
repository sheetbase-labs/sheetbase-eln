/**
 * Results on a record: every dataset row that links to a record, grouped by
 * measurement table, on the record's own page and on the API, MCP, the
 * assistant and in pipelines. Reading only, so it sends no events.
 */
import {
  RECORD_RESULTS_OPERATIONS,
  RECORD_RESULTS_READ_TOOL,
} from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'record-results',
  operations: RECORD_RESULTS_OPERATIONS,
  assistantReadTools: [RECORD_RESULTS_READ_TOOL],
})
