/**
 * Concrete request/result contracts for every API-07 allowlisted RPC.
 * OpenAPI is generated from this catalogue so a developer can integrate
 * without reading SQL or application source.
 */
import { EXTERNAL_RPC_SCOPES } from '#/lib/external-token'

export type JsonSchema = Record<string, unknown>

export interface RpcContract {
  summary: string
  description: string
  required: string[]
  properties: Record<string, JsonSchema>
  result: JsonSchema
}

const UUID: JsonSchema = { type: 'string', format: 'uuid' }
const TEXT: JsonSchema = { type: 'string' }
const BOOL: JsonSchema = { type: 'boolean' }
const INT: JsonSchema = { type: 'integer' }
const BIGINT: JsonSchema = { type: 'integer', format: 'int64' }
const TIMESTAMPTZ: JsonSchema = { type: 'string', format: 'date-time' }
const TEXT_ARRAY: JsonSchema = { type: 'array', items: { type: 'string' } }

function uuid(description: string): JsonSchema {
  return { ...UUID, description }
}
function text(description: string, extras: JsonSchema = {}): JsonSchema {
  return { ...TEXT, description, ...extras }
}
function bool(description: string): JsonSchema {
  return { ...BOOL, description }
}
function int(
  description: string,
  extras: { minimum?: number; maximum?: number; default?: number } = {},
): JsonSchema {
  return { ...INT, description, ...extras }
}
function bigint(description: string): JsonSchema {
  return { ...BIGINT, description }
}
function obj(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  description?: string,
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(description ? { description } : {}),
  }
}

