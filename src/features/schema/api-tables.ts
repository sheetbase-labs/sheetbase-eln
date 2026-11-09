import type { LabTable } from '#/lib/lab-api-surface'

/**
 * Models, sheets and templates on the external API: the parts of record
 * types, sheet definitions and templates that are not on the core tables, and
 * the history kept as sheets and notebooks change. Read only; changes go
 * through the actions in `operations/declarations/schema.ts`. Spread into
 * `LAB_TABLES`.
 */
export const SCHEMA_LAB_TABLES: Readonly<Record<string, LabTable>> = {
  model_kinds: {
    summary:
      'The families record types belong to (records, projects, instruments): what each holds and what it can do. Fixed by Sheetbase.',
    scope: 'schema:read',
    columns: [
      ['key', 'text', 1],
      ['label', 'text', 1],
      ['identity_table', 'text', 1],
      ['custom_field_strategy', 'text', 1],
      ['capabilities', 'json', 1],
      ['record_kind', 'text', 0],
    ],
  },
  model_base_fields: {
    summary:
      'The built-in fields every record type of a family has, such as title and status, with how each is shown.',
    scope: 'schema:read',
    columns: [
      ['model_key', 'text', 1],
      ['field_key', 'text', 1],
      ['label', 'text', 1],
      ['presentation', 'json', 1],
    ],
  },
  model_field_options: {
    summary:
      'The choices of each category field: the stored `key`, the `label` people see, the order and whether it is retired. Change them with `create_model_field_option`, `update_model_field_option` and `retire_model_field_option`.',
    scope: 'schema:read',
    columns: [
      ['id', 'uuid', 1],
      ['definition_id', 'uuid', 1],
      ['key', 'text', 1],
      ['label', 'text', 1],
      ['display_order', 'int', 1],
      ['lifecycle', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  model_rules: {
    summary:
      'Checks on records of a type: the fields each looks at, its condition, and whether it warns, blocks the save or blocks submitting (`effect`).',
    scope: 'schema:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['model_key', 'text', 1],
      ['name', 'text', 1],
      ['field_keys', 'text[]', 1],
      ['condition', 'json', 1],
      ['effect', 'text', 1],
      ['message', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
    ],
  },
  model_relationship_rules: {
    summary:
      'How many links of a kind records of one type must or may have to records of another (`min_links`, `max_links`).',
    scope: 'schema:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['source_model_key', 'text', 1],
      ['link_type', 'text', 1],
      ['target_model_key', 'text', 1],
      ['min_links', 'int', 1],
      ['max_links', 'int', 0],
      ['label', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
    ],
  },
  record_model_versions: {
    summary:
      'Each version of a record type: a `draft` being worked on or `published`, with what it holds (`definition`).',
    scope: 'schema:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['model_id', 'uuid', 1],
      ['version', 'int', 1],
      ['revision', 'int', 1],
      ['lifecycle', 'text', 1],
      ['definition', 'json', 1],
      ['reason', 'text', 1],
      ['published_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 0],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  record_model_version_upgrades: {
    summary:
      'Each time a record was moved onto a newer version of its type, by whom and why.',
    scope: 'schema:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['from_version_id', 'uuid', 0],
      ['to_version_id', 'uuid', 1],
      ['reason', 'text', 0],
      ['created_at', 'ts', 1],
      ['upgraded_by_user_id', 'text', 0],
    ],
  },
  notebook_template_instantiations: {
    summary: 'Each notebook made from a template version, and who made it.',
    scope: 'templates:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['actor_user_id', 'text', 1],
      ['idempotency_key', 'text', 1],
      ['template_version_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['result', 'json', 1],
      ['created_at', 'ts', 1],
    ],
  },
  notebook_template_upgrades: {
    summary:
      'Each time a notebook was moved onto a newer template version, with the decisions taken.',
    scope: 'templates:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['source_version_id', 'uuid', 1],
      ['target_version_id', 'uuid', 1],
      ['decisions', 'json', 1],
      ['actor_user_id', 'text', 1],
      ['created_at', 'ts', 1],
    ],
  },
  sheet_instance_calculation_mutations: {
    summary:
      'Each change to a sheet’s own calculations, with the sheet revision before and after.',
    scope: 'sheets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instance_id', 'uuid', 1],
      ['retry_token', 'uuid', 1],
      ['request_digest', 'text', 1],
      ['operation', 'text', 1],
      ['result_revision', 'bigint', 1],
      ['result', 'json', 1],
      ['actor_user_id', 'text', 1],
      ['created_at', 'ts', 1],
    ],
  },
  sheet_instance_composition_adoptions: {
    summary: 'Each time a sheet took on columns from a definition.',
    scope: 'sheets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instance_id', 'uuid', 1],
      ['target_definition_version_id', 'uuid', 1],
      ['source_instance_revision', 'bigint', 1],
      ['resulting_instance_revision', 'bigint', 1],
      ['retry_token', 'uuid', 1],
      ['request_digest', 'text', 1],
      ['unmatched_local_row_keys', 'json', 1],
      ['actor_user_id', 'text', 1],
      ['adopted_at', 'ts', 1],
      ['result', 'json', 1],
    ],
  },
  sheet_instance_definition_upgrades: {
    summary:
      'Each time a sheet was moved onto a newer version of its definition.',
    scope: 'sheets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instance_id', 'uuid', 1],
      ['source_definition_version_id', 'uuid', 1],
      ['target_definition_version_id', 'uuid', 1],
      ['source_instance_revision', 'bigint', 1],
      ['resulting_instance_revision', 'bigint', 1],
      ['decision_manifest', 'json', 1],
      ['actor_user_id', 'text', 1],
      ['upgraded_at', 'ts', 1],
    ],
  },
  sheet_instance_local_mutations: {
    summary: 'Each change to a sheet’s own columns (ones no definition has).',
    scope: 'sheets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instance_id', 'uuid', 1],
      ['retry_token', 'uuid', 1],
      ['request_digest', 'text', 1],
      ['result_revision', 'bigint', 1],
      ['result', 'json', 1],
      ['actor_user_id', 'text', 0],
      ['operation', 'text', 1],
      ['affected', 'json', 1],
      ['created_at', 'ts', 1],
      ['actor_credential_id', 'uuid', 0],
    ],
  },
  sheet_materializations: {
    summary: 'Each time a sheet’s rows were saved as a dataset version.',
    scope: 'sheets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instance_id', 'uuid', 1],
      ['definition_version_id', 'uuid', 1],
      ['instance_revision', 'bigint', 1],
      ['output_dataset_id', 'uuid', 1],
      ['output_dataset_version_id', 'uuid', 1],
      ['output_schema_version_id', 'uuid', 1],
      ['source_versions', 'json', 1],
      ['calculation_provenance', 'json', 1],
      ['request_digest', 'text', 1],
      ['idempotency_key', 'uuid', 1],
      ['actor_user_id', 'text', 1],
      ['materialized_at', 'ts', 1],
    ],
  },
  sheet_record_bulk_commits: {
    summary: 'Each batch of records saved from a sheet at once.',
    scope: 'sheets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['project_id', 'uuid', 1],
      ['actor_user_id', 'text', 1],
      ['idempotency_key', 'text', 1],
      ['request_digest', 'text', 1],
      ['result', 'json', 1],
      ['created_at', 'ts', 1],
    ],
  },
  revision_sheet_evidence: {
    summary:
      'The sheets as they were when a notebook revision was submitted for review: the sheet’s state, grid and dataset versions.',
    scope: 'reviews:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['revision_id', 'uuid', 1],
      ['block_id', 'uuid', 1],
      ['instance_id', 'uuid', 1],
      ['source_definition_version_id', 'uuid', 0],
      ['instance_revision', 'bigint', 1],
      ['instance_state', 'json', 1],
      ['dataset_versions', 'json', 1],
      ['created_at', 'ts', 1],
      ['composed_grid', 'json', 1],
    ],
  },
}
