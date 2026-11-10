import type { DataClient } from './data-client'
import { z } from 'zod'
import { modelFieldValidationSchema, modelMetadataSchema } from './model-fields'
import { pipelineJsonValueSchema } from './pipelines/types'

export const datasetFieldQuantitySchema = modelMetadataSchema({
  kind: z.string(),
  dimension: z.string(),
  storageUnit: z.string(),
  allowedInputUnits: z.array(z.string()).optional(),
  preferredDisplayUnit: z.string().optional(),
})

export const datasetFieldCategoryOptionSchema = modelMetadataSchema({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  lifecycle: z.enum(['active', 'retired']),
  displayOrder: z.number().optional(),
})

export const datasetFieldCategorySchema = z.union([
  z.string(),
  modelMetadataSchema({
    kind: z.string().optional(),
    vocabularyId: z.string().optional(),
    options: z.array(datasetFieldCategoryOptionSchema).optional(),
  }),
])

export const datasetFieldRelationshipSchema = modelMetadataSchema({
  target: modelMetadataSchema({
    kind: z.string().optional(),
    modelKey: z.string().optional(),
    schemaId: z.string().optional(),
  }).optional(),
  cardinality: z.enum(['one', 'many']).optional(),
})

export interface DatasetSchemaFieldInput {
  fieldId?: string
  key: string
  label: string
  description?: string | null
  logicalType: string
  nullable?: boolean
  defaultValue?: z.core.util.JSONType
  quantity?: z.infer<typeof datasetFieldQuantitySchema> | null
  validation?: z.infer<typeof modelFieldValidationSchema>
  category?: z.infer<typeof datasetFieldCategorySchema> | null
  relationship?: z.infer<typeof datasetFieldRelationshipSchema> | null
  cardinality?: 'one' | 'many'
  lifecycle?: 'active' | 'retired'
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
    lifecycle: field.lifecycle ?? 'active',
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

/**
 * Replace a draft version's fields.
 *
 * `expectedRevision` is the revision the caller read with the fields. The
 * server refuses a save whose expectation is stale (SB001) so two editors
 * cannot silently overwrite each other, and returns the saved version so the
 * caller can keep the authoritative revision. Server-side canonical callers
 * that already hold the row lock may omit it.
 */
export async function replaceDatasetSchemaVersionFields(
  client: DataClient,
  input: {
    schemaVersionId: string
    fields: DatasetSchemaFieldInput[]
    expectedRevision?: number | null
  },
): Promise<CanonicalDatasetSchemaVersion> {
  return client.rpc<CanonicalDatasetSchemaVersion>(
    'replace_dataset_schema_version_fields',
    {
      p_schema_version_id: input.schemaVersionId,
      p_fields: input.fields.map(fieldWire),
      p_expected_revision: input.expectedRevision ?? null,
    },
  )
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

/** Discard a draft Dataset Schema Version (only a draft; SQL-gated). */
export async function deleteDatasetSchemaVersion(
  client: DataClient,
  schemaVersionId: string,
): Promise<void> {
  await client.rpc('delete_dataset_schema_version', {
    p_schema_version_id: schemaVersionId,
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
  /** The measurement table this one is a subtype of. */
  parent_id?: string | null
  lifecycle: string
  display_id: string | null
  created_at: string
  updated_at: string
  created_by_user_id: string | null
}

export interface CanonicalDatasetSchemaVersion {
  id: string
  schema_id: string
  version: number
  revision: number
  lifecycle: string
  published_at: string | null
}

export const canonicalDatasetSchemaFieldSchema = modelMetadataSchema({
  field_id: z.string(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  logical_type: z.string(),
  nullable: z.boolean(),
  default_value: pipelineJsonValueSchema.optional(),
  quantity: datasetFieldQuantitySchema.nullable().optional(),
  validation: modelFieldValidationSchema.optional(),
  cardinality: z.string(),
  lifecycle: z.string(),
  display_order: z.number(),
  category: datasetFieldCategorySchema.nullable().optional(),
  relationship: datasetFieldRelationshipSchema.nullable().optional(),
})

export type CanonicalDatasetSchemaField = z.infer<
  typeof canonicalDatasetSchemaFieldSchema
>

export async function listCanonicalDatasetSchemaDefinitions(
  client: DataClient,
): Promise<CanonicalDatasetSchemaDefinition[]> {
  return client.list(
    'dataset_schema_definitions',
    '?select=id,key,name,description,parent_id,lifecycle,display_id,created_at,updated_at,created_by_user_id&order=name.asc',
  )
}

export async function listCanonicalDatasetSchemaVersions(
  client: DataClient,
  schemaDefinitionId: string,
): Promise<CanonicalDatasetSchemaVersion[]> {
  return client.list(
    'dataset_schema_versions',
    `?schema_id=eq.${schemaDefinitionId}&select=id,schema_id,version,revision,lifecycle,published_at&order=version.desc`,
  )
}

export async function listCanonicalDatasetSchemaVersionFields(
  client: DataClient,
  schemaVersionId: string,
): Promise<CanonicalDatasetSchemaField[]> {
  const fields = await client.list(
    'dataset_schema_version_fields',
    `?schema_version_id=eq.${schemaVersionId}&select=field_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order&order=display_order.asc`,
  )

  return z.array(canonicalDatasetSchemaFieldSchema).parse(fields)
}
