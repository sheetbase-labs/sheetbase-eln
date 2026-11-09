/**
 * Datasets objects kept off tokens, with the reason. Everything else in the
 * area is on the API (see `operations.ts` and `api-tables.ts`).
 */
const SCI_010 =
  'Part of the older SCI-010 schema and scientific-table subsystem, which ADRs 0038 and 0041 replace with measurement tables (`dataset_schema_definitions`), and those are on the API. Its functions have no grant at all and run DDL on generated tables; it is to be removed, not opened.'

const SCI_010_NAMES = [
  'dataset_schemas',
  'dataset_schema_fields',
  'dataset_schema_relationships',
  'create_schema_relationship',
  'delete_schema_relationship',
  'create_dataset_schema',
  'add_dataset_schema_field',
  'retire_dataset_schema_field',
  'publish_dataset_schema',
  'instantiate_dataset_schema',
  'query_dataset',
  'scientific_tables',
  'scientific_columns',
  'scientific_category_options',
  'scientific_transfers',
  'scientific_table_metadata',
  'add_scientific_column',
  'convert_scientific_column',
  'retire_scientific_column',
  'update_scientific_column_display',
  'update_scientific_table_display',
  'apply_scientific_row_changes',
  'apply_scientific_row_edits',
  'record_scientific_export',
  'upgrade_scientific_schema',
  'create_scientific_table',
]

const STORAGE_KEY =
  'Records a storage key the server chose after it stored the bytes; taking a key from a caller would let it point at another object. Callers add a file they uploaded by its id instead (`add_dataset_import_file`, `attach_instrument_raw_file`).'

export const DATASET_NOT_EXPOSED = {
  ...Object.fromEntries(SCI_010_NAMES.map((name) => [name, SCI_010])),
  create_dataset_import_file: STORAGE_KEY,
  record_dataset_import_file_parse: STORAGE_KEY,
  register_raw_file: STORAGE_KEY,
  prune_dataset_versions:
    'A background sweep across every workspace, run by the server on a schedule; `keep_dataset_version` and `dataset_version_retention` are the controls for one dataset.',
  dataset_version_flags:
    'No grant and no row security of its own; read through `analysis_dataset_version_flags`.',
  dataset_version_keeps:
    'No grant and no row security of its own; read through `dataset_version_retention`.',
  dataset_version_prunes:
    'No grant and no row security of its own; read through `dataset_version_retention`.',
  dataset_cell_search:
    'Search index rows the database rebuilds from dataset values; searching goes through the search API.',
  ensure_builtin_parsers:
    'Seeds the built-in parsers when a workspace starts; `create_parser_version` is the way to add one.',
  ensure_parser:
    'A seeding upsert that can mark a parser approved, which stays with a person; `create_parser_version` is the way to add one.',
} as const satisfies Readonly<Record<string, string>>
