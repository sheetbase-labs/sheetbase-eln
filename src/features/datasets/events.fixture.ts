/**
 * The change each dataset, measurement-table and intake event is delivered
 * from, as the database writes it. The event catalogue test pins these, so an
 * event cannot be added to `datasets.ts` without saying how it is produced.
 */
export const DATASET_EVENT_FIXTURES: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: Record<string, unknown>
}> = [
  {
    name: 'measurement_table.created',
    entityType: 'dataset_schema_definition',
    operation: 'create',
    payload: {},
  },
  {
    name: 'measurement_table.updated',
    entityType: 'dataset_schema_definition',
    operation: 'update',
    payload: {},
  },
  {
    name: 'measurement_table.retired',
    entityType: 'dataset_schema_definition',
    operation: 'archive',
    payload: {},
  },
  {
    name: 'measurement_table.restored',
    entityType: 'dataset_schema_definition',
    operation: 'restore',
    payload: {},
  },
  {
    name: 'measurement_table.version.created',
    entityType: 'dataset_schema_version',
    operation: 'create',
    payload: { lifecycle: 'draft' },
  },
  {
    name: 'measurement_table.version.updated',
    entityType: 'dataset_schema_version',
    operation: 'update',
    payload: { lifecycle: 'draft' },
  },
  {
    name: 'measurement_table.version.published',
    entityType: 'dataset_schema_version',
    operation: 'update',
    payload: { lifecycle: 'active' },
  },
  {
    name: 'measurement_table.version.deleted',
    entityType: 'dataset_schema_version',
    operation: 'delete',
    payload: {},
  },
  {
    name: 'dataset.version.kept',
    entityType: 'dataset_version',
    operation: 'lock',
    payload: {},
  },
  {
    name: 'dataset.value.flagged',
    entityType: 'dataset_value_flag',
    operation: 'create',
    payload: {},
  },
  {
    name: 'dataset.value.flag_cleared',
    entityType: 'dataset_value_flag',
    operation: 'resolve',
    payload: {},
  },
  {
    name: 'import.file.added',
    entityType: 'dataset_import_file',
    operation: 'create',
    payload: { status: 'stored' },
  },
  {
    name: 'import.file.read',
    entityType: 'dataset_import_file',
    operation: 'update',
    payload: { status: 'parsed' },
  },
  {
    name: 'import.file.unreadable',
    entityType: 'dataset_import_file',
    operation: 'update',
    payload: { status: 'failed' },
  },
  {
    name: 'intake.failed',
    entityType: 'intake_failure',
    operation: 'create',
    payload: {},
  },
  {
    name: 'intake.resolved',
    entityType: 'intake_failure',
    operation: 'resolve',
    payload: {},
  },
  {
    name: 'instrument.raw_file.added',
    entityType: 'instrument_raw_file',
    operation: 'create',
    payload: {},
  },
]
