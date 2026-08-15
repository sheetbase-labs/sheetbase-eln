import type { DataClient } from './data-client'

export interface DatasetSchemaFieldInput {
  fieldId?: string
  key: string
  label: string
  description?: string | null
  logicalType: string
  nullable?: boolean
  defaultValue?: unknown
  quantity?: unknown
  validation?: Record<string, unknown>
  category?: unknown
  relationship?: unknown
  cardinality?: 'one' | 'many'
  displayOrder?: number
}

export interface DatasetSchemaDefinitionCreated {
  schema_definition_id: string
  schema_version_id: string
}

export function fieldWire(field: DatasetSchemaFieldInput) {
  return {
    field_id: field.fieldId ?? null,
    key: field.key,
    label: field.label,
    description: field.description ?? null,
    logical_type: field.logicalType,
    nullable: field.nullable ?? true,
    default_value: field.defaultValue ?? null,
    quantity: field.quantity ?? null,
    validation: field.validation ?? {},
    category: field.category ?? null,
    relationship: field.relationship ?? null,
    cardinality: field.cardinality ?? 'one',
    display_order: field.displayOrder ?? null,
  }
}

export async function createDatasetSchemaDefinition(
  client: DataClient,
  input: {
    workspaceId: string
    key: string
    name: string
    description?: string | null
    fields?: DatasetSchemaFieldInput[]
  },
): Promise<DatasetSchemaDefinitionCreated> {
  return client.rpc('create_dataset_schema_definition', {
    p_workspace_id: input.workspaceId,
    p_key: input.key,
    p_name: input.name,
    p_description: input.description ?? null,
    p_fields: (input.fields ?? []).map(fieldWire),
  })
}

export async function replaceDatasetSchemaVersionFields(
  client: DataClient,
  input: { schemaVersionId: string; fields: DatasetSchemaFieldInput[] },
): Promise<void> {
  await client.rpc('replace_dataset_schema_version_fields', {
    p_schema_version_id: input.schemaVersionId,
    p_fields: input.fields.map(fieldWire),
  })
}

export async function publishDatasetSchemaVersion(
  client: DataClient,
  schemaVersionId: string,
): Promise<void> {
  await client.rpc('publish_dataset_schema_version', {
    p_schema_version_id: schemaVersionId,
  })
}

export async function createNextDatasetSchemaVersion(
  client: DataClient,
  schemaDefinitionId: string,
): Promise<{ schema_version_id: string; version: number }> {
  return client.rpc('create_next_dataset_schema_version', {
    p_schema_definition_id: schemaDefinitionId,
  })
}

export async function retireDatasetSchemaDefinition(
  client: DataClient,
  schemaDefinitionId: string,
): Promise<void> {
  await client.rpc('retire_dataset_schema_definition', {
    p_schema_definition_id: schemaDefinitionId,
  })
}

export async function listWorkspaceCapabilities(
  client: DataClient,
  workspaceId: string,
): Promise<string[]> {
  return client.rpc('list_capabilities', { p_workspace_id: workspaceId })
}

export interface CanonicalDatasetSchemaDefinition {
  id: string
  key: string
  name: string
  description: string | null
  lifecycle: string
  created_at: string
  updated_at: string
}

export interface CanonicalDatasetSchemaVersion {
  id: string
  schema_id: string
  version: number
  lifecycle: string
  published_at: string | null
}

export interface CanonicalDatasetSchemaField {
  field_id: string
  key: string
  label: string
  description: string | null
  logical_type: string
  nullable: boolean
  cardinality: string
  lifecycle: string
  display_order: number
}

export async function listCanonicalDatasetSchemaDefinitions(
  client: DataClient,
): Promise<CanonicalDatasetSchemaDefinition[]> {
  return client.list(
    'dataset_schema_definitions',
    '?select=id,key,name,description,lifecycle,created_at,updated_at&order=name.asc',
  )
}

export async function listCanonicalDatasetSchemaVersions(
  client: DataClient,
  schemaDefinitionId: string,
): Promise<CanonicalDatasetSchemaVersion[]> {
  return client.list(
    'dataset_schema_versions',
    `?schema_id=eq.${schemaDefinitionId}&select=id,schema_id,version,lifecycle,published_at&order=version.desc`,
  )
}

export async function listCanonicalDatasetSchemaVersionFields(
  client: DataClient,
  schemaVersionId: string,
): Promise<CanonicalDatasetSchemaField[]> {
  return client.list(
    'dataset_schema_version_fields',
    `?schema_version_id=eq.${schemaVersionId}&select=field_id,key,label,description,logical_type,nullable,cardinality,lifecycle,display_order&order=display_order.asc`,
  )
}
