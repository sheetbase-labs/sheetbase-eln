/**
 * Read one kind of result across datasets: the rows of a measurement table
 * from every dataset a person can open, live or pinned to snapshots, with the
 * dataset and snapshot of each row. On the API, MCP, the assistant (which can
 * also analyse it), pipeline actions and the Results tab of a measurement table.
 */
import { MEASUREMENT_RESULTS_OPERATIONS } from './operations'
import { MEASUREMENT_RESULTS_READ_TOOL_NAMES } from './tool'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'measurement-results',
  operations: MEASUREMENT_RESULTS_OPERATIONS,
  agentArea: {
    area: 'Results across datasets',
    match: /measurement_table_(rows|sources)/,
    beforeCore: true,
  },
  assistantReadTools: MEASUREMENT_RESULTS_READ_TOOL_NAMES,
})
