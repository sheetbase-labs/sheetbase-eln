/**
 * Reusable pipeline parameter sets: named lists of parameters a workspace
 * keeps once and pipelines `include` by key, on the API, MCP, the assistant,
 * pipelines and webhooks.
 */
import { defineFeature } from '../define'
import { PARAMETER_SET_LAB_TABLES } from './api-tables'
import { PARAMETER_SET_EVENT_LABELS, PARAMETER_SET_EVENTS } from './events'
import { PARAMETER_SET_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'pipeline-parameter-sets',
  operations: PARAMETER_SET_OPERATIONS,
  events: PARAMETER_SET_EVENTS,
  eventLabels: PARAMETER_SET_EVENT_LABELS,
  labTables: PARAMETER_SET_LAB_TABLES,
  agentArea: {
    area: 'Pipelines and plugins',
    match: /parameter_set/,
    beforeCore: true,
  },
})
