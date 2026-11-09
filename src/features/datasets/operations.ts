/**
 * Datasets, measurement tables and data intake. Declared once, so the public
 * API, the Python and TypeScript SDKs, MCP (`sheetbase.lab.act`), the
 * assistant, pipeline actions and the webhook events all come from these
 * entries.
 *
 * Everything here acts as the person (or the personal token) that calls it,
 * so every permission, revision check and audit entry is the page's own. The
 * database still checks the person's own rights: building a measurement table
 * needs `schema.edit`, publishing one (and changing a dataset's unit or
 * intended use) `schema.publish`, retiring one `schema.retire`. A token also
 * needs the matching scope: `schema:write` to build, `schema:publish` to
 * publish, `datasets:*` for dataset data and `lab:*` for intake.
 *
 * Imports, parsers, connectors and connector runs are declared with the
 * instruments. The older SCI-010 schema and scientific-table calls are not
 * here on purpose (see `integration-exemptions.ts`).
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type {
  OperationEvent,
  OperationInput,
} from '#/lib/operations/descriptor'

/** The workspace of the call: a pipeline step fills it in itself. */
const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
  description: 'Your workspace id.',
})

const FIELDS_NOTE =
  'JSON array of fields, each `{ key, label, logical_type, nullable?, description?, quantity?, category?, validation?, default_value?, relationship? }`. `logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`, `quantity` or `reference`. Give an existing field its `field_id` to keep it the same field across versions.'

const fields = (required = true): OperationInput => ({
  ...input('p_fields', 'json', required),
  description: FIELDS_NOTE,
})

const MEASUREMENT_VERSION_NOTES =
  'Payload is the version as stored: id, schemaId (the measurement table), version, lifecycle and who made it.'

const measurementTableEvents: readonly OperationEvent[] = [
  {
    name: 'measurement_table.created',
    family: 'dataset',
    summary: 'A measurement table was created, with a first draft version.',
    producer: { entityType: 'dataset_schema_definition', operation: 'create' },
    notes:
      'Payload is the table as stored: id, key, name, description, lifecycle, parentId and who made it.',
  },
  {
    name: 'measurement_table.version.created',
    family: 'dataset',
    summary: 'A new draft version of a measurement table was started.',
    producer: { entityType: 'dataset_schema_version', operation: 'create' },
    notes: MEASUREMENT_VERSION_NOTES,
  },
]

