/**
 * OpenAPI row/insert/patch schemas for every API-07 allowlisted table.
 * Column lists match live `api.*` (snake_case PostgREST wire).
 */
import { EXTERNAL_TABLE_ACCESS } from '#/lib/external-token'
import type { JsonSchema } from '#/lib/public-api-rpc-contracts'

const UUID: JsonSchema = { type: 'string', format: 'uuid' }
const TEXT: JsonSchema = { type: 'string' }
const BOOL: JsonSchema = { type: 'boolean' }
const INT: JsonSchema = { type: 'integer' }
const BIGINT: JsonSchema = { type: 'integer', format: 'int64' }
const TS: JsonSchema = { type: 'string', format: 'date-time' }
const NUM: JsonSchema = { type: 'number' }
const STR_ARR: JsonSchema = { type: 'array', items: { type: 'string' } }

function jsonMap(description: string): JsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    description,
  }
}

function row(
  table: string,
  extra: string,
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    description: `\`api.${table}\` row (snake_case). ${extra}`,
    required,
    properties,
  }
}

export const TABLE_ROW_SCHEMAS: Record<string, JsonSchema> = {
  blocks: row(
    'blocks',
    'Optimistic concurrency: `version`.',
    {
      id: UUID,
      record_id: UUID,
      type: TEXT,
      payload: jsonMap(
        'Type-specific block payload (e.g. rich_text doc, sheet instanceId).',
      ),
      payload_schema_version: INT,
      order: NUM,
      version: INT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: TEXT,
      updated_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'record_id',
      'type',
      'payload',
      'payload_schema_version',
      'order',
      'version',
      'created_at',
      'updated_at',
      'created_by_user_id',
    ],
  ),
  dataset_schema_definitions: row(
    'dataset_schema_definitions',
    'Catalogue; GET-only for API keys.',
    {
      id: UUID,
      workspace_id: UUID,
      key: TEXT,
      name: TEXT,
      description: { ...TEXT, nullable: true },
      lifecycle: { type: 'string', enum: ['draft', 'active', 'retired'] },
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'key',
      'name',
      'lifecycle',
      'created_at',
      'updated_at',
    ],
  ),
  dataset_schema_version_fields: row(
    'dataset_schema_version_fields',
    'Field UUID is `field_id`. Catalogue GET-only.',
    {
      id: UUID,
      schema_version_id: UUID,
      field_id: UUID,
      key: TEXT,
      label: TEXT,
      description: { ...TEXT, nullable: true },
      logical_type: {
        type: 'string',
        enum: [
          'text',
          'integer',
          'decimal',
          'boolean',
          'date',
          'timestamp',
          'category',
          'reference',
        ],
      },
      nullable: BOOL,
      default_value: {
        nullable: true,
        description: 'Canonical default or null.',
      },
      quantity: {
        oneOf: [
          { $ref: '#/components/schemas/FieldQuantity' },
          { type: 'null' },
        ],
      },
      validation: { $ref: '#/components/schemas/FieldValidation' },
      category: {
        oneOf: [
          { $ref: '#/components/schemas/FieldCategory' },
          { type: 'null' },
        ],
      },
      relationship: {
        oneOf: [
          { $ref: '#/components/schemas/FieldRelationship' },
          { type: 'null' },
        ],
      },
      cardinality: { type: 'string', enum: ['one', 'many'] },
      lifecycle: {
        type: 'string',
        enum: ['draft', 'backfilling', 'active', 'retired'],
      },
      display_order: INT,
    },
    [
      'id',
      'schema_version_id',
      'field_id',
      'key',
      'label',
      'logical_type',
      'nullable',
      'validation',
      'cardinality',
      'lifecycle',
      'display_order',
    ],
  ),
  dataset_schema_versions: row(
    'dataset_schema_versions',
    'Catalogue GET-only. Concurrency: `revision`.',
    {
      id: UUID,
      schema_id: UUID,
      version: INT,
      lifecycle: {
        type: 'string',
        enum: ['draft', 'published', 'retired', 'active'],
      },
      created_at: TS,
      updated_at: TS,
      published_at: { ...TS, nullable: true },
      created_by_user_id: { ...TEXT, nullable: true },
      revision: BIGINT,
    },
    [
      'id',
      'schema_id',
      'version',
      'lifecycle',
      'created_at',
      'updated_at',
      'revision',
    ],
  ),
  dataset_versions: row(
    'dataset_versions',
    'Immutable snapshot. No PATCH.',
    {
      id: UUID,
      dataset_id: UUID,
      workspace_id: UUID,
      schema_version_id: UUID,
      source_dataset_revision: BIGINT,
      label: TEXT,
      created_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'dataset_id',
      'workspace_id',
      'schema_version_id',
      'source_dataset_revision',
      'label',
      'created_at',
    ],
  ),
  datasets: row(
    'datasets',
    'Optimistic concurrency: `revision`. INSERT allowed; mutations use RPCs.',
    {
      id: UUID,
      workspace_id: UUID,
      primary_project_id: { ...UUID, nullable: true },
      schema_version_id: UUID,
      name: TEXT,
      description: { ...TEXT, nullable: true },
      lifecycle: { type: 'string', enum: ['active', 'archived'] },
      revision: BIGINT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'schema_version_id',
      'name',
      'lifecycle',
      'revision',
      'created_at',
      'updated_at',
    ],
  ),
  folders: row(
    'folders',
    '',
    {
      id: UUID,
      workspace_id: UUID,
      project_id: UUID,
      parent_id: { ...UUID, nullable: true },
      identifier: TEXT,
      name: TEXT,
      created_at: TS,
      updated_at: TS,
      archived_at: { ...TS, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'project_id',
      'identifier',
      'name',
      'created_at',
      'updated_at',
    ],
  ),
  notebook_template_versions: row(
    'notebook_template_versions',
    'Catalogue GET-only. `configuration` is formatVersion 1 parameters + placements.',
    {
      id: UUID,
      template_id: UUID,
      version: INT,
      lifecycle: { type: 'string', enum: ['draft', 'published', 'retired'] },
      configuration_format_version: INT,
      configuration: {
        $ref: '#/components/schemas/NotebookTemplateConfiguration',
      },
      revision: BIGINT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
      updated_by_user_id: { ...TEXT, nullable: true },
      published_at: { ...TS, nullable: true },
      published_by_user_id: { ...TEXT, nullable: true },
      retired_at: { ...TS, nullable: true },
      retired_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'template_id',
      'version',
      'lifecycle',
      'configuration_format_version',
      'configuration',
      'revision',
      'created_at',
      'updated_at',
    ],
  ),
  notebook_templates: row(
    'notebook_templates',
    'Catalogue GET-only.',
    {
      id: UUID,
      workspace_id: UUID,
      key: TEXT,
      name: TEXT,
      description: { ...TEXT, nullable: true },
      lifecycle: { type: 'string', enum: ['active', 'retired'] },
      revision: BIGINT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
      updated_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'key',
      'name',
      'lifecycle',
      'revision',
      'created_at',
      'updated_at',
    ],
  ),
  projects: row(
    'projects',
    'Stable `key` is unique per workspace.',
    {
      id: UUID,
      workspace_id: UUID,
      key: TEXT,
      title: TEXT,
      status: { type: 'string', enum: ['active', 'archived'] },
      created_at: TS,
      updated_at: TS,
      archived_at: { ...TS, nullable: true },
      custom_fields: jsonMap('Project custom field map.'),
    },
    [
      'id',
      'workspace_id',
      'key',
      'title',
      'status',
      'created_at',
      'updated_at',
      'custom_fields',
    ],
  ),
  record_field_definitions: row(
    'record_field_definitions',
    'Model field catalogue stored on records.',
    {
      id: UUID,
      workspace_id: UUID,
      kind: TEXT,
      field_name: TEXT,
      label: TEXT,
      description: { ...TEXT, nullable: true },
      display_order: INT,
      logical_type: {
        type: 'string',
        enum: [
          'text',
          'integer',
          'decimal',
          'boolean',
          'date',
          'timestamp',
          'category',
          'reference',
        ],
      },
      nullable: BOOL,
      default_value: { nullable: true },
      unit: { $ref: '#/components/schemas/FieldQuantity' },
      validation: { $ref: '#/components/schemas/FieldValidation' },
      lifecycle: {
        type: 'string',
        enum: ['draft', 'backfilling', 'active', 'retired'],
      },
      created_at: TS,
      updated_at: TS,
      created_by_user_id: TEXT,
      quantity: {
        oneOf: [
          { $ref: '#/components/schemas/FieldQuantity' },
          { type: 'null' },
        ],
      },
      cardinality: { type: 'string', enum: ['one', 'many'] },
      category_source: {
        oneOf: [
          { $ref: '#/components/schemas/FieldCategory' },
          { type: 'null' },
        ],
      },
      relationship: {
        oneOf: [
          { $ref: '#/components/schemas/FieldRelationship' },
          { type: 'null' },
        ],
      },
    },
    [
      'id',
      'workspace_id',
      'kind',
      'field_name',
      'label',
      'display_order',
      'logical_type',
      'nullable',
      'validation',
      'lifecycle',
      'created_at',
      'updated_at',
      'created_by_user_id',
      'cardinality',
    ],
  ),
  record_links: row(
    'record_links',
    '',
    {
      id: UUID,
      source_record_id: UUID,
      target_record_id: { ...UUID, nullable: true },
      target_kind: TEXT,
      target_identifier: TEXT,
      link_type: TEXT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: TEXT,
      link_metadata: jsonMap('Link metadata object.'),
    },
    [
      'id',
      'source_record_id',
      'target_kind',
      'target_identifier',
      'link_type',
      'created_at',
      'updated_at',
      'created_by_user_id',
      'link_metadata',
    ],
  ),
  records: row(
    'records',
    'Concurrency: `metadata_version`, `structure_version`.',
    {
      id: UUID,
      workspace_id: UUID,
      project_id: { ...UUID, nullable: true },
      folder_id: { ...UUID, nullable: true },
      kind: TEXT,
      identifier: TEXT,
      title: TEXT,
      status: TEXT,
      tags: STR_ARR,
      structure_version: INT,
      metadata_version: INT,
      created_at: TS,
      updated_at: TS,
      archived_at: { ...TS, nullable: true },
      deleted_at: { ...TS, nullable: true },
      created_by_user_id: TEXT,
      updated_by_user_id: { ...TEXT, nullable: true },
      calculation_input_revision: BIGINT,
      properties: jsonMap('Kind-specific properties.'),
      locked_at: { ...TS, nullable: true },
      locked_by_revision_id: { ...UUID, nullable: true },
      custom_fields: jsonMap('Model field name → canonical value.'),
      source_notebook_template_version_id: { ...UUID, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'kind',
      'identifier',
      'title',
      'status',
      'tags',
      'structure_version',
      'metadata_version',
      'created_at',
      'updated_at',
      'created_by_user_id',
      'calculation_input_revision',
      'properties',
      'custom_fields',
    ],
  ),
  revisions: row(
    'revisions',
    'GET-only. Created by human-session submit, not API keys.',
    {
      id: UUID,
      record_id: UUID,
      structure_version: INT,
      metadata_version: INT,
      metadata_snapshot: jsonMap('Frozen metadata.'),
      block_snapshot: jsonMap('Frozen ordered blocks.'),
      reason: TEXT,
      superseded_by_revision_id: { ...UUID, nullable: true },
      created_at: TS,
      updated_at: TS,
      created_by_user_id: TEXT,
      workspace_id: UUID,
      canonical_snapshot: jsonMap('Canonical evidence envelope.'),
      integrity_algorithm: TEXT,
      integrity_digest: TEXT,
    },
    [
      'id',
      'record_id',
      'structure_version',
      'metadata_version',
      'metadata_snapshot',
      'block_snapshot',
      'reason',
      'created_at',
      'updated_at',
      'created_by_user_id',
      'workspace_id',
      'canonical_snapshot',
      'integrity_algorithm',
      'integrity_digest',
    ],
  ),
  sheet_definition_versions: row(
    'sheet_definition_versions',
    'Catalogue GET-only. `configuration` is formatVersion 1 columns/bindings/parameters.',
    {
      id: UUID,
      definition_id: UUID,
      version: INT,
      lifecycle: { type: 'string', enum: ['draft', 'published', 'retired'] },
      configuration_format_version: INT,
      configuration: {
        $ref: '#/components/schemas/SheetDefinitionConfiguration',
      },
      revision: BIGINT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
      updated_by_user_id: { ...TEXT, nullable: true },
      published_at: { ...TS, nullable: true },
      published_by_user_id: { ...TEXT, nullable: true },
      retired_at: { ...TS, nullable: true },
      retired_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'definition_id',
      'version',
      'lifecycle',
      'configuration_format_version',
      'configuration',
      'revision',
      'created_at',
      'updated_at',
    ],
  ),
  sheet_definitions: row(
    'sheet_definitions',
    'Catalogue GET-only.',
    {
      id: UUID,
      workspace_id: UUID,
      key: TEXT,
      name: TEXT,
      description: { ...TEXT, nullable: true },
      lifecycle: { type: 'string', enum: ['active', 'retired'] },
      revision: BIGINT,
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
      updated_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'key',
      'name',
      'lifecycle',
      'revision',
      'created_at',
      'updated_at',
    ],
  ),
  sheet_instances: row(
    'sheet_instances',
    'Optimistic concurrency: `revision`. Mutations use RPCs, not PATCH. `state` is the Sheet Instance state object (bindings, localFields, localValues, presentation, …).',
    {
      id: UUID,
      workspace_id: UUID,
      project_id: { ...UUID, nullable: true },
      notebook_record_id: { ...UUID, nullable: true },
      source_definition_version_id: { ...UUID, nullable: true },
      name: TEXT,
      description: { ...TEXT, nullable: true },
      lifecycle: { type: 'string', enum: ['active', 'archived'] },
      revision: BIGINT,
      state: { $ref: '#/components/schemas/SheetInstanceState' },
      duplicated_from_instance_id: { ...UUID, nullable: true },
      created_at: TS,
      updated_at: TS,
      created_by_user_id: { ...TEXT, nullable: true },
      updated_by_user_id: { ...TEXT, nullable: true },
    },
    [
      'id',
      'workspace_id',
      'name',
      'lifecycle',
      'revision',
      'state',
      'created_at',
      'updated_at',
    ],
  ),
}

const INSERT_OMIT = new Set([
  'id',
  'created_at',
  'updated_at',
  'revision',
  'structure_version',
  'metadata_version',
  'calculation_input_revision',
  'lifecycle',
])

const INSERT_REQUIRED: Record<string, string[]> = {
  projects: ['workspace_id', 'key', 'title'],
  folders: ['workspace_id', 'project_id', 'identifier', 'name'],
  records: ['workspace_id', 'kind', 'identifier', 'title'],
  blocks: ['record_id', 'type', 'order'],
  record_links: [
    'source_record_id',
    'target_kind',
    'target_identifier',
    'link_type',
  ],
  record_field_definitions: [
    'workspace_id',
    'kind',
    'field_name',
    'label',
    'display_order',
    'logical_type',
  ],
  datasets: ['workspace_id', 'schema_version_id', 'name'],
}

export function tableInsertSchema(table: string): JsonSchema {
  const rowSchema = TABLE_ROW_SCHEMAS[table]
  const properties = Object.fromEntries(
    Object.entries(rowSchema.properties as Record<string, JsonSchema>).filter(
      ([key]) => !INSERT_OMIT.has(key),
    ),
  )
  return {
    type: 'object',
    additionalProperties: false,
    required: INSERT_REQUIRED[table],
    properties,
  }
}

export function tablePatchSchema(table: string): JsonSchema {
  const insert = tableInsertSchema(table)
  return {
    type: 'object',
    additionalProperties: false,
    properties: insert.properties,
    description: `Partial update of \`${table}\`. Always filter with id=eq.<uuid>.`,
  }
}

export function tableSchemaName(table: string): string {
  return `${table
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Row`
}

export function tableInsertSchemaName(table: string): string {
  return `${tableSchemaName(table)}Insert`
}

export function tablePatchSchemaName(table: string): string {
  return `${tableSchemaName(table)}Patch`
}

const missingTables = Object.keys(EXTERNAL_TABLE_ACCESS).filter(
  (name) => !Object.hasOwn(TABLE_ROW_SCHEMAS, name),
)
const extraTables = Object.keys(TABLE_ROW_SCHEMAS).filter(
  (name) => !Object.hasOwn(EXTERNAL_TABLE_ACCESS, name),
)
if (missingTables.length > 0 || extraTables.length > 0) {
  throw new Error(
    `TABLE_ROW_SCHEMAS must match EXTERNAL_TABLE_ACCESS (missing ${missingTables.join(',')}; extra ${extraTables.join(',')})`,
  )
}
