/**
 * Projects, folders, following and the Inbox, the audit log and its check,
 * and the steward's SQL logins, on the API, MCP, the assistant, pipelines and
 * webhooks.
 */
import { PROJECTS_LAB_TABLES } from './api-tables'
import { PROJECTS_EVENTS, PROJECTS_EVENT_LABELS } from './events'
import { PROJECTS_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'projects',
  operations: PROJECTS_OPERATIONS,
  events: PROJECTS_EVENTS,
  eventLabels: PROJECTS_EVENT_LABELS,
  labTables: PROJECTS_LAB_TABLES,
  agentArea: {
    area: 'Projects, folders and audit',
    match:
      /project|folder|follow_record|audit|trail_evidence|sql_login|notification|work_items|recent_view/,
  },
  // A folder that holds records cannot be deleted, so deleting one only
  // removes an empty grouping, behind a confirmation like any other write.
  agentMayDelete: ['delete_project_folder'],
})
