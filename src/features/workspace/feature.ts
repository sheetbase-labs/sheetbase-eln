/**
 * Workspace set-up and the leftovers of areas already open: set-up, starter
 * tables, join domains, the regulated-lab switch, capabilities, category
 * vocabularies, search helpers, sheet cell conflicts, filing planner work
 * under a study and sample storage places, on the API, MCP, the assistant,
 * pipelines and webhooks.
 */
import { WORKSPACE_LAB_TABLES } from './api-tables'
import { WORKSPACE_NOT_EXPOSED } from './exemptions'
import { WORKSPACE_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'workspace',
  operations: WORKSPACE_OPERATIONS,
  labTables: WORKSPACE_LAB_TABLES,
  notExposed: WORKSPACE_NOT_EXPOSED,
  agentArea: {
    area: 'Workspace set-up',
    match:
      /workspace_setup|starter_structures|join_domains|regulated_lab|cell_conflict/,
    beforeCore: true,
  },
})
