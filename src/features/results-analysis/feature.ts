/**
 * Results analysis: the assistant fits curves, reads standard curves and
 * compares groups on a dataset, and adds the result to an experiment's
 * notebook as a draft. The same analysis is a plugin operation, so the API,
 * MCP and pipelines run it on rows they send.
 */
import { ANALYSIS_READ_TOOL_NAMES } from '#/lib/results-analysis'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'results-analysis',
  assistantReadTools: ANALYSIS_READ_TOOL_NAMES,
})
