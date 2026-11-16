/**
 * Results analysis: the assistant fits curves, reads standard curves and
 * compares groups on a dataset, and adds the result to an experiment's
 * notebook as a draft. The same analysis is a plugin operation, so the API,
 * MCP and pipelines run it on rows they send. A saved analysis goes into a
 * notebook as a live block through `add_analysis_to_notebook`.
 */
import { ANALYSIS_READ_TOOL_NAMES } from '#/lib/results-analysis'
import { defineFeature } from '../define'
import { RESULTS_ANALYSIS_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'results-analysis',
  operations: RESULTS_ANALYSIS_OPERATIONS,
  assistantReadTools: ANALYSIS_READ_TOOL_NAMES,
  eventLabels: {
    'analysis.added_to_notebook': 'An analysis is added to a notebook',
  },
})
