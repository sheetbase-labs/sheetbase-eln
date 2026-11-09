import type { LabTable } from '#/lib/lab-api-surface'

/**
 * Dataset data on the external API: rows and their typed values, the values
 * kept with each snapshot, value flags, bulk commits, import files, intake
 * problems and the export log. Read with `datasets:read` (intake problems,
 * raw instrument files and exports with `lab:read`). Spread into `LAB_TABLES`.
 *
 * Values are stored one row per cell, in the column that matches the field's
 * type (`text_value`, `numeric_value` …). `query_dataset_rows` returns them
 * already pivoted into one object per row, which is usually easier.
 */
const VALUE_COLUMNS = [
  ['text_value', 'text', 0],
  ['integer_value', 'bigint', 0],
  ['numeric_value', 'num', 0],
  ['boolean_value', 'bool', 0],
  ['date_value', 'date', 0],
  ['timestamp_value', 'ts', 0],
  ['category_option_id', 'uuid', 0],
  ['reference_id', 'uuid', 0],
] as const

export const DATASET_LAB_TABLES: Readonly<Record<string, LabTable>> = {
  dataset_rows: {
    summary:
      'The rows of a dataset as they are now. `revision` goes up with every change; `status` is `recorded`, or `planned` for a row waiting for its measurement (see `plan_dataset_row`).',
    scope: 'datasets:read',
    columns: [
      ['id', 'uuid', 1],
      ['dataset_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['revision', 'bigint', 1],
      ['status', 'text', 1],
      ['scheduled_at', 'ts', 0],
      ['planned_key', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  dataset_row_values: {
    summary:
      'One value of a dataset row: the row, the measurement-table field it fills and the value in the column for its type. `ordinal` orders the values of a list field.',
    scope: 'datasets:read',
    columns: [
      ['row_id', 'uuid', 1],
      ['field_id', 'uuid', 1],
      ['ordinal', 'int', 1],
      ...VALUE_COLUMNS,
    ],
  },
  dataset_version_rows: {
    summary:
      'Which rows, at which revision, a dataset snapshot (version) holds.',
    scope: 'datasets:read',
    columns: [
      ['dataset_version_id', 'uuid', 1],
      ['row_id', 'uuid', 1],
      ['revision', 'bigint', 1],
    ],
  },
  dataset_version_values: {
    summary:
      'The values a dataset snapshot kept, laid out like `dataset_row_values`. A snapshot never changes, so these are what an analysis or a signed record cites.',
    scope: 'datasets:read',
    columns: [
      ['dataset_version_id', 'uuid', 1],
      ['row_id', 'uuid', 1],
      ['field_id', 'uuid', 1],
      ['ordinal', 'int', 1],
      ...VALUE_COLUMNS,
    ],
  },
  dataset_value_flags: {
    summary:
      'Flags on single values: `out_of_range`, `missing_unit`, `above_curve` or `high_cv`, with the reason. `source` is `manual` or `system` (set by a rule, with `system_rule`, the value checked and the threshold). A flag is open until `cleared_at` is set. Add and clear them with `flag_dataset_value` and `clear_dataset_value_flag`.',
    scope: 'datasets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['dataset_id', 'uuid', 1],
      ['row_id', 'uuid', 1],
      ['field_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['reason', 'text', 1],
      ['comment', 'text', 0],
      ['source', 'text', 1],
      ['system_rule', 'text', 0],
      ['evaluated_value', 'json', 0],
      ['threshold', 'json', 0],
      ['evaluated_at', 'ts', 0],
      ['set_by_user_id', 'text', 0],
      ['set_at', 'ts', 1],
      ['cleared_at', 'ts', 0],
      ['cleared_by_user_id', 'text', 0],
      ['cleared_reason', 'text', 0],
    ],
  },
  dataset_bulk_commits: {
    summary:
      'Large row commits made with `commit_dataset_row_batch_atomic`: who made each, its idempotency key and the result, so a retry returns the first answer.',
    scope: 'datasets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['dataset_id', 'uuid', 1],
      ['actor_user_id', 'text', 0],
      ['actor_credential_id', 'uuid', 0],
      ['idempotency_key', 'text', 1],
      ['request_digest', 'text', 1],
      ['result', 'json', 1],
      ['created_at', 'ts', 1],
    ],
  },
  dataset_import_files: {
    summary:
      'Files uploaded to be imported into a dataset, and whether they were read: `status` is `stored`, `parsed` or `failed` (with `parse_error` and `parser_failure`). Add one from a file you uploaded with `add_dataset_import_file`.',
    scope: 'datasets:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['dataset_id', 'uuid', 0],
      ['filename', 'text', 1],
      ['media_type', 'text', 0],
      ['byte_size', 'bigint', 1],
      ['checksum', 'text', 1],
      ['format', 'text', 1],
      ['status', 'text', 1],
      ['parse_error', 'text', 0],
      ['parser_failure', 'json', 0],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  intake_failures: {
    summary:
      'Files a connector (`source` `agent`) or an upload could not bring in, and why: `code` and `message`, the parser it tried and how many attempts. `status` is `open`, `resolved` or `dismissed`. Record one with `record_intake_failure`; close one with `resolve_intake_failure`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['connector_id', 'uuid', 1],
      ['instrument_id', 'uuid', 0],
      ['connector_run_id', 'uuid', 0],
      ['file_record_id', 'uuid', 0],
      ['file_name', 'text', 1],
      ['checksum', 'text', 0],
      ['byte_size', 'bigint', 0],
      ['source', 'text', 1],
      ['code', 'text', 1],
      ['message', 'text', 1],
      ['parser_key', 'text', 0],
      ['target', 'json', 1],
      ['status', 'text', 1],
      ['attempts', 'int', 1],
      ['last_attempt_at', 'ts', 1],
      ['resolved_at', 'ts', 0],
      ['resolved_by_user_id', 'text', 0],
      ['resolved_run_id', 'uuid', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  instrument_raw_files: {
    summary:
      'The raw files an instrument run produced, kept as they came off the instrument. `file_id` is the stored file (download it from the files API); `ingestion_status` is `pending`, `complete`, `partial` or `failed`. Attach one with `attach_instrument_raw_file`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['run_id', 'uuid', 1],
      ['file_id', 'uuid', 0],
      ['filename', 'text', 1],
      ['media_type', 'text', 0],
      ['size_bytes', 'bigint', 0],
      ['checksum', 'text', 0],
      ['ingestion_status', 'text', 1],
      ['error_detail', 'text', 0],
      ['received_at', 'ts', 1],
      ['created_at', 'ts', 1],
    ],
  },
  data_exports: {
    summary:
      'A log of data taken out of Sheetbase: what was exported (`object_type`, `object_id`), in which format, how many rows and by whom.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['object_type', 'text', 1],
      ['object_id', 'uuid', 1],
      ['format', 'text', 1],
      ['row_count', 'int', 0],
      ['byte_size', 'bigint', 0],
      ['actor_user_id', 'text', 0],
      ['actor_credential_id', 'uuid', 0],
      ['created_at', 'ts', 1],
    ],
  },
  column_promotions: {
    summary:
      'A sheet column asked to become a field of a measurement table (`target` `dataset_schema`) or of a record type (`model_field`). `state` is pending, approved, returned, applied or withdrawn.',
    scope: 'schema:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['sheet_instance_id', 'uuid', 1],
      ['field_id', 'uuid', 1],
      ['target', 'text', 1],
      ['schema_definition_id', 'uuid', 0],
      ['schema_version_id', 'uuid', 0],
      ['model_key', 'text', 0],
      ['state', 'text', 1],
      ['approval_request_id', 'uuid', 0],
      ['reason', 'text', 0],
      ['requested_by_user_id', 'text', 1],
      ['requested_at', 'ts', 1],
      ['decided_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  reading_planned_rows: {
    summary:
      'Planned dataset rows waiting for a reading, with the sample each is for and the column it measures when a repeat was asked for.',
    scope: 'datasets:read',
    columns: [
      ['id', 'uuid', 0],
      ['dataset_id', 'uuid', 0],
      ['planned_key', 'text', 0],
      ['scheduled_at', 'ts', 0],
      ['sample_id', 'uuid', 0],
      ['measurement_field_id', 'uuid', 0],
    ],
  },
}
