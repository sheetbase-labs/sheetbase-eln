import { describe, expect, it } from 'vitest'

import {
  applyDatasetSchemaEvolution,
  applyModelFieldEvolution,
  previewCalculationPromotion,
  previewDatasetSchemaEvolution,
  previewLocalFieldPromotion,
  previewModelFieldEvolution,
  promoteCalculation,
  promoteLocalField,
} from './schema-evolution'
import type { DataClient } from './data-client'

describe('governed evolution client', () => {
  it('calls preview and apply RPCs with snake_case arguments', async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { ok: true, classification: 'compatible' }
      },
    } as DataClient
    await previewDatasetSchemaEvolution(client, {
      schemaVersionId: 'ver-1',
      fields: [{ key: 'titre', label: 'Titre', logicalType: 'decimal' }],
    })
    await applyDatasetSchemaEvolution(client, {
      schemaVersionId: 'ver-1',
      fields: [{ key: 'titre', label: 'Titre', logicalType: 'decimal' }],
      idempotencyKey: 'evo-1',
    })
    await previewModelFieldEvolution(client, {
      definitionId: 'field-1',
      action: 'update',
      patch: { label: 'Observation' },
    })
    await applyModelFieldEvolution(client, {
      definitionId: 'field-1',
      action: 'retire',
      confirm: true,
    })
    await previewLocalFieldPromotion(client, {
      instanceId: 'inst-1',
      fieldId: 'lf-1',
      target: 'dataset_schema',
      schemaDefinitionId: 'schema-1',
    })
    await promoteLocalField(client, {
      instanceId: 'inst-1',
      fieldId: 'lf-1',
      target: 'model_field',
      idempotencyKey: 'promo-1',
    })
    await previewCalculationPromotion(client, {
      instanceId: 'inst-1',
      calculationId: 'calc-1',
      target: 'sheet_definition',
    })
    await promoteCalculation(client, {
      instanceId: 'inst-1',
      calculationId: 'calc-1',
      target: 'dataset_schema',
      schemaDefinitionId: 'schema-1',
      idempotencyKey: 'calc-1',
    })
    expect(calls.map((item) => item.name)).toEqual([
      'preview_dataset_schema_evolution',
      'apply_dataset_schema_evolution',
      'preview_model_field_evolution',
      'apply_model_field_evolution',
      'preview_local_field_promotion',
      'promote_local_field',
      'preview_calculation_promotion',
      'promote_calculation',
    ])
    expect(calls[0]?.args).toMatchObject({
      p_schema_version_id: 'ver-1',
      p_fields: [{ key: 'titre', logical_type: 'decimal' }],
    })
    expect(calls[3]?.args).toMatchObject({
      p_action: 'retire',
      p_confirm: true,
    })
  })
})
