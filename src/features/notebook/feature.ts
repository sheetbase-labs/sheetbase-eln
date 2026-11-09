/**
 * Notebook work: comments, files, protocols and approval requests, on the
 * API, MCP, the assistant, pipelines and webhooks.
 */
import { NOTEBOOK_READ_TOOL_NAMES } from '#/lib/assistant-notebook'
import { NOTEBOOK_LAB_TABLES } from './api-tables'
import { NOTEBOOK_OPERATIONS } from './operations'
import { WEBHOOK_SSE_PIPELINE, defineFeature } from '../define'

export const feature = defineFeature({
  name: 'notebook',
  operations: NOTEBOOK_OPERATIONS,
  events: [
    {
      name: 'file.uploaded',
      family: 'record',
      summary: 'A file was added.',
      producer: { entityType: 'file', operation: 'create' },
      wireName: 'file.uploaded',
      status: 'stable',
      introducedIn: 'lab-01',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes:
        'Payload carries fileId, recordId, displayName, mediaType, byteSize, version and status. It fires however the file was sent: the app, the API, a connector or the assistant.',
    },
    {
      name: 'file.version.added',
      family: 'record',
      summary: 'A new version of a file was added.',
      producer: { entityType: 'file', operation: 'update' },
      wireName: 'file.version.added',
      status: 'stable',
      introducedIn: 'lab-01',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes:
        'Payload carries effect `new_version`, version and previousVersionId.',
    },
    {
      name: 'file.deleted',
      family: 'record',
      summary: 'A file was deleted.',
      producer: { entityType: 'file', operation: 'delete' },
      wireName: 'file.deleted',
      status: 'stable',
      introducedIn: 'lab-01',
      consumers: WEBHOOK_SSE_PIPELINE,
    },
  ],
  labTables: NOTEBOOK_LAB_TABLES,
  agentArea: { area: 'Notebook', match: /comment|file|protocol|approval/ },
  // Deleting a file is allowed behind a confirmation: a deleted file can be
  // restored.
  agentMayDelete: ['delete_file'],
  assistantReadTools: NOTEBOOK_READ_TOOL_NAMES,
})
