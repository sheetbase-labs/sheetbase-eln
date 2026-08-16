import type { DataClient } from './data-client'
import type { DatasetSchemaFieldInput } from './dataset-schema-definition-rpc'
import { fieldWire } from './dataset-schema-definition-rpc'

export type EvolutionClass = 'compatible' | 'migration-requiring' | 'breaking'

export interface EvolutionPreview {
  classification?: EvolutionClass | string
  blocked?: boolean
  ok?: boolean
  reason?: string | null
  impact?: unknown
  advancesLiveDatasets?: boolean
  copiesValues?: boolean
  historicalValuesRemainLocal?: boolean
  [key: string]: unknown
}

export interface EvolutionResult extends EvolutionPreview {
  idempotent?: boolean
  schemaVersionId?: string
  targetKind?: string
  targetId?: string
}

export async function previewDatasetSchemaEvolution(
  client: DataClient,
  input: { schemaVersionId: string; fields: DatasetSchemaFieldInput[] },
): Promise<EvolutionPreview> {
  return client.rpc('preview_dataset_schema_evolution', {
    p_schema_version_id: input.schemaVersionId,
    p_fields: input.fields.map(fieldWire),
  })
}

export async function applyDatasetSchemaEvolution(
  client: DataClient,
  input: {
    schemaVersionId: string
    fields: DatasetSchemaFieldInput[]
    idempotencyKey: string
    expectedRevision?: number | null
  },
): Promise<EvolutionResult> {
  return client.rpc('apply_dataset_schema_evolution', {
    p_schema_version_id: input.schemaVersionId,
    p_fields: input.fields.map(fieldWire),
    p_idempotency_key: input.idempotencyKey,
    p_expected_revision: input.expectedRevision ?? null,
  })
}

export async function previewModelFieldEvolution(
  client: DataClient,
  input: {
    definitionId: string
    action: 'update' | 'retire'
    patch?: Record<string, unknown>
  },
): Promise<EvolutionPreview> {
  return client.rpc('preview_model_field_evolution', {
    p_definition_id: input.definitionId,
    p_action: input.action,
    p_patch: input.patch ?? {},
  })
}

export async function applyModelFieldEvolution(
  client: DataClient,
  input: {
    definitionId: string
    action: 'update' | 'retire'
    patch?: Record<string, unknown>
    confirm?: boolean
  },
): Promise<EvolutionResult> {
  return client.rpc('apply_model_field_evolution', {
    p_definition_id: input.definitionId,
    p_action: input.action,
    p_patch: input.patch ?? {},
    p_confirm: input.confirm ?? false,
  })
}

export async function previewLocalFieldPromotion(
  client: DataClient,
  input: {
    instanceId: string
    fieldId: string
    target: 'dataset_schema' | 'model_field'
    schemaDefinitionId?: string | null
    modelKey?: string | null
  },
): Promise<EvolutionPreview> {
  return client.rpc('preview_local_field_promotion', {
    p_instance_id: input.instanceId,
    p_field_id: input.fieldId,
    p_target: input.target,
    p_schema_definition_id: input.schemaDefinitionId ?? null,
    p_model_key: input.modelKey ?? null,
  })
}

export async function promoteLocalField(
  client: DataClient,
  input: {
    instanceId: string
    fieldId: string
    target: 'dataset_schema' | 'model_field'
    schemaDefinitionId?: string | null
    modelKey?: string | null
    schemaVersionId?: string | null
    expectedRevision?: number | null
    idempotencyKey: string
  },
): Promise<EvolutionResult> {
  return client.rpc('promote_local_field', {
    p_instance_id: input.instanceId,
    p_field_id: input.fieldId,
    p_target: input.target,
    p_schema_definition_id: input.schemaDefinitionId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_model_key: input.modelKey ?? null,
    p_schema_version_id: input.schemaVersionId ?? null,
    p_expected_revision: input.expectedRevision ?? null,
  })
}

export async function previewCalculationPromotion(
  client: DataClient,
  input: {
    instanceId: string
    calculationId: string
    target: 'sheet_definition' | 'dataset_schema'
  },
): Promise<EvolutionPreview> {
  return client.rpc('preview_calculation_promotion', {
    p_instance_id: input.instanceId,
    p_calculation_id: input.calculationId,
    p_target: input.target,
  })
}

export async function promoteCalculation(
  client: DataClient,
  input: {
    instanceId: string
    calculationId: string
    target: 'sheet_definition' | 'dataset_schema'
    schemaDefinitionId?: string | null
    idempotencyKey: string
  },
): Promise<EvolutionResult> {
  return client.rpc('promote_calculation', {
    p_instance_id: input.instanceId,
    p_calculation_id: input.calculationId,
    p_target: input.target,
    p_schema_definition_id: input.schemaDefinitionId ?? null,
    p_idempotency_key: input.idempotencyKey,
  })
}
