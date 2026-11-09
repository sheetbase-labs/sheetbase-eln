/**
 * Datasets and measurement tables: building and publishing measurement
 * tables, dataset values and their flags, kept snapshots, planned rows, import
 * files and intake problems, on the API, MCP, the assistant, pipelines and
 * webhooks.
 */
import { DATASET_LAB_TABLES } from './api-tables'
import { DATASET_NOT_EXPOSED } from './not-exposed'
import { DATASET_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'datasets',
  operations: DATASET_OPERATIONS,
  labTables: DATASET_LAB_TABLES,
  notExposed: DATASET_NOT_EXPOSED,
  agentArea: {
    area: 'Datasets',
    match: /dataset|intake|measurement/,
    // `apply_dataset_model_upgrade` and friends would otherwise land in
    // other groups.
    beforeCore: true,
  },
  // Discarding a draft measurement table version is allowed behind a
  // confirmation: only a draft goes, and the published versions stay.
  agentMayDelete: ['delete_dataset_schema_version'],
})
