/**
 * Gaps with an owner: objects that are still to be opened to the API, MCP,
 * assistant, webhooks, pipelines and the SDKs, one area at a time.
 *
 * Each list belongs to one build thread. The thread that opens an area takes
 * its names out of here in the same PR (the guard fails if a name here is on
 * the allowlist). A list that is empty is deleted. Nothing is added to these
 * lists: a new object ships with its integration or with a real reason in
 * `integration-exemptions.ts`.
 */

/** Datasets, measurement tables, imports, parsers, connectors and intake: opened by the datasets and imports thread. */
export const PENDING_DATASETS: readonly string[] = [
  'add_dataset_schema_field',
  'add_scientific_column',
  'analysis_dataset_version_flags',
  'apply_column_promotion',
  'apply_dataset_model_upgrade',
  'apply_dataset_schema_evolution',
  'apply_scientific_row_changes',
  'apply_scientific_row_edits',
  'clear_dataset_value_flag',
  'column_promotions',
  'commit_dataset_row_batch_atomic',
  'compare_dataset_versions',
  'convert_scientific_column',
  'create_dataset_import_file',
  'create_dataset_schema',
  'create_dataset_schema_definition',
  'create_dataset_schema_subtype',
  'create_dataset_structure_from_file',
  'create_next_dataset_schema_version',
  'create_plate_snapshot',
  'create_scientific_table',
  'data_exports',
  'dataset_bulk_commits',
  'dataset_cell_search',
  'dataset_import_files',
  'dataset_list_summary',
  'dataset_row_values',
  'dataset_rows',
  'dataset_schema_fields',
  'dataset_schema_relationships',
  'dataset_schemas',
  'dataset_sheet_options',
  'dataset_value_context',
  'dataset_value_flags',
  'dataset_version_flags',
  'dataset_version_keeps',
  'dataset_version_list',
  'dataset_version_prunes',
  'dataset_version_retention',
  'dataset_version_rows',
  'dataset_version_values',
  'delete_dataset_schema_version',
  'ensure_builtin_parsers',
  'ensure_parser',
  'flag_dataset_value',
  'instantiate_dataset_schema',
  'instrument_raw_files',
  'intake_failures',
  'keep_dataset_version',
  'link_intake_dataset',
  'plan_dataset_row',
  'preview_calculation_promotion',
  'preview_dataset_model_upgrade',
  'preview_dataset_schema_evolution',
  'promote_calculation',
  'prune_dataset_versions',
  'publish_dataset_schema',
  'publish_dataset_schema_version',
  'query_dataset',
  'reading_planned_rows',
  'recompute_dataset_system_flags',
  'record_dataset_import_file_parse',
  'record_intake_failure',
  'record_scientific_export',
  'register_raw_file',
  'reparent_dataset_schema',
  'replace_dataset_schema_version_fields',
  'request_column_promotion',
  'resolve_intake_failure',
  'resolve_intake_failures_for_file',
  'restore_dataset_schema_definition',
  'retire_dataset_schema_definition',
  'retire_dataset_schema_field',
  'retire_scientific_column',
  'scientific_category_options',
  'scientific_columns',
  'scientific_table_metadata',
  'scientific_tables',
  'scientific_transfers',
  'set_dataset_column_unit',
  'set_dataset_intended_use',
  'update_scientific_column_display',
  'update_scientific_table_display',
  'upgrade_scientific_schema',
]

/** Projects, folders, access, follow, notifications, search, files and audit: opened by the projects and workspace thread. */
export const PENDING_WORKSPACE: readonly string[] = [
  'create_schema_relationship',
  'delete_schema_relationship',
]

/** Every pending name with the reason the guard shows for it. */
export const PENDING_EXPOSURE: Readonly<Record<string, string>> =
  Object.fromEntries([
    ...PENDING_DATASETS.map((n) => [
      n,
      'Being opened with the datasets and imports area.',
    ]),
    ...PENDING_WORKSPACE.map((n) => [
      n,
      'Being opened with the projects and workspace area.',
    ]),
  ])