export const DATASET_OPERATIONS = defineOperations([
  // -- Measurement tables -----------------------------------------------------
  {
    name: 'create_dataset_schema_definition',
    label: 'Create a measurement table',
    summary: 'Create a measurement table',
    description: `Creates a measurement table (the columns a dataset is made of) with a first draft version holding \`p_fields\`. \`p_key\` is lower case letters, digits and _, unique in the workspace. Publish the draft with \`publish_dataset_schema_version\` before datasets use it. Returns \`{ schema_definition_id, schema_version_id }\`. Sends \`measurement_table.created\` and \`measurement_table.version.created\`.`,
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      workspace(),
      input('p_key', 'text'),
      input('p_name', 'text'),
      input('p_description', 'text', false),
      fields(false),
    ],
    assistant: { tool: 'sheetbase.measurement_table.create' },
    pipeline: {},
    events: measurementTableEvents,
    docsPage: 'datasets-api.md',
  },
  {
    name: 'create_dataset_schema_subtype',
    label: 'Create a measurement table that extends another',
    summary: 'Create a measurement table that extends another',
    description:
      'Creates a measurement table under `p_parent_id`: it starts with every field of its parent and adds its own. Returns `{ schema_definition_id, schema_version_id }`. Sends `measurement_table.created`.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_parent_id', 'uuid'),
      input('p_key', 'text'),
      input('p_name', 'text'),
      input('p_description', 'text', false),
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'create_dataset_structure_from_file',
    label: 'Make a dataset structure from a file’s columns',
    summary: 'Make a published measurement table from a file’s columns',
    description:
      'Makes and publishes a measurement table straight from the columns of a file, the way the import page does on a first import. Each field is `{ key, label, logical_type }` with `logical_type` one of `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`. Needs dataset work access, not schema editing. Returns the table and its published version.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [workspace(), input('p_name', 'text'), input('p_fields', 'json')],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'create_next_dataset_schema_version',
    label: 'Start a new version of a measurement table',
    summary: 'Start a new draft version of a measurement table',
    description:
      'Starts a draft version from the latest one, with the same fields, to change and publish. Returns `{ schema_version_id, version }`. Sends `measurement_table.version.created`.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [input('p_schema_definition_id', 'uuid')],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'replace_dataset_schema_version_fields',
    label: 'Change the fields of a draft measurement table',
    summary: 'Set the fields of a draft measurement table version',
    description: `Replaces every field of a draft version with \`p_fields\`. Only drafts change; a draft waiting for approval is locked. \`p_expected_revision\` refuses the change if someone else changed the draft since you read it. Returns the version. Sends \`measurement_table.version.updated\`.`,
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_schema_version_id', 'uuid'),
      fields(),
      {
        ...input('p_expected_revision', 'bigint', false),
        description:
          'The revision of the draft you last read. A change made since is refused instead of overwritten.',
      },
    ],
    result: 'row:dataset_schema_versions',
    assistant: { tool: 'sheetbase.measurement_table.edit' },
    pipeline: {},
    events: [
      {
        name: 'measurement_table.version.updated',
        family: 'dataset',
        summary: 'The fields of a draft measurement table version changed.',
        producer: {
          entityType: 'dataset_schema_version',
          operation: 'update',
          when: { key: 'lifecycle', equals: 'draft' },
        },
        notes: MEASUREMENT_VERSION_NOTES,
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'publish_dataset_schema_version',
    label: 'Publish a measurement table version',
    summary: 'Publish a measurement table version',
    description:
      'Publishes a draft version so datasets can use it; the version before it is superseded. Refused while the workspace asks for an approval and none has been given. Returns the version. Sends `measurement_table.version.published`.',
    kind: 'write',
    scope: 'schema:publish',
    inputs: [input('p_schema_version_id', 'uuid')],
    result: 'row:dataset_schema_versions',
    assistant: { tool: 'sheetbase.measurement_table.publish' },
    pipeline: {},
    events: [
      {
        name: 'measurement_table.version.published',
        family: 'dataset',
        summary: 'A measurement table version was published.',
        producer: {
          entityType: 'dataset_schema_version',
          operation: 'update',
          when: { key: 'lifecycle', equals: 'active' },
        },
        notes: MEASUREMENT_VERSION_NOTES,
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'delete_dataset_schema_version',
    label: 'Discard a draft measurement table version',
    summary: 'Discard a draft measurement table version',
    description:
      'Discards a draft version that was never published. Published versions are kept for good. Sends `measurement_table.version.deleted`.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [input('p_schema_version_id', 'uuid')],
    result: 'void',
    assistant: { tool: 'sheetbase.measurement_table.discard_draft' },
    pipeline: {},
    events: [
      {
        name: 'measurement_table.version.deleted',
        family: 'dataset',
        summary: 'A draft measurement table version was discarded.',
        producer: { entityType: 'dataset_schema_version', operation: 'delete' },
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'retire_dataset_schema_definition',
    label: 'Retire a measurement table',
    summary: 'Retire a measurement table',
    description:
      'Stops new datasets from using a measurement table. Datasets that use it keep their data and can still be read. Undo with `restore_dataset_schema_definition`. Returns the table. Sends `measurement_table.retired`.',
    kind: 'write',
    scope: 'schema:publish',
    inputs: [input('p_schema_definition_id', 'uuid')],
    result: 'row:dataset_schema_definitions',
    assistant: { tool: 'sheetbase.measurement_table.retire' },
    pipeline: {},
    events: [
      {
        name: 'measurement_table.retired',
        family: 'dataset',
        summary: 'A measurement table was retired.',
        producer: {
          entityType: 'dataset_schema_definition',
          operation: 'archive',
        },
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'restore_dataset_schema_definition',
    label: 'Bring back a retired measurement table',
    summary: 'Restore a retired measurement table',
    description:
      'Brings a retired measurement table back: active when it has a published version, otherwise a draft. Returns the table. Sends `measurement_table.restored`.',
    kind: 'write',
    scope: 'schema:publish',
    inputs: [input('p_schema_definition_id', 'uuid')],
    result: 'row:dataset_schema_definitions',
    assistant: { tool: 'sheetbase.measurement_table.restore' },
    pipeline: {},
    events: [
      {
        name: 'measurement_table.restored',
        family: 'dataset',
        summary: 'A retired measurement table was brought back.',
        producer: {
          entityType: 'dataset_schema_definition',
          operation: 'restore',
        },
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'reparent_dataset_schema',
    label: 'Move a measurement table under another',
    summary: 'Change what a measurement table extends',
    description:
      'Makes a measurement table extend `p_parent_id`, or no table when it is null. Its draft picks up the parent’s fields. Returns the table. Sends `measurement_table.updated`.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_definition_id', 'uuid'),
      input('p_parent_id', 'uuid', true, true),
    ],
    result: 'row:dataset_schema_definitions',
    pipeline: {},
    events: [
      {
        name: 'measurement_table.updated',
        family: 'dataset',
        summary:
          'A measurement table’s name, description or the table it extends changed.',
        producer: {
          entityType: 'dataset_schema_definition',
          operation: 'update',
        },
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'preview_dataset_schema_evolution',
    label: 'Preview a change to a published measurement table',
    summary: 'Preview a change to a published measurement table',
    description:
      'Says what changing a published version to `p_fields` would do: which fields are added, renamed or retired, whether it is safe for the datasets that use it, and what blocks it. Changes nothing.',
    kind: 'read',
    scope: 'schema:read',
    inputs: [input('p_schema_version_id', 'uuid'), fields()],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'apply_dataset_schema_evolution',
    label: 'Change a published measurement table',
    summary: 'Change a published measurement table in one step',
    description:
      'Makes and publishes the next version from `p_fields` in one step, when the preview says it is safe. `p_idempotency_key` makes a retry return the first answer. Returns the preview and the published version.',
    kind: 'write',
    scope: 'schema:publish',
    inputs: [
      input('p_schema_version_id', 'uuid'),
      fields(),
      {
        ...input('p_idempotency_key', 'text'),
        server: 'idempotency',
        description:
          'Any unique string; a retry with the same key and fields returns the first result.',
      },
      input('p_expected_revision', 'bigint', false),
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'preview_dataset_model_upgrade',
    label: 'Preview moving a dataset to a newer measurement table',
    summary: 'Preview moving a dataset to another measurement table version',
    description:
      'Says what moving a dataset to `p_target_version_id` would do to its rows and values, and whether anything blocks it. Changes nothing.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_target_version_id', 'uuid'),
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'apply_dataset_model_upgrade',
    label: 'Move a dataset to a newer measurement table',
    summary: 'Move a dataset to another measurement table version',
    description:
      'Moves a dataset to `p_target_version_id` of its measurement table, carrying its values across. `p_expected_revision` is the dataset revision you previewed. Needs schema editing. Sends `dataset.updated`.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_target_version_id', 'uuid'),
      input('p_expected_revision', 'bigint'),
    ],
    assistant: { tool: 'sheetbase.dataset.upgrade_table' },
    pipeline: {},
    docsPage: 'datasets-api.md',
  },

  // -- Dataset values and snapshots ------------------------------------------
  {
    name: 'dataset_list_summary',
    label: 'List datasets with their counts',
    summary: 'List datasets with row and issue counts',
    description:
      'The datasets you can see, newest first, with their row count, open flags, values out of range, fields missing a unit and review state. Filter by `p_project_id`; leave out archived ones with `p_include_archived` false.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [
      input('p_project_id', 'uuid', false, true),
      input('p_include_archived', 'bool', false),
      input('p_limit', 'int', false, true),
      input('p_offset', 'int', false),
    ],
    result:
      'rows:id=uuid,display_id=text,name=text,model=text,project_id=uuid,created_by_user_id=text,row_count=bigint,issue_count=bigint,updated_at=ts,archived_at=ts,experiment_display_id=text,out_of_range_count=bigint,missing_unit_count=bigint,missing_unit_fields=text[],review_state=text',
    docsPage: 'datasets-api.md',
  },
  {
    name: 'dataset_version_list',
    label: 'List a dataset’s snapshots',
    summary: 'List the snapshots of a dataset',
    description:
      'Every snapshot (version) of a dataset, newest first, with its row count, checksum, who made it, what cites it and whether it is kept.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [input('p_dataset_id', 'uuid')],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'compare_dataset_versions',
    label: 'Compare two dataset snapshots',
    summary: 'Compare two dataset snapshots',
    description:
      'The rows added, removed and changed between snapshot `p_version_a` and `p_version_b`, a page at a time.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [
      input('p_version_a', 'uuid'),
      input('p_version_b', 'uuid'),
      input('p_limit', 'int', false),
      input('p_offset', 'int', false),
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'dataset_version_retention',
    label: 'Say why a snapshot is kept',
    summary: 'Why a dataset snapshot is kept, and until when',
    description:
      'Why a snapshot will not be pruned: `cited_by_signed_record`, `notebook_import_evidence`, `kept` (with `keptUntil`), `active`, or `uncited_after_archive` when it can go.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [input('p_version_id', 'uuid')],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'keep_dataset_version',
    label: 'Keep a dataset snapshot',
    summary: 'Keep a dataset snapshot from being pruned',
    description:
      'Keeps a snapshot for the workspace’s retention period, with a reason, so it is not pruned. Returns the snapshot. Sends `dataset.version.kept`.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [input('p_version_id', 'uuid'), input('p_reason', 'text')],
    result: 'row:dataset_versions',
    assistant: { tool: 'sheetbase.dataset.keep_snapshot' },
    pipeline: {},
    events: [
      {
        name: 'dataset.version.kept',
        family: 'dataset',
        summary: 'A dataset snapshot was kept from being pruned.',
        producer: {
          entityType: 'dataset_version',
          operation: 'lock',
        },
        notes: 'Payload: datasetId, versionId, keptUntil and reason.',
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'dataset_value_context',
    label: 'Look at one dataset row',
    summary: 'One dataset row with its values',
    description:
      'One row of a dataset with its values keyed by field id, its revision and the measurement table version, as the peek in the app shows it.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [input('p_dataset_id', 'uuid'), input('p_row_id', 'uuid')],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'dataset_sheet_options',
    label: 'List the sheets that can open a dataset',
    summary: 'Sheets that can open a dataset',
    description:
      'The published sheet definitions whose inputs fit this dataset, so you can open it in one.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [input('p_dataset_id', 'uuid')],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'analysis_dataset_version_flags',
    label: 'List the flags a snapshot kept',
    summary: 'The value flags a dataset snapshot kept',
    description:
      'The value flags that were open when a snapshot was taken, as an analysis of that snapshot sees them.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [input('p_dataset_version_id', 'uuid')],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'flag_dataset_value',
    label: 'Flag a value',
    summary: 'Flag a dataset value',
    description:
      'Flags one value in a dataset: `p_kind` is `out_of_range`, `missing_unit`, `above_curve` or `high_cv`, with a reason (up to 200 characters) and an optional comment. Returns the flag. Sends `dataset.value.flagged`.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_row_id', 'uuid'),
      input('p_field_id', 'uuid'),
      input('p_kind', 'text'),
      input('p_reason', 'text'),
      input('p_comment', 'text', false),
    ],
    result: 'row:dataset_value_flags',
    assistant: { tool: 'sheetbase.dataset.flag_value' },
    pipeline: {},
    events: [
      {
        name: 'dataset.value.flagged',
        family: 'dataset',
        summary:
          'A dataset value was flagged, by a person or by a rule (out of range, missing unit, high CV).',
        producer: { entityType: 'dataset_value_flag', operation: 'create' },
        notes:
          'Payload is the flag as stored: datasetId, rowId, fieldId, kind, reason, source (`manual` or `system`) and, for a rule, systemRule, evaluatedValue and threshold.',
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'clear_dataset_value_flag',
    label: 'Clear a flag',
    summary: 'Clear a flag on a dataset value',
    description:
      'Clears an open flag, with an optional reason. Returns the flag. Sends `dataset.value.flag_cleared`.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [input('p_flag_id', 'uuid'), input('p_reason', 'text', false)],
    result: 'row:dataset_value_flags',
    assistant: { tool: 'sheetbase.dataset.clear_flag' },
    pipeline: {},
    events: [
      {
        name: 'dataset.value.flag_cleared',
        family: 'dataset',
        summary: 'A flag on a dataset value was cleared.',
        producer: { entityType: 'dataset_value_flag', operation: 'resolve' },
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'recompute_dataset_system_flags',
    label: 'Check a dataset’s values again',
    summary: 'Run the value checks on a dataset again',
    description:
      'Runs the automatic checks (range, units, replicate CV) over every row again, opening and clearing system flags to match. Returns how many rows it checked.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [input('p_dataset_id', 'uuid')],
    result: 'int',
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'set_dataset_column_unit',
    label: 'Set a column’s unit',
    summary: 'Set the unit of a dataset column',
    description:
      'Sets the unit of one field of a dataset (by `p_field_key`) with a reason. The dataset moves to a new measurement table version with that unit, and `missing_unit` flags on the column clear. Needs publishing rights. Sends `dataset.updated`.',
    kind: 'write',
    scope: 'schema:publish',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_field_key', 'text'),
      input('p_unit', 'text'),
      input('p_reason', 'text'),
    ],
    assistant: { tool: 'sheetbase.dataset.set_unit' },
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'set_dataset_intended_use',
    label: 'Set what a dataset is for',
    summary: 'Set the intended use of a dataset',
    description:
      'Sets what a dataset is for: `exploratory_research`, `controlled_development` or `regulated_record`, with a reason. Regulated datasets only take approved parsers. Needs publishing rights. Returns the dataset. Sends `dataset.updated`.',
    kind: 'write',
    scope: 'schema:publish',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_intended_use', 'text'),
      input('p_reason', 'text'),
    ],
    result: 'row:datasets',
    assistant: { tool: 'sheetbase.dataset.set_intended_use' },
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'plan_dataset_row',
    label: 'Plan a row',
    summary: 'Add a planned row to a dataset',
    description:
      'Adds a row that is waiting for its measurement, optionally with when it is due (`p_scheduled_at`) and a key to find it by (`p_planned_key`, such as a sample or timepoint). Committing values to it later records it. Returns the row. Sends `dataset.updated`.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_scheduled_at', 'ts', false, true),
      input('p_planned_key', 'text', false, true),
    ],
    result: 'row:dataset_rows',
    assistant: { tool: 'sheetbase.dataset.plan_rows' },
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'commit_dataset_row_batch_atomic',
    label: 'Commit a large batch of rows',
    summary: 'Commit a large batch of dataset rows in one go',
    description:
      'Commits more rows than `commit_dataset_row_batch` takes at once (it splits them into chunks) and keeps the whole batch or none of it. `p_expected_dataset_revision` refuses the commit if the dataset changed since; `p_idempotency_key` makes a retry return the first answer. Sends `dataset.updated`.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [
      input('p_dataset_id', 'uuid'),
      input('p_expected_dataset_revision', 'bigint'),
      {
        ...input('p_rows', 'json'),
        description:
          'JSON array of rows, each `{ op: "insert" | "update" | "delete", rowId?, expectedRevision?, values: { <field id>: value } }`.',
      },
      {
        ...input('p_idempotency_key', 'text'),
        server: 'idempotency',
        description:
          'Any unique string; a retry with the same key and rows returns the first result.',
      },
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'add_dataset_import_file',
    label: 'Add a file to import',
    summary: 'Add an uploaded file to be imported into a dataset',
    description:
      'Takes a file you uploaded with the files API (`p_file_id`) as a file to import: `p_format` is `csv`, `tsv`, `xlsx` or `json`, and `p_dataset_id` the dataset it is for, if you know. Returns the import file. Sends `import.file.added`.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [
      input('p_file_id', 'uuid'),
      input('p_format', 'text'),
      input('p_dataset_id', 'uuid', false, true),
    ],
    result: 'row:dataset_import_files',
    pipeline: {},
    events: [
      {
        name: 'import.file.added',
        family: 'import',
        summary: 'A file was added to be imported into a dataset.',
        producer: { entityType: 'dataset_import_file', operation: 'create' },
        notes:
          'Payload is the import file as stored, without its storage key: id, datasetId, filename, mediaType, byteSize, checksum, format and status.',
      },
      {
        name: 'import.file.read',
        family: 'import',
        summary: 'A file to import was read into rows.',
        producer: {
          entityType: 'dataset_import_file',
          operation: 'update',
          when: { key: 'status', equals: 'parsed' },
        },
      },
      {
        name: 'import.file.unreadable',
        family: 'import',
        summary: 'A file to import could not be read.',
        producer: {
          entityType: 'dataset_import_file',
          operation: 'update',
          when: { key: 'status', equals: 'failed' },
        },
        notes: 'Payload carries parseError and parserFailure.',
      },
    ],
    docsPage: 'datasets-api.md',
  },

  // -- Intake problems --------------------------------------------------------
  {
    name: 'record_intake_failure',
    label: 'Report a file that could not be brought in',
    summary: 'Report a file a connector could not bring in',
    description:
      'Records that a connector could not bring a file in, with a short `p_code` and a `p_message` for people. The same file failing again adds an attempt instead of a new problem. `p_source` is `agent` (a connector) or `upload`. Returns the problem. Sends `intake.failed`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_connector_id', 'uuid'),
      input('p_file_name', 'text'),
      input('p_source', 'text'),
      input('p_code', 'text'),
      input('p_message', 'text'),
      input('p_file_record_id', 'uuid', false, true),
      input('p_checksum', 'text', false, true),
      input('p_byte_size', 'bigint', false, true),
      input('p_parser_key', 'text', false, true),
      input('p_target', 'json', false),
      input('p_connector_run_id', 'uuid', false, true),
    ],
    result: 'row:intake_failures',
    pipeline: {},
    events: [
      {
        name: 'intake.failed',
        family: 'import',
        summary: 'A connector or an upload could not bring a file in.',
        producer: { entityType: 'intake_failure', operation: 'create' },
        notes:
          'Payload is the problem as stored: connectorId, instrumentId, fileName, code, message, parserKey, attempts and status.',
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'resolve_intake_failure',
    label: 'Close an intake problem',
    summary: 'Close a problem bringing a file in',
    description:
      'Closes an open intake problem: `p_resolution` is `resolved` (it came in after all, with the connector run that did it as `p_run_id`) or `dismissed`. Returns the problem. Sends `intake.resolved`.',
    kind: 'write',
    inputs: [
      input('p_failure_id', 'uuid'),
      input('p_resolution', 'text'),
      input('p_run_id', 'uuid', false, true),
    ],
    result: 'row:intake_failures',
    assistant: { tool: 'sheetbase.intake.resolve' },
    pipeline: {},
    events: [
      {
        name: 'intake.resolved',
        family: 'import',
        summary: 'A problem bringing a file in was resolved or dismissed.',
        producer: { entityType: 'intake_failure', operation: 'resolve' },
      },
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'resolve_intake_failures_for_file',
    label: 'Close the problems for a file that came in',
    summary: 'Close every open problem for a file that has now come in',
    description:
      'Marks every open problem a connector had with the file of this checksum as resolved by connector run `p_run_id`. A connector calls it after a file finally comes in. Returns how many it closed. Sends `intake.resolved` for each.',
    kind: 'write',
    inputs: [
      input('p_connector_id', 'uuid'),
      input('p_checksum', 'text'),
      input('p_run_id', 'uuid'),
    ],
    result: 'int',
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'link_intake_dataset',
    label: 'File a dataset from a connector',
    summary: 'File a dataset a connector made in a project and run',
    description:
      'Files a dataset a connector made: in project `p_project_id`, against instrument run `p_run_id` and its experiments, and records which connector run made it. Returns what it linked.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_dataset_id', 'uuid'),
      input('p_project_id', 'uuid', true, true),
      input('p_run_id', 'uuid', true, true),
      input('p_connector_run_id', 'uuid', true, true),
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'attach_instrument_raw_file',
    label: 'Attach a raw file to an instrument run',
    summary: 'Attach an uploaded raw file to an instrument run',
    description:
      'Keeps a file you uploaded with the files API (`p_file_id`) as a raw file of instrument run `p_run_id`, as it came off the instrument. `p_ingestion_status` is `pending` (default), `complete`, `partial` or `failed`, with `p_error_detail`. Returns the raw file. Sends `instrument.raw_file.added`.',
    kind: 'write',
    inputs: [
      input('p_run_id', 'uuid'),
      input('p_file_id', 'uuid'),
      input('p_ingestion_status', 'text', false),
      input('p_error_detail', 'text', false, true),
    ],
    result: 'row:instrument_raw_files',
    pipeline: {},
    events: [
      {
        name: 'instrument.raw_file.added',
        family: 'instrument',
        summary: 'A raw file was kept with an instrument run.',
        producer: { entityType: 'instrument_raw_file', operation: 'create' },
        notes:
          'Payload is the raw file as stored, without its storage key: runId, fileId, filename, mediaType, sizeBytes, checksum and ingestionStatus.',
      },
    ],
    docsPage: 'datasets-api.md',
  },
  // -- Promoting a sheet column: requests, calculations and applying ----------
  // (`preview_local_field_promotion` and `promote_local_field` are declared
  // with record types, in `src/features/schema`.)
  {
    name: 'preview_calculation_promotion',
    label: 'Check a sheet calculation can be promoted',
    summary: 'Check whether a sheet calculation can become a shared one',
    description:
      'Says whether calculation `p_calculation_id` of sheet `p_instance_id` can move to its sheet definition or a measurement table (`p_target`), and why not when it cannot. Changes nothing.',
    kind: 'read',
    scope: 'schema:read',
    inputs: [
      input('p_instance_id', 'uuid'),
      input('p_calculation_id', 'uuid'),
      input('p_target', 'text'),
    ],
    docsPage: 'datasets-api.md',
  },
  {
    name: 'promote_calculation',
    label: 'Promote a sheet calculation',
    summary:
      'Move a sheet calculation to its definition or a measurement table',
    description:
      'Moves calculation `p_calculation_id` of sheet `p_instance_id` to its sheet definition or to a draft of measurement table `p_schema_definition_id` (`p_target`). Returns what changed.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_instance_id', 'uuid'),
      input('p_calculation_id', 'uuid'),
      input('p_target', 'text'),
      input('p_schema_definition_id', 'uuid', true, true),
      {
        ...input('p_idempotency_key', 'text'),
        server: 'idempotency',
        description:
          'Any unique string; a retry with the same key returns the first result.',
      },
      input('p_schema_version_id', 'uuid', false),
      input('p_expected_revision', 'bigint', false),
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'request_column_promotion',
    label: 'Ask for a sheet column to be promoted',
    summary: 'Ask for a sheet column to become a shared field, for approval',
    description:
      'Asks for column `p_field_id` of sheet `p_instance_id` to become a field of a measurement table or record type, with `p_reason`, when the workspace wants promotions approved. The approval is a person’s; once approved, `apply_column_promotion` makes the change. Returns the promotion.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_instance_id', 'uuid'),
      input('p_field_id', 'uuid'),
      input('p_target', 'text'),
      input('p_schema_definition_id', 'uuid', true, true),
      input('p_model_key', 'text', true, true),
      input('p_reason', 'text', true, true),
      {
        ...input('p_idempotency_key', 'text'),
        server: 'idempotency',
        description:
          'Any unique string; a retry with the same key returns the first result.',
      },
      input('p_expected_revision', 'bigint', false),
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  {
    name: 'apply_column_promotion',
    label: 'Apply an approved column promotion',
    summary: 'Make the change an approved column promotion asked for',
    description:
      'Applies promotion `p_promotion_id` once it has been approved: the column joins the measurement table and its values move with it. `p_idempotency_key` (a uuid) makes a retry return the first result. Returns what changed.',
    kind: 'write',
    scope: 'schema:write',
    inputs: [
      input('p_promotion_id', 'uuid'),
      {
        ...input('p_idempotency_key', 'uuid'),
        description:
          'Any new uuid; a retry with the same key returns the first result.',
      },
    ],
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
  // -- Plate readings ---------------------------------------------------------
  {
    name: 'create_plate_snapshot',
    label: 'Keep a plate reading',
    summary: 'Keep a snapshot of a plate read on an instrument run',
    description:
      'Keeps the wells of a plate read during instrument run `p_run_id`: `p_wells` maps well names to values, `p_plate_format` is the number of wells (`96` by default), with an optional cycle number and time. Returns the snapshot.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_run_id', 'uuid'),
      input('p_wells', 'json'),
      input('p_plate_format', 'text', false),
      input('p_cycle_number', 'int', false),
      input('p_captured_at', 'ts', false),
      input('p_observation_id', 'uuid', false),
    ],
    result: 'row:instrument_plate_snapshots',
    pipeline: {},
    docsPage: 'datasets-api.md',
  },
])
