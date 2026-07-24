/**
 * SCI-010: Dataset schema registry data layer. Thin, typed wrappers around
 * the PostgREST RPCs and resources for the workspace-level dataset schema
 * registry (decision 0034). All functions go through the same /api/db
 * boundary and RLS as every other resource.
 *
 * The registry provides stable schema + field identities so that sheets
 * measuring the same thing share a durable join key. Cross-sheet queries
 * (query_dataset) union rows by stable field slug, never physical column
 * name.
 */

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import type { ScientificLogicalType } from './scientific-sheet-data'

// --- Wire types (PostgREST snake_case) ----------------------------------

export interface DatasetSchemaFieldWire {
  id: string
  schema_id: string
  workspace_id: string
  slug: string
  label: string
  description: string | null
  display_order: number
  logical_type: ScientificLogicalType
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

export interface DatasetQueryRow {
  row_id: string
  table_id: string
  record_id: string
  field_values: Record<string, unknown>
}

// --- Input types ---------------------------------------------------------

export interface DatasetSchemaFieldInput {
  slug: string
  label: string
  logical_type: ScientificLogicalType
  nullable?: boolean
  default_value?: unknown
  unit?: Record<string, unknown>
  validation?: Record<string, unknown>
  description?: string
}

export interface CreateDatasetSchemaInput {
  slug: string
  name: string
  description?: string
  fields: DatasetSchemaFieldInput[]
}

// --- Query keys ----------------------------------------------------------

export const datasetSchemaQueryKeys = {
  list: ['dataset-schemas'] as const,
  detail: (id: string) => ['dataset-schema', id] as const,
  fields: (schemaId: string) => ['dataset-schema-fields', schemaId] as const,
  published: ['dataset-schemas-published'] as const,
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

export async function createDatasetSchema(
  client: DataClient,
  input: CreateDatasetSchemaInput,
): Promise<DatasetSchemaWithFields> {
  // Map frontend field keys to the keys compile_scientific_column expects.
  // The backend strips 'slug' and 'display_order' before delegating to
  // compile_scientific_column, which accepts: label, description,
  // logical_type, nullable, default, unit, validation, width, options.
  const mappedFields = input.fields.map((f) => {
    const mapped: Record<string, unknown> = {
      slug: f.slug,
      label: f.label,
      logical_type: f.logical_type,
      nullable: f.nullable ?? true,
      validation: f.validation ?? {},
    }
    if (f.description) mapped.description = f.description
    if (f.default_value !== null && f.default_value !== undefined)
      mapped.default = f.default_value
    if (f.unit && Object.keys(f.unit).length > 0) mapped.unit = f.unit
    return mapped
  })
  return client.rpc<DatasetSchemaWithFields>('create_dataset_schema', {
    p_slug: input.slug,
    p_name: input.name,
    p_description: input.description ?? null,
    p_fields: mappedFields,
  })
}

export async function addDatasetSchemaField(
  client: DataClient,
  schemaId: string,
  field: Omit<DatasetSchemaFieldInput, 'slug'> & { slug: string },
): Promise<DatasetSchemaFieldWire> {
  return client.rpc<DatasetSchemaFieldWire>('add_dataset_schema_field', {
    p_schema_id: schemaId,
    p_slug: field.slug,
    p_label: field.label,
    p_logical_type: field.logical_type,
    p_nullable: field.nullable ?? true,
    p_default: field.default_value ?? null,
    p_unit: field.unit ?? null,
    p_validation: field.validation ?? {},
    p_description: field.description ?? null,
  })
}

export async function retireDatasetSchemaField(
  client: DataClient,
  fieldId: string,
): Promise<{ retired: boolean; fieldId: string }> {
  return client.rpc('retire_dataset_schema_field', {
    p_schema_field_id: fieldId,
  })
}

export async function publishDatasetSchema(
  client: DataClient,
  schemaId: string,
): Promise<{ published: boolean; schemaId: string; revision: number }> {
  return client.rpc('publish_dataset_schema', { p_schema_id: schemaId })
}

export async function instantiateDatasetSchema(
  client: DataClient,
  blockId: string,
  schemaId: string,
  name?: string,
  description?: string,
): Promise<unknown> {
  return client.rpc('instantiate_dataset_schema', {
    p_block_id: blockId,
    p_schema_id: schemaId,
    p_name: name ?? null,
    p_description: description ?? null,
  })
}

export async function upgradeScientificSchema(
  client: DataClient,
  tableId: string,
  targetRevision: number,
): Promise<{
  upgraded: boolean
  tableId: string
  fromRevision: number
  toRevision: number
  addedColumnIds: string[]
}> {
  return client.rpc('upgrade_scientific_schema', {
    p_table_id: tableId,
    p_target_revision: targetRevision,
  })
}

export async function bindLegacySheet(
  client: DataClient,
  tableId: string,
  schemaName?: string,
): Promise<{
  bound: boolean
  tableId: string
  schemaId: string
  slug: string
  revision: number
}> {
  return client.rpc('bind_legacy_sheet', {
    p_table_id: tableId,
    p_schema_name: schemaName ?? null,
  })
}

export async function queryDataset(
  client: DataClient,
  schemaId: string,
  revision: number,
  filters?: Record<string, unknown>,
  limit?: number,
  offset?: number,
): Promise<DatasetQueryRow[]> {
  return client.rpc<DatasetQueryRow[]>('query_dataset', {
    p_schema_id: schemaId,
    p_revision: revision,
    p_filters: filters ?? {},
    p_limit: limit ?? 200,
    p_offset: offset ?? 0,
  })
}
