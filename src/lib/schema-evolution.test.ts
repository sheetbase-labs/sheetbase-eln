import { describe, expect, it } from 'vitest'

import {
  applyDatasetSchemaEvolution,
  applyModelFieldEvolution,
  describeColumnPromotionError,
  listInstanceColumnPromotions,
  previewCalculationPromotion,
  previewDatasetSchemaEvolution,
  previewLocalFieldPromotion,
  previewModelFieldEvolution,
  promoteCalculation,
  promoteLocalField,
  requestColumnPromotion,
} from './schema-evolution'
import { DataClientError } from './data-client'
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
      expectedRevision: 1,
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
      modelKey: 'sample',
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
    expect(calls[1]?.args).toMatchObject({
      p_schema_version_id: 'ver-1',
      p_idempotency_key: 'evo-1',
      p_expected_revision: 1,
    })
    expect(calls[5]?.args).toMatchObject({
      p_target: 'model_field',
      p_model_key: 'sample',
      p_idempotency_key: 'promo-1',
    })
    expect(calls[3]?.args).toMatchObject({
      p_action: 'retire',
      p_confirm: true,
    })
  })

  it('requests a promotion and reads its state without the direct promote path', async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = []
    const listCalls: Array<{ resource: string; query?: string }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args })
        return { ok: true, state: 'pending' }
      },
      list: async (resource: string, query?: string) => {
        listCalls.push({ resource, query })
        return []
      },
    } as unknown as DataClient

    await requestColumnPromotion(client, {
      instanceId: 'inst-1',
      fieldId: 'lf-1',
      target: 'dataset_schema',
      schemaDefinitionId: 'schema-1',
      reason: 'Used in every batch',
      idempotencyKey: 'promo-req-1',
    })
    await listInstanceColumnPromotions(client, 'inst-1')

    expect(rpcCalls.map((item) => item.name)).toEqual([
      'request_column_promotion',
    ])
    expect(rpcCalls[0]?.args).toMatchObject({
      p_instance_id: 'inst-1',
      p_field_id: 'lf-1',
      p_target: 'dataset_schema',
      p_schema_definition_id: 'schema-1',
      p_model_key: null,
      p_reason: 'Used in every batch',
      p_idempotency_key: 'promo-req-1',
    })
    expect(listCalls[0]?.resource).toBe('column_promotions')
    expect(listCalls[0]?.query).toContain('sheet_instance_id=eq.inst-1')

    expect(
      describeColumnPromotionError(
        new DataClientError('SB071', 'incompatible', 400),
      ),
    ).toContain('cannot be promoted')
    expect(describeColumnPromotionError(new Error('boom'))).toContain(
      'Could not request',
    )
  })
})
