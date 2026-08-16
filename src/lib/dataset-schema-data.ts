/**
 * SCI-010 compatibility Dataset schema registry (decision 0034, ADR 0038).
 * Canonical governed Dataset Schema management is CORE-02
 * (`api.dataset_schema_definitions` and `src/lib/dataset-schema-definition-rpc.ts`).
 * Do not add new governed version semantics here.
 */

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import {
  fieldDefinitionFromDatasetSchemaField,
  validateFieldDefinition,
} from './field-definition'
import type {
  FieldDefinition,
  FieldLogicalType,
  FieldRelationship,
} from './field-definition'

// --- Wire types (PostgREST snake_case) ----------------------------------

export interface DatasetSchemaFieldWire {
  id: string
  schema_id: string
  workspace_id: string
  slug: string
  label: string
  description: string | null
  display_order: number
  logical_type: FieldLogicalType
  nullable: boolean
  default_value: unknown
  unit: unknown
  validation: Record<string, unknown>
  lifecycle: 'active' | 'retired'
  created_at: string
  updated_at: string
}

export interface DatasetSchemaWire {
  id: string
  workspace_id: string
  slug: string
  name: string
  description: string | null
  revision: number
  status: 'draft' | 'published' | 'retired'
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface DatasetSchemaWithFields {
  schema: DatasetSchemaWire
  fields: DatasetSchemaFieldWire[]
}

/**
 * Dataset-specific semantics on top of canonical fields. Dataset rows use
 * field slugs as their stable shape keys; physical storage is intentionally
 * outside this registry contract and belongs to CORE-02.
 */
export interface DatasetRowShape {
  kind: 'dataset-row'
  fieldsByKey: Record<string, string>
}

export interface DatasetSchemaDefinition {
  schemaId: string
  schemaKey: string
  revision: number
  lifecycle: 'draft' | 'active' | 'retired'
  fields: FieldDefinition[]
  rowShape: DatasetRowShape
}

export interface DatasetQueryRow {
  row_id: string
  table_id: string
  record_id: string
  field_values: Record<string, unknown>
}

export type RelationshipType = 'references' | 'derives_from' | 'composed_of'
export type RelationshipCardinality =
  'one_to_one' | 'one_to_many' | 'many_to_many'

export interface DatasetSchemaRelationshipWire {
  id: string
  workspace_id: string
  source_schema_id: string
  target_schema_id: string
  relationship_type: RelationshipType
  label: string
  cardinality: RelationshipCardinality
  source_field_id: string | null
  target_field_id: string | null
  lifecycle: 'active' | 'inactive'
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface CreateSchemaRelationshipInput {
  source_schema_id: string
  target_schema_id: string
  relationship_type: RelationshipType
  label?: string
  cardinality?: RelationshipCardinality
  source_field_id?: string | null
  target_field_id?: string | null
}

// --- Input types ---------------------------------------------------------

export interface DatasetSchemaFieldInput {
  slug: string
  label: string
  logical_type: FieldLogicalType
  nullable?: boolean
  default_value?: unknown
  unit?: Record<string, unknown>
  validation?: Record<string, unknown>
  description?: string
  /** SCI-011: for `reference` fields, the target schema to link to. */
  target_schema_id?: string | null
}

export interface CreateDatasetSchemaInput {
  slug: string
  name: string
  description?: string
  fields: DatasetSchemaFieldInput[]
}

function schemaLifecycle(
  status: DatasetSchemaWire['status'],
): DatasetSchemaDefinition['lifecycle'] {
  if (status === 'draft') return 'draft'
  if (status === 'published') return 'active'
  return 'retired'
}

/**
 * Projects a persisted Dataset field through the shared kernel. The existing
 * schema-relationship edge is the authoritative reference target. Its graph
 * cardinality is deliberately not treated as a row-cell cardinality: current
 * Dataset fields persist scalar values, and `many` awaits CORE-02 storage.
 */
export function datasetFieldDefinitionFromWire(
  field: DatasetSchemaFieldWire,
  relationships: DatasetSchemaRelationshipWire[],
): FieldDefinition {
  const referenceEdges = relationships.filter(
    (relationship) =>
      relationship.lifecycle === 'active' &&
      relationship.relationship_type === 'references' &&
      relationship.source_field_id === field.id,
  )
  if (referenceEdges.length > 1) {
    throw new Error(
      `Dataset field ${field.id} has multiple active reference targets.`,
    )
  }

  const relationship: FieldRelationship | null = referenceEdges[0]
    ? {
        target: {
          kind: 'dataset-schema',
          schemaId: referenceEdges[0].target_schema_id,
        },
        cardinality: 'one',
      }
    : null
  const definition = fieldDefinitionFromDatasetSchemaField({
    id: field.id,
    slug: field.slug,
    label: field.label,
    description: field.description,
    logicalType: field.logical_type,
    nullable: field.nullable,
    defaultValue: field.default_value,
    unit:
      field.unit !== null && typeof field.unit === 'object'
        ? (field.unit as Record<string, unknown>)
        : null,
    validation: field.validation,
    relationship,
    lifecycle: field.lifecycle,
  })
  const issues = validateFieldDefinition(definition)
  if (issues.length > 0) {
    throw new Error(
      `Invalid Dataset field ${field.id}: ${issues.map((issue) => issue.message).join(' ')}`,
    )
  }
  return definition
}

export function datasetSchemaDefinitionFromWire(
  schema: DatasetSchemaWire,
  fields: DatasetSchemaFieldWire[],
  relationships: DatasetSchemaRelationshipWire[],
): DatasetSchemaDefinition {
  const definitions = fields.map((field) =>
    datasetFieldDefinitionFromWire(field, relationships),
  )
  const fieldsByKey: Record<string, string> = {}
  for (const field of definitions) {
    if (field.lifecycle !== 'active') continue
    if (fieldsByKey[field.key]) {
      throw new Error(
        `Dataset schema ${schema.id} has duplicate field key ${field.key}.`,
      )
    }
    fieldsByKey[field.key] = field.fieldId
  }
  return {
    schemaId: schema.id,
    schemaKey: schema.slug,
    revision: schema.revision,
    lifecycle: schemaLifecycle(schema.status),
    fields: definitions,
    rowShape: { kind: 'dataset-row', fieldsByKey },
  }
}

// --- Query keys ----------------------------------------------------------

export const datasetSchemaQueryKeys = {
  list: ['dataset-schemas'] as const,
  detail: (id: string) => ['dataset-schema', id] as const,
  fields: (schemaId: string) => ['dataset-schema-fields', schemaId] as const,
  published: ['dataset-schemas-published'] as const,
  relationships: (workspaceId: string) =>
    ['dataset-schema-relationships', workspaceId] as const,
}

export const datasetSchemaDataClient = createDataClient()

// --- CRUD functions ------------------------------------------------------

export async function fetchDatasetSchemas(
  client: DataClient = datasetSchemaDataClient,
): Promise<DatasetSchemaWire[]> {
  return client.list<DatasetSchemaWire>(
    'dataset_schemas',
    '?order=slug.asc,revision.desc',
  )
}

export async function fetchPublishedDatasetSchemas(
  client: DataClient = datasetSchemaDataClient,
): Promise<DatasetSchemaWire[]> {
  return client.list<DatasetSchemaWire>(
    'dataset_schemas',
    '?status=eq.published&order=slug.asc,revision.desc',
  )
}

export async function fetchDatasetSchemaFields(
  client: DataClient,
  schemaId: string,
): Promise<DatasetSchemaFieldWire[]> {
  return client.list<DatasetSchemaFieldWire>(
    'dataset_schema_fields',
    `?schema_id=eq.${encodeURIComponent(schemaId)}&order=display_order.asc`,
  )
}

/** Fetch the canonical Dataset schema contract used by future Dataset work. */
export async function fetchDatasetSchemaDefinition(
  client: DataClient,
  schemaId: string,
): Promise<DatasetSchemaDefinition> {
  const [schemas, fields, relationships] = await Promise.all([
    client.list<DatasetSchemaWire>(
      'dataset_schemas',
      `?id=eq.${encodeURIComponent(schemaId)}`,
    ),
    fetchDatasetSchemaFields(client, schemaId),
    fetchDatasetSchemaRelationships(client),
  ])
  if (schemas.length === 0) throw new Error('Dataset schema not found.')
  return datasetSchemaDefinitionFromWire(schemas[0], fields, relationships)
}

export async function createDatasetSchema(
  _client: DataClient,
  _input: CreateDatasetSchemaInput,
): Promise<DatasetSchemaWithFields> {
  throw new Error(
    'SCI-010 Dataset Schema writes are closed. Use createDatasetSchemaDefinition on /configure.',
  )
}

export async function addDatasetSchemaField(
  _client: DataClient,
  _schemaId: string,
  _field: Omit<DatasetSchemaFieldInput, 'slug'> & { slug: string },
): Promise<DatasetSchemaFieldWire> {
  throw new Error(
    'SCI-010 Dataset Schema writes are closed. Use CORE-02 Dataset Schema versions on /configure.',
  )
}

export async function retireDatasetSchemaField(
  _client: DataClient,
  _fieldId: string,
): Promise<{ retired: boolean; fieldId: string }> {
  throw new Error(
    'SCI-010 Dataset Schema writes are closed. Use CORE-02 Dataset Schema versions on /configure.',
  )
}

export async function publishDatasetSchema(
  _client: DataClient,
  _schemaId: string,
): Promise<{ published: boolean; schemaId: string; revision: number }> {
  throw new Error(
    'SCI-010 Dataset Schema writes are closed. Use publishDatasetSchemaVersion on /configure.',
  )
}

export async function instantiateDatasetSchema(
  _client: DataClient,
  _blockId: string,
  _schemaId: string,
  _name?: string,
  _description?: string,
): Promise<unknown> {
  throw new Error(
    'SCI-010 sheet instantiation is closed. Use insertSheetInstanceBlock.',
  )
}

export async function upgradeScientificSchema(
  _client: DataClient,
  _tableId: string,
  _targetRevision: number,
): Promise<{
  upgraded: boolean
  tableId: string
  fromRevision: number
  toRevision: number
  addedColumnIds: string[]
}> {
  throw new Error(
    'SCI-010 schema upgrades are closed. Convert the sheet or use CORE-02 Dataset Schemas.',
  )
}

export async function bindLegacySheet(
  _client: DataClient,
  _tableId: string,
  _schemaName?: string,
): Promise<never> {
  throw new Error(
    'SCI-010 bind_legacy_sheet is removed. Use CORE-02 Datasets and CORE-03 Sheet Instances.',
  )
}

export async function queryDataset(
  _client: DataClient,
  _schemaId: string,
  _revision: number,
  _filters?: Record<string, unknown>,
  _limit?: number,
  _offset?: number,
  _expand?: Record<string, { depth: number }>,
): Promise<DatasetQueryRow[]> {
  throw new Error(
    'SCI-010 query_dataset is removed. Use query_dataset_rows on CORE-02 Datasets.',
  )
}

// --- Relationship functions (SCI-011) ------------------------------------

export async function fetchDatasetSchemaRelationships(
  client: DataClient = datasetSchemaDataClient,
): Promise<DatasetSchemaRelationshipWire[]> {
  return client.list<DatasetSchemaRelationshipWire>(
    'dataset_schema_relationships',
    '?lifecycle=eq.active&order=created_at.asc',
  )
}

export async function createSchemaRelationship(
  client: DataClient,
  input: CreateSchemaRelationshipInput,
): Promise<DatasetSchemaRelationshipWire> {
  return client.rpc<DatasetSchemaRelationshipWire>(
    'create_schema_relationship',
    {
      p_source_schema_id: input.source_schema_id,
      p_target_schema_id: input.target_schema_id,
      p_relationship_type: input.relationship_type,
      p_label: input.label ?? '',
      p_cardinality: input.cardinality ?? 'one_to_many',
      p_source_field_id: input.source_field_id ?? null,
      p_target_field_id: input.target_field_id ?? null,
    },
  )
}

export async function deleteSchemaRelationship(
  client: DataClient,
  relationshipId: string,
): Promise<{ deleted: boolean; relationshipId: string }> {
  return client.rpc('delete_schema_relationship', {
    p_relationship_id: relationshipId,
  })
}
