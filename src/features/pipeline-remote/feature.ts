/**
 * Remote jobs and lakehouse SQL in pipelines: two step kinds that reach
 * outside the run's own database. A remote job sends a script to an HPC queue
 * and the run waits for it, possibly for hours; a lakehouse step runs
 * read-only SQL over the open tables once a data steward has allowed it.
 * Declared for the API, MCP, the assistant, pipelines and webhooks.
 */
import { PIPELINE_REMOTE_LAB_TABLES } from './api-tables'
import { PIPELINE_REMOTE_READ_TOOL_NAMES } from './cards'
import { PIPELINE_REMOTE_EVENTS, PIPELINE_REMOTE_EVENT_LABELS } from './events'
import { PIPELINE_REMOTE_NOT_EXPOSED } from './exemptions'
import { PIPELINE_REMOTE_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'pipeline-remote',
  operations: PIPELINE_REMOTE_OPERATIONS,
  events: PIPELINE_REMOTE_EVENTS,
  eventLabels: PIPELINE_REMOTE_EVENT_LABELS,
  labTables: PIPELINE_REMOTE_LAB_TABLES,
  notExposed: PIPELINE_REMOTE_NOT_EXPOSED,
  agentArea: {
    area: 'Remote jobs and lakehouse SQL',
    match: /pipeline_lakehouse/,
  },
  assistantReadTools: PIPELINE_REMOTE_READ_TOOL_NAMES,
})