function ref(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` }
}

function jsonMap(description: string): JsonSchema {
  return {
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/JsonValue' },
    description,
  }
}

const parameterInputs: JsonSchema = {
  type: 'array',
  maxItems: 64,
  items: ref('SheetParameterInput'),
  description:
    'JSON array of `{ parameterId, kind, … }` inputs. Empty array when unused. Not a map.',
}

const sheetDefinitionDecisions: JsonSchema = {
  type: 'array',
  maxItems: 512,
  items: ref('SheetDefinitionUpgradeDecision'),
  description:
    'One decision per preview conflict. Outcomes: retain-local, map (+ targetId), defer.',
}

const notebookDecisions: JsonSchema = {
  type: 'array',
  items: ref('NotebookUpgradeDecision'),
  description:
    'One decision per notebook upgrade conflict. Outcomes: keep or retarget (with optional instanceDecisions).',
}

const datasetFilter = obj(
  {
    fieldId: uuid('Active Dataset Schema field UUID.'),
    operator: {
      type: 'string',
      enum: ['eq', 'gt', 'gte', 'lt', 'lte'],
      description:
        '`eq` is valid for every logical type. `gt`/`gte`/`lt`/`lte` are valid only for integer, decimal, date and timestamp fields.',
    },
    value: {
      $ref: '#/components/schemas/JsonScalar',
      description:
        'Scalar matching the field logical type (string/number/boolean). Category and reference fields take UUIDs.',
    },
  },
  ['fieldId', 'operator', 'value'],
)

const datasetQuery = obj(
  {
    filters: {
      type: 'array',
      maxItems: 8,
      items: datasetFilter,
      description: 'At most eight filters. Combined with AND.',
    },
    sort: obj(
      {
        fieldId: uuid('Active field to sort by.'),
        direction: { type: 'string', enum: ['asc', 'desc'] },
      },
      ['fieldId', 'direction'],
    ),
  },
  [],
  'Only `filters` and `sort` are allowed. Pagination is `p_limit` / `p_offset`, not inside this object.',
)

const datasetBatchRow = obj(
  {
    operation: { type: 'string', enum: ['create', 'update'] },
    rowId: uuid('Caller-supplied row UUID. Creates must use a fresh id.'),
    expectedRevision: {
      type: 'integer',
      minimum: 1,
      description: 'Required for `update`. Must be omitted for `create`.',
    },
    values: jsonMap(
      'Map of Schema field UUID → canonical cell value (or null). Keys must be field UUIDs on the Dataset’s current Schema Version.',
    ),
  },
  ['operation', 'rowId', 'values'],
)

const datasetBatchError = obj({
  rowIndex: INT,
  rowId: UUID,
  fieldId: UUID,
  code: TEXT,
  expectedRevision: BIGINT,
  actualRevision: BIGINT,
})

const datasetQueryResult = obj(
  {
    datasetId: UUID,
    datasetRevision: BIGINT,
    offset: INT,
    limit: INT,
    totalCount: INT,
    hasMore: BOOL,
    rows: {
      type: 'array',
      items: obj(
        {
          rowId: UUID,
          revision: BIGINT,
          values: jsonMap(
            'Field UUID → canonical value (arrays when cardinality is many).',
          ),
        },
        ['rowId', 'revision', 'values'],
      ),
    },
  },
  [
    'datasetId',
    'datasetRevision',
    'offset',
    'limit',
    'totalCount',
    'hasMore',
    'rows',
  ],
)

const datasetCommitSuccess = obj(
  {
    ok: { type: 'boolean', const: true },
    datasetId: UUID,
    datasetRevision: BIGINT,
    rows: {
      type: 'array',
      items: obj(
        {
          rowId: UUID,
          revision: BIGINT,
          operation: { type: 'string', enum: ['create', 'update'] },
        },
        ['rowId', 'revision', 'operation'],
      ),
    },
    idempotent: {
      type: 'boolean',
      description:
        '`false` on the first successful commit. `true` when the same actor retries the same `p_idempotency_key` with an identical request digest. A reused key with a different digest fails with conflict.',
    },
  },
  ['ok', 'datasetId', 'datasetRevision', 'rows', 'idempotent'],
)

const datasetValidateResult = {
  oneOf: [
    obj({ ok: { type: 'boolean', const: true } }, ['ok']),
    obj(
      {
        ok: { type: 'boolean', const: false },
        errors: { type: 'array', items: datasetBatchError, minItems: 1 },
      },
      ['ok', 'errors'],
    ),
  ],
}

const recordRow = ref('RecordsRow')
const blockRow = ref('BlocksRow')
const projectRow = ref('ProjectsRow')
const datasetRow = ref('DatasetsRow')
const datasetVersionRow = ref('DatasetVersionsRow')
const sheetInstanceRow = ref('SheetInstancesRow')
const recordLinkRow = ref('RecordLinksRow')
const revisionRow = ref('RevisionsRow')

const pgrstRow = (row: JsonSchema, description: string): JsonSchema => ({
  description: `${description} PostgREST returns a JSON array of composite rows by default.`,
  oneOf: [row, { type: 'array', items: row }],
})

const sheetRecordWriteTarget = ref('SheetRecordWriteTarget')

const localFieldChange: JsonSchema = {
  oneOf: [
    obj(
      {
        operation: { type: 'string', const: 'add' },
        field: ref('SheetFieldDefinition'),
      },
      ['operation', 'field'],
    ),
    obj(
      {
        operation: { type: 'string', const: 'edit' },
        field: ref('SheetFieldDefinition'),
      },
      ['operation', 'field'],
    ),
    obj(
      {
        operation: { type: 'string', const: 'retire' },
        fieldId: UUID,
      },
      ['operation', 'fieldId'],
    ),
  ],
}

const addressedRow: JsonSchema = {
  oneOf: [
    obj(
      {
        kind: { type: 'string', const: 'composed' },
        rowKey: text('Composed row key (`sb-row-v1:<hex>`).'),
        identityValues: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { $ref: '#/components/schemas/JsonValue' },
        },
        compositionOffset: int('Current composition page offset.', {
          minimum: 0,
          maximum: 10_000,
        }),
      },
      ['kind', 'rowKey', 'identityValues', 'compositionOffset'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'local' },
        rowKey: UUID,
      },
      ['kind', 'rowKey'],
    ),
  ],
}

export const RPC_CONTRACTS: Record<string, RpcContract> = {
  create_project: {
    summary: 'Create a project',
    description:
      'Inserts a project in the JWT workspace. Returns the `api.projects` row.',
    required: ['p_title'],
    properties: { p_title: text('Project title.') },
    result: pgrstRow(projectRow, 'Created project.'),
  },
  create_record: {
    summary: 'Create a model record',
    description:
      'Creates a record and assigns a stable `{PREFIX}-YYYY-NNNN` identifier. Direct POST to `records` is also allowlisted; prefer this RPC.',
    required: [
      'p_project_id',
      'p_kind',
      'p_title',
      'p_status',
      'p_tags',
      'p_properties',
    ],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_kind: text('Record kind, e.g. experiment, sample, reagent.'),
      p_title: text('Record title.'),
      p_status: text('Lifecycle status string.'),
      p_tags: { ...TEXT_ARRAY, description: 'Tags. Pass `[]` when unused.' },
      p_properties: jsonMap(
        'Kind-specific properties object. Pass `{}` when unused.',
      ),
    },
    result: pgrstRow(recordRow, 'Created record.'),
  },
  create_record_with_blocks: {
    summary: 'Create a record with initial blocks',
    description:
      'One transaction: `create_record` plus initial notebook blocks. Use `p_expected_structure_version` on later block RPCs.',
    required: [
      'p_project_id',
      'p_kind',
      'p_title',
      'p_status',
      'p_tags',
      'p_blocks',
      'p_properties',
    ],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_kind: text('Record kind.'),
      p_title: text('Record title.'),
      p_status: text('Status.'),
      p_tags: TEXT_ARRAY,
      p_blocks: {
        type: 'array',
        items: obj(
          {
            type: text('Block type, e.g. rich_text.'),
            payload: jsonMap('Type-specific payload.'),
            order: { type: 'number' },
          },
          ['type', 'payload'],
        ),
      },
      p_properties: jsonMap('Kind-specific properties. Pass `{}` when unused.'),
    },
    result: obj(
      {
        record: recordRow,
        blocks: { type: 'array', items: blockRow },
      },
      ['record', 'blocks'],
    ),
  },
  update_block_payload: {
    summary: 'Update a block payload',
    description:
      'Fails with `stale_version` (SB001) when `p_expected_version` does not match `blocks.version`.',
    required: [
      'p_block_id',
      'p_payload',
      'p_expected_version',
      'p_payload_schema_version',
    ],
    properties: {
      p_block_id: uuid('Block UUID.'),
      p_payload: jsonMap('Replacement payload for this block type.'),
      p_expected_version: int('Current `blocks.version`.', { minimum: 1 }),
      p_payload_schema_version: int('Payload schema version.', { minimum: 1 }),
    },
    result: pgrstRow(blockRow, 'Updated block.'),
  },
  move_block: {
    summary: 'Move a block',
    description:
      'Reorders a block. Supply the neighbours that should sit after the move. Concurrency: `p_expected_structure_version`.',
    required: [
      'p_block_id',
      'p_expected_structure_version',
      'p_after_block_id',
      'p_before_block_id',
    ],
    properties: {
      p_block_id: uuid('Block to move.'),
      p_expected_structure_version: int(
        'Current `records.structure_version`.',
        {
          minimum: 1,
        },
      ),
      p_after_block_id: {
        ...UUID,
        description: 'Block that should precede this one, or null.',
        nullable: true,
      },
      p_before_block_id: {
        ...UUID,
        description: 'Block that should follow this one, or null.',
        nullable: true,
      },
    },
    result: obj(
      {
        block: blockRow,
        structure_version: INT,
        rebalanced: BOOL,
        order: { type: 'array', items: { type: 'number' } },
      },
      ['block', 'structure_version'],
    ),
  },
  archive_record: {
    summary: 'Archive a record',
    description: 'Soft-archive. Concurrency: `p_expected_metadata_version`.',
    required: ['p_record_id', 'p_expected_metadata_version'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_expected_metadata_version: int('Current `records.metadata_version`.', {
        minimum: 1,
      }),
    },
    result: pgrstRow(recordRow, 'Archived record.'),
  },
  restore_record: {
    summary: 'Restore an archived record',
    description:
      'Clears `archived_at`. Concurrency: `p_expected_metadata_version`.',
    required: ['p_record_id', 'p_expected_metadata_version'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_expected_metadata_version: int('Current `records.metadata_version`.', {
        minimum: 1,
      }),
    },
    result: pgrstRow(recordRow, 'Restored record.'),
  },
  create_record_link: {
    summary: 'Create a record link',
    description:
      'Links a source record to a target in the workspace. Unresolved targets fail as `missing_link`.',
    required: [
      'p_source_record_id',
      'p_target_kind',
      'p_target_identifier',
      'p_link_type',
      'p_target_record_id',
      'p_label',
    ],
    properties: {
      p_source_record_id: uuid('Source record.'),
      p_target_kind: text('Target kind.'),
      p_target_identifier: text('Target public identifier.'),
      p_link_type: text('Link type, e.g. protocol.'),
      p_target_record_id: {
        ...UUID,
        nullable: true,
        description: 'Target record UUID when resolved.',
      },
      p_label: {
        ...TEXT,
        nullable: true,
        description: 'Optional display label.',
      },
    },
    result: pgrstRow(recordLinkRow, 'Created link.'),
  },
  insert_block: {
    summary: 'Insert a notebook block',
    description:
      'Inserts after `p_after_block_id` (null appends). Concurrency: `p_expected_structure_version`.',
    required: [
      'p_record_id',
      'p_type',
      'p_payload',
      'p_payload_schema_version',
      'p_after_block_id',
      'p_expected_structure_version',
    ],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_type: text('Block type.'),
      p_payload: jsonMap('Block payload for this type.'),
      p_payload_schema_version: int('Payload schema version.', { minimum: 1 }),
      p_after_block_id: {
        ...UUID,
        nullable: true,
        description: 'Insert after this block; null appends.',
      },
      p_expected_structure_version: int(
        'Current `records.structure_version`.',
        {
          minimum: 1,
        },
      ),
    },
    result: obj({ block: blockRow, structure_version: INT }, [
      'block',
      'structure_version',
    ]),
  },
  delete_block: {
    summary: 'Delete a notebook block',
    description: 'Concurrency: `p_expected_structure_version`.',
    required: ['p_block_id', 'p_expected_structure_version'],
    properties: {
      p_block_id: uuid('Block UUID.'),
      p_expected_structure_version: int(
        'Current `records.structure_version`.',
        {
          minimum: 1,
        },
      ),
    },
    result: obj(
      {
        structure_version: INT,
        order: { type: 'array', items: { type: 'number' } },
      },
      ['structure_version'],
    ),
  },
  transition_record_status: {
    summary: 'Transition record status',
    description:
      'Allowed transitions are kind-specific. Disallowed transitions return `invalid_transition` (SB004). Concurrency: `p_expected_metadata_version`.',
    required: ['p_record_id', 'p_target_status', 'p_expected_metadata_version'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_target_status: text('Target status.'),
      p_expected_metadata_version: int('Current `records.metadata_version`.', {
        minimum: 1,
      }),
    },
    result: pgrstRow(recordRow, 'Updated record.'),
  },
  instantiate_template: {
    summary: 'Instantiate a protocol/notebook record template',
    description:
      'Copies a template record into a project. Notebook Template Version instantiation is `instantiate_notebook_template_version`.',
    required: [
      'p_template_record_id',
      'p_target_project_id',
      'p_target_kind',
      'p_title',
    ],
    properties: {
      p_template_record_id: uuid('Template record UUID.'),
      p_target_project_id: uuid('Destination project.'),
      p_target_kind: text('Kind for the new record.'),
      p_title: text('Title for the new record.'),
    },
    result: obj(
      {
        record: recordRow,
        blocks: { type: 'array', items: blockRow },
        revision: revisionRow,
        link: recordLinkRow,
      },
      ['record', 'blocks'],
    ),
  },
  query_dataset_rows: {
    summary: 'Query live Dataset rows',
    description:
      'Bounded window over the live Dataset. `p_query` may contain only `filters` (max 8) and `sort`. `p_limit` is 1–1000 (default 200). `p_offset` ≥ 0.',
    required: ['p_dataset_id'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_query: datasetQuery,
      p_limit: int('Page size.', { minimum: 1, maximum: 1000, default: 200 }),
      p_offset: int('Row offset.', { minimum: 0, default: 0 }),
    },
    result: datasetQueryResult,
  },
  query_dataset_version_rows: {
    summary: 'Query immutable Dataset Version rows',
    description:
      '`p_limit` 1–1000 (default 200). `p_offset` ≥ 0. No field filters; historical projection is fixed.',
    required: ['p_dataset_version_id'],
    properties: {
      p_dataset_version_id: uuid('Dataset Version UUID.'),
      p_limit: int('Page size.', { minimum: 1, maximum: 1000, default: 200 }),
      p_offset: int('Row offset.', { minimum: 0, default: 0 }),
    },
    result: obj(
      {
        datasetVersionId: UUID,
        datasetId: UUID,
        schemaVersionId: UUID,
        sourceDatasetRevision: BIGINT,
        offset: INT,
        limit: INT,
        totalCount: INT,
        rows: {
          type: 'array',
          items: obj({
            rowId: UUID,
            revision: BIGINT,
            values: jsonMap('Field UUID → canonical value.'),
          }),
        },
      },
      [
        'datasetVersionId',
        'datasetId',
        'schemaVersionId',
        'sourceDatasetRevision',
        'offset',
        'limit',
        'totalCount',
        'rows',
      ],
    ),
  },
  validate_dataset_row_batch: {
    summary: 'Validate a Dataset row batch',
    description:
      'Does not write. Requires `p_expected_dataset_revision` equal to `datasets.revision`. `p_rows` length 1–1000. Stale dataset revision returns `{ ok:false, errors:[{ code:"stale_dataset_revision" }] }` rather than throwing.',
    required: ['p_dataset_id', 'p_expected_dataset_revision', 'p_rows'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_dataset_revision: bigint('Current `datasets.revision`.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: datasetBatchRow,
      },
    },
    result: datasetValidateResult,
  },
  commit_dataset_row_batch: {
    summary: 'Commit a Dataset row batch',
    description:
      'Writes rows after the same validation as `validate_dataset_row_batch`. Idempotency field is `p_idempotency_key` (1–128 characters), scoped to the credential (or user) in the workspace. The request digest covers dataset id, expected revision and `p_rows`. Same key + same digest returns the stored result with `idempotent: true`. Same key + different digest is a conflict. Retry the identical body after transport failure; on `stale_version` / `stale_dataset_revision` re-read `datasets.revision` and use a new key.',
    required: [
      'p_dataset_id',
      'p_expected_dataset_revision',
      'p_rows',
      'p_idempotency_key',
    ],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_dataset_revision: bigint('Current `datasets.revision`.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: datasetBatchRow,
      },
      p_idempotency_key: text('Client command id. Length 1–128.', {
        minLength: 1,
        maxLength: 128,
      }),
    },
    result: datasetCommitSuccess,
  },
  snapshot_dataset: {
    summary: 'Snapshot a Dataset Version',
    description:
      'Publishes an immutable Dataset Version. Concurrency: `p_expected_dataset_revision`.',
    required: ['p_dataset_id', 'p_expected_dataset_revision', 'p_label'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_dataset_revision: bigint('Current `datasets.revision`.'),
      p_label: text('Version label.'),
    },
    result: pgrstRow(datasetVersionRow, 'Created Dataset Version.'),
  },
  archive_dataset: {
    summary: 'Archive a Dataset',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_dataset_id', 'p_expected_revision'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_revision: bigint('Current `datasets.revision`.'),
    },
    result: pgrstRow(datasetRow, 'Archived Dataset.'),
  },
  restore_dataset: {
    summary: 'Restore an archived Dataset',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_dataset_id', 'p_expected_revision'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_revision: bigint('Current `datasets.revision`.'),
    },
    result: pgrstRow(datasetRow, 'Restored Dataset.'),
  },
  query_sheet_instance_rows: {
    summary: 'Query composed Sheet Instance rows',
    description:
      '`p_limit` 1–200 (default 50). `p_offset` 0–10000. Server-side composition window; there is no client filter object. Unresolved instances fail.',
    required: ['p_instance_id'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_limit: int('Page size.', { minimum: 1, maximum: 200, default: 50 }),
      p_offset: int('Row offset.', { minimum: 0, maximum: 10_000, default: 0 }),
    },
    result: ref('QuerySheetInstanceRowsResult'),
  },
  read_sheet_instance_calculation_results: {
    summary: 'Read Sheet calculation results',
    description: '`p_row_keys` is a JSON array of row-key strings to fetch.',
    required: ['p_instance_id', 'p_row_keys'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_row_keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Row keys (`sb-row-v1:…` or UUID).',
      },
    },
    result: ref('SheetCalculationResultsPage'),
  },
  resolve_sheet_instance_row_identity: {
    summary: 'Resolve Sheet row identity',
    description:
      'Computes resolved row identity. Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current `sheet_instances.revision`.'),
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  preview_sheet_instance_composition_adoption: {
    summary: 'Preview composition adoption',
    description:
      'Read-only preview. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
      'p_parameter_inputs',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Sheet Definition Version.'),
      p_parameter_inputs: parameterInputs,
    },
    result: ref('CompositionAdoptionPreview'),
  },
  preview_sheet_materialization: {
    summary: 'Preview Sheet materialization',
    description: 'Read-only. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_output_schema_version_id',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_output_schema_version_id: uuid('Output Dataset Schema Version.'),
    },
    result: ref('MaterializationPreview'),
  },
  preview_sheet_instance_definition_upgrade: {
    summary: 'Preview Sheet Definition upgrade',
    description: 'Read-only. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Definition Version.'),
    },
    result: ref('SheetDefinitionUpgradePreview'),
  },
  create_sheet_instance: {
    summary: 'Create a Sheet Instance',
    description:
      '`p_state` is the instance state object (presentation, bindings, …). Does not author a Sheet Definition.',
    required: [
      'p_workspace_id',
      'p_name',
      'p_description',
      'p_source_definition_version_id',
      'p_project_id',
      'p_notebook_record_id',
      'p_state',
    ],
    properties: {
      p_workspace_id: uuid('Must match the JWT workspace_id.'),
      p_name: text('Instance name.'),
      p_description: { ...TEXT, nullable: true },
      p_source_definition_version_id: {
        ...UUID,
        nullable: true,
        description: 'Published Definition Version, or null for ad-hoc.',
      },
      p_project_id: { ...UUID, nullable: true },
      p_notebook_record_id: { ...UUID, nullable: true },
      p_state: ref('SheetInstanceState'),
    },
    result: pgrstRow(sheetInstanceRow, 'Created instance.'),
  },
  create_sheet_instance_from_definition: {
    summary: 'Create a Sheet Instance from a published Definition',
    description:
      'Source Definition Version must be published and active in the workspace.',
    required: [
      'p_workspace_id',
      'p_name',
      'p_description',
      'p_source_definition_version_id',
      'p_project_id',
      'p_notebook_record_id',
      'p_state',
      'p_parameter_inputs',
    ],
    properties: {
      p_workspace_id: uuid('JWT workspace.'),
      p_name: text('Instance name.'),
      p_description: { ...TEXT, nullable: true },
      p_source_definition_version_id: uuid('Published Definition Version.'),
      p_project_id: { ...UUID, nullable: true },
      p_notebook_record_id: { ...UUID, nullable: true },
      p_state: ref('SheetInstanceState'),
      p_parameter_inputs: parameterInputs,
    },
    result: pgrstRow(sheetInstanceRow, 'Created instance.'),
  },
  update_sheet_instance: {
    summary: 'Replace Sheet Instance state',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision', 'p_state'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
      p_state: ref('SheetInstanceState'),
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  archive_sheet_instance: {
    summary: 'Archive a Sheet Instance',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
    },
    result: pgrstRow(sheetInstanceRow, 'Archived instance.'),
  },
  restore_sheet_instance: {
    summary: 'Restore a Sheet Instance',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
    },
    result: pgrstRow(sheetInstanceRow, 'Restored instance.'),
  },
  duplicate_sheet_instance: {
    summary: 'Duplicate a Sheet Instance',
    description: 'Concurrency on the source: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision', 'p_name'],
    properties: {
      p_instance_id: uuid('Source instance.'),
      p_expected_revision: bigint('Current source revision.'),
      p_name: text('Name for the copy.'),
    },
    result: pgrstRow(sheetInstanceRow, 'New instance.'),
  },
  mutate_sheet_instance_local_state: {
    summary: 'Mutate local Sheet cells/fields/rows',
    description:
      'Concurrency: `p_expected_revision`. `p_retry_token` is a UUID used to retry the same mutation. `p_field_changes` max 32, `p_rows` max 200, `p_cells` max 1000.',
    required: [
      'p_instance_id',
      'p_expected_revision',
      'p_retry_token',
      'p_field_changes',
      'p_rows',
      'p_cells',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
      p_retry_token: uuid('Caller-generated retry token.'),
      p_field_changes: {
        type: 'array',
        maxItems: 32,
        items: localFieldChange,
      },
      p_rows: { type: 'array', maxItems: 200, items: addressedRow },
      p_cells: {
        type: 'array',
        maxItems: 1000,
        items: obj(
          {
            rowKey: TEXT,
            fieldId: UUID,
            value: {
              $ref: '#/components/schemas/JsonValue',
              description: 'Canonical cell value.',
            },
          },
          ['rowKey', 'fieldId', 'value'],
        ),
      },
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  mutate_sheet_instance_calculations: {
    summary: 'Mutate Sheet calculations',
    description: 'Concurrency: `p_expected_revision`. `p_retry_token` UUID.',
    required: [
      'p_instance_id',
      'p_expected_revision',
      'p_retry_token',
      'p_changes',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
      p_retry_token: uuid('Retry token.'),
      p_changes: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        description:
          'JSON array of add/edit `{ operation, calculation }` or retire `{ operation, calculationId }`.',
        items: ref('SheetCalculationChange'),
      },
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  insert_sheet_instance_block: {
    summary: 'Insert a Sheet Instance notebook block',
    description:
      'Concurrency: `p_expected_structure_version` on the notebook record.',
    required: [
      'p_record_id',
      'p_after_block_id',
      'p_expected_structure_version',
      'p_instance_id',
    ],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_after_block_id: { ...UUID, nullable: true },
      p_expected_structure_version: int('Current structure version.', {
        minimum: 1,
      }),
      p_instance_id: uuid('Sheet Instance to embed.'),
    },
    result: ref('InsertSheetInstanceBlockResult'),
  },
  duplicate_sheet_instance_block: {
    summary: 'Duplicate a Sheet Instance block',
    description: 'Concurrency: `p_expected_structure_version`.',
    required: ['p_block_id', 'p_expected_structure_version'],
    properties: {
      p_block_id: uuid('Sheet block UUID.'),
      p_expected_structure_version: int('Current structure version.', {
        minimum: 1,
      }),
    },
    result: ref('InsertSheetInstanceBlockResult'),
  },
  apply_sheet_instance_composition_adoption: {
    summary: 'Apply composition adoption',
    description:
      'Concurrency: `p_expected_instance_revision`. `p_retry_token` UUID.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
      'p_parameter_inputs',
      'p_retry_token',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Definition Version.'),
      p_parameter_inputs: parameterInputs,
      p_retry_token: uuid('Retry token.'),
    },
    result: ref('CompositionAdoptionApplyResult'),
  },
  materialize_sheet_instance: {
    summary: 'Materialize a Sheet into a Dataset',
    description:
      'Idempotency field is `p_idempotency_key` (UUID). Same key + same digest returns `{ idempotent: true, materializationId, datasetId, datasetVersionId }`. Pass `p_preview_digest` from `preview_sheet_materialization`. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_output_name',
      'p_output_schema_version_id',
      'p_preview_digest',
      'p_idempotency_key',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_output_name: text('Output Dataset name.', {
        minLength: 1,
        maxLength: 200,
      }),
      p_output_schema_version_id: uuid('Output Schema Version.'),
      p_preview_digest: text('Digest from preview_sheet_materialization.'),
      p_idempotency_key: uuid('Command UUID.'),
    },
    result: ref('MaterializationResult'),
  },
  apply_sheet_instance_definition_upgrade: {
    summary: 'Apply Sheet Definition upgrade',
    description: 'Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
      'p_decisions',
      'p_parameter_inputs',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Definition Version.'),
      p_decisions: sheetDefinitionDecisions,
      p_parameter_inputs: parameterInputs,
    },
    result: ref('SheetDefinitionUpgradeApplyResult'),
  },
  validate_sheet_record_batch: {
    summary: 'Validate a Sheet→Record batch',
    description:
      'Does not write. `p_rows` are mapping preview rows for `p_model_key` in `p_project_id`. Result `rows[].classification` is `create`, `match` or `invalid`.',
    required: ['p_project_id', 'p_model_key', 'p_rows'],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_model_key: text('Model key, e.g. sample.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: ref('SheetRecordBatchRow'),
      },
    },
    result: ref('SheetRecordBatchValidateResult'),
  },
  search: {
    summary: 'Workspace search',
    description:
      'All filters optional. `p_limit` clamped to 1–100 (default 20). `p_offset` default 0. Empty `p_query` browses. Returns a JSON array; `total_count` is repeated on each row.',
    required: [],
    properties: {
      p_query: text('Plain search text. No tsquery syntax.', { default: '' }),
      p_project_id: {
        ...UUID,
        nullable: true,
        description: 'Filter by project.',
      },
      p_kind: {
        ...TEXT,
        nullable: true,
        description:
          'experiment, sample, reagent, protocol_template, report, file, notebook_template.',
      },
      p_status: { ...TEXT, nullable: true },
      p_owner_id: {
        ...TEXT,
        nullable: true,
        description: 'created_by_user_id.',
      },
      p_date_from: {
        ...TIMESTAMPTZ,
        nullable: true,
        description: 'created_at >=.',
      },
      p_date_to: {
        ...TIMESTAMPTZ,
        nullable: true,
        description: 'created_at <=.',
      },
      p_limit: int('Page size, clamped 1–100.', {
        minimum: 1,
        maximum: 100,
        default: 20,
      }),
      p_offset: int('Offset.', { minimum: 0, default: 0 }),
    },
    result: {
      type: 'array',
      items: obj(
        {
          result_type: TEXT,
          record_id: UUID,
          kind: TEXT,
          identifier: TEXT,
          title: TEXT,
          status: TEXT,
          project_id: UUID,
          archived: BOOL,
          created_by_user_id: TEXT,
          created_at: TIMESTAMPTZ,
          updated_at: TIMESTAMPTZ,
          matched_context: TEXT,
          matched_field: TEXT,
          rank: { type: 'number' },
          deep_link: TEXT,
          total_count: BIGINT,
        },
        [
          'result_type',
          'record_id',
          'kind',
          'identifier',
          'title',
          'total_count',
        ],
      ),
    },
  },
  search_sheet_records: {
    summary: 'Search Model records for Sheet write-back',
    description:
      '`p_limit` is clamped to 1–50 (default 25). `p_query` matches identifier, title and custom field text (ILIKE). No offset; raise limit or narrow `p_query`.',
    required: ['p_model_key'],
    properties: {
      p_model_key: text('Model key backed by `api.records`.'),
      p_query: text('Substring match. Empty browses.', { default: '' }),
      p_limit: int('Clamped 1–50.', { minimum: 1, maximum: 50, default: 25 }),
      p_include_archived: bool('Include archived records.'),
    },
    result: {
      type: 'array',
      items: obj(
        {
          id: UUID,
          kind: TEXT,
          identifier: TEXT,
          title: TEXT,
          status: TEXT,
          archived: BOOL,
        },
        ['id', 'kind', 'identifier', 'title'],
      ),
    },
  },
  update_record_custom_fields: {
    summary: 'Update record custom fields',
    description:
      'Concurrency: `p_expected_metadata_version`. `p_values` is field-name → value.',
    required: ['p_record_id', 'p_expected_metadata_version', 'p_values'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_expected_metadata_version: int('Current metadata_version.', {
        minimum: 1,
      }),
      p_values: jsonMap('Model field name → canonical value.'),
    },
    result: pgrstRow(recordRow, 'Updated record.'),
  },
  create_and_link_sheet_record: {
    summary: 'Create a Model record and write it into a Sheet/Dataset cell',
    description:
      'Atomic create + identifier write-back. `p_write_target` identifies the Dataset cell.',
    required: [
      'p_project_id',
      'p_model_key',
      'p_title',
      'p_custom_fields',
      'p_write_target',
    ],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_model_key: text('Model key.'),
      p_title: text('New record title.'),
      p_custom_fields: jsonMap('Model field name → canonical value.'),
      p_write_target: sheetRecordWriteTarget,
    },
    result: obj(
      {
        ok: { type: 'boolean', const: true },
        recordId: UUID,
        identifier: TEXT,
        title: TEXT,
        notebookRecordLink: BOOL,
      },
      ['ok', 'recordId', 'identifier', 'title'],
    ),
  },
  commit_sheet_record_batch: {
    summary: 'Commit a Sheet→Record batch',
    description:
      'Idempotency field is `p_idempotency_key` (1–128 characters). Same actor + same key + same digest returns the stored result; a different digest conflicts.',
    required: ['p_project_id', 'p_model_key', 'p_rows', 'p_idempotency_key'],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_model_key: text('Model key.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: ref('SheetRecordBatchRow'),
      },
      p_idempotency_key: text('Command id, length 1–128.', {
        minLength: 1,
        maxLength: 128,
      }),
    },
    result: ref('SheetRecordBatchCommitResult'),
  },
  preview_submission_digest: {
    summary: 'Preview a submission digest',
    description:
      'Safe read. Returns the SHA-256 source digest a human would confirm before submit. Does not submit, sign, amend or run revision checks. `reviews:write` is not used.',
    required: ['p_record_id'],
    properties: { p_record_id: uuid('Notebook record UUID.') },
    result: obj(
      {
        recordId: UUID,
        sourceDigest: text('64-character lowercase SHA-256 hex.'),
        structureVersion: INT,
        metadataVersion: INT,
        calculationInputRevision: BIGINT,
      },
      [
        'recordId',
        'sourceDigest',
        'structureVersion',
        'metadataVersion',
        'calculationInputRevision',
      ],
    ),
  },
  instantiate_notebook_template_version: {
    summary: 'Instantiate a Notebook Template Version',
    description:
      'Idempotency field is `p_idempotency_key` (1–128 characters). Template must be instantiable (`template_not_instantiable` otherwise).',
    required: [
      'p_version_id',
      'p_target_project_id',
      'p_title',
      'p_parameter_inputs',
      'p_idempotency_key',
    ],
    properties: {
      p_version_id: uuid('Template Version UUID.'),
      p_target_project_id: uuid('Destination project.'),
      p_title: text('New notebook title.'),
      p_parameter_inputs: parameterInputs,
      p_idempotency_key: text('Command id, length 1–128.', {
        minLength: 1,
        maxLength: 128,
      }),
    },
    result: ref('InstantiateNotebookTemplateResult'),
  },
  preview_notebook_template_upgrade: {
    summary: 'Preview notebook template upgrade',
    description: 'Read-only preview against `p_target_version_id`.',
    required: ['p_record_id', 'p_target_version_id'],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_target_version_id: uuid('Target Template Version.'),
    },
    result: ref('NotebookUpgradePreview'),
  },
  apply_notebook_template_upgrade: {
    summary: 'Apply notebook template upgrade',
    description: 'Concurrency: `p_expected_structure_version`.',
    required: [
      'p_record_id',
      'p_expected_structure_version',
      'p_target_version_id',
      'p_decisions',
      'p_parameter_inputs',
    ],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_expected_structure_version: int('Current structure_version.', {
        minimum: 1,
      }),
      p_target_version_id: uuid('Target Template Version.'),
      p_decisions: notebookDecisions,
      p_parameter_inputs: parameterInputs,
    },
    result: ref('NotebookUpgradeApplyResult'),
  },
}

const missing = Object.keys(EXTERNAL_RPC_SCOPES).filter(
  (name) => !Object.hasOwn(RPC_CONTRACTS, name),
)
const extra = Object.keys(RPC_CONTRACTS).filter(
  (name) => !Object.hasOwn(EXTERNAL_RPC_SCOPES, name),
)
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `RPC_CONTRACTS must match EXTERNAL_RPC_SCOPES (missing ${missing.join(',')}; extra ${extra.join(',')})`,
  )
}

export const POSTGREST_FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'in',
  'is',
  'cs',
  'cd',
  'ov',
  'fts',
  'plfts',
  'phfts',
  'wfts',
  'not',
] as const

export const TOKEN_ERROR_CODES = [
  'invalid_request',
  'invalid_scope',
  'invalid_credential',
  'revoked',
  'expired',
  'insufficient_scope',
  'rate_limited',
  'server_error',
] as const
