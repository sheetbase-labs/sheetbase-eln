/**
 * Record types (models), their fields, choices and rules; sheet definitions
 * and their versions; notebook templates and their versions; and the sheets
 * made from them, on the API, MCP, the assistant, pipelines, webhooks and
 * steward SQL. Authoring is open behind `schema:write`, publishing behind
 * `schema:publish`.
 */
import { SCHEMA_READ_TOOL_NAMES } from '#/lib/assistant-schema'
import { SCHEMA_LAB_TABLES } from './api-tables'
import { SCHEMA_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'schema',
  operations: SCHEMA_OPERATIONS,
  labTables: SCHEMA_LAB_TABLES,
  // What is left off tokens is plumbing, or a signed act.
  notExposed: {
    retire_notebook_template_version:
      'Retiring a template version is signed: it takes a signature meaning from someone with a signing certificate, so it stays with a person in the app. Read the result on notebook_template_versions.',
    create_sheet_instance_core0311:
      'The inner step of create_sheet_instance, which checks the caller and the definition first; call that instead.',
    create_sheet_instance_from_definition_core0311:
      'The inner step of create_sheet_instance_from_definition, which checks the caller and the definition first; call that instead.',
    update_sheet_instance_core0311:
      'The inner step of update_sheet_instance and mutate_sheet_instance_local_state; call those instead.',
    query_sheet_instance_rows_core036:
      'An older shape of query_sheet_instance_rows kept for the inner step of the current one; call query_sheet_instance_rows.',
    query_sheet_instance_rows_core037:
      'The inner step of query_sheet_instance_rows, which adds the calculated columns; call that instead.',
    next_record_model_identifier:
      'Hands out the next identifier of a record type and uses it up; record creation calls it, so a caller asking for one would leave gaps in the numbering.',
    is_model_field_admin:
      'Whether the person may edit record types: the database asks it inside every field call, so a caller never needs to.',
    is_sheet_definition_admin:
      'Whether the person may edit sheet definitions: the database asks it inside every definition call, so a caller never needs to.',
    validate_notebook_sheet_block:
      'A trigger function that checks sheet blocks as they are saved; it cannot be called.',
    sheet_cell_search:
      'The search index behind search_sheet_cells, rebuilt from sheet_instances on every save; search with search_sheet_cells instead.',
    chart_box_stats:
      'Arithmetic (quartiles for a box plot) left from an earlier chart freezer; nothing calls it now and it reads no data.',
    chart_quantile:
      'Arithmetic (a quantile of a list) used only by chart_box_stats; it reads no data.',
    chart_dim_label:
      'Formatting (a number as an axis label) left from an earlier chart freezer; nothing calls it now and it reads no data.',
    chart_filter_matches:
      'Tests one row against a chart filter; left from an earlier chart freezer, nothing calls it now and it reads no data.',
    chart_to_number:
      'Reads text as a number for chart_filter_matches; it reads no data.',
    chart_spec_referenced_field_ids:
      'Used inside freeze_chart and freeze_analysis_block to list the fields a chart spec names. It reads no data; the spec is the caller’s own.',
    validate_chart_spec_maturity:
      'Used inside validate_scientific_block to refuse a chart spec that is not finished as a block is saved. It reads no data and returns nothing.',
  },
  agentArea: {
    area: 'Models, sheets and templates',
    match: /model|sheet|template/,
  },
  assistantReadTools: SCHEMA_READ_TOOL_NAMES,
})
