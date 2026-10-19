import type { DataClient } from './data-client'
import { DataClientError } from './data-client'
import type { DatasetSchemaFieldInput } from './dataset-schema-definition-rpc'
import { fieldWire } from './dataset-schema-definition-rpc'

export type EvolutionClass = 'compatible' | 'migration-requiring' | 'breaking'

export interface EvolutionPreview {
  classification?: EvolutionClass | string
  blocked?: boolean
  ok?: boolean
  reason?: string | null
  impact?: unknown
  /** MODEL-04: steward-facing migration guidance from preview_model_field_evolution. */
  guidance?: string[]
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

/**
 * SHEET-02.4 — the direct promotion path is gone from the client.
 *
 * A promotion is a request now (SHEET-02.1), decided by an approval (MDL-03) and applied by
 * api.apply_column_promotion (SHEET-02.2), so nothing here calls `promote_local_field` any
 * more: the dialog asks, the approval decides, the settle applies. The wrappers that called it
 * directly were left behind with no caller, and they are removed rather than kept as a second
 * way to promote a column.
 *
 * The `promote_local_field` RPC itself is retained. The request flow records a `model_field`
 * promotion but cannot yet apply one — api.apply_column_promotion refuses any target that is
 * not a dataset schema — so retiring the RPC now would remove the only working path for that
 * target. It retires with the model-field apply, not before it.
 */

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

// ---------------------------------------------------------------------------
// SHEET-02.3 — column promotion as a request.
//
// `request_column_promotion` is the only path a UI may take: it forks a draft
// Dataset Schema Version, records a pending `api.column_promotions` row and
// raises the MDL-03 approval, writing nothing to the dataset. The direct
// `promote_local_field` path (wrapped above) applies immediately and is not
// what a promotion dialog should call.
// ---------------------------------------------------------------------------

export type ColumnPromotionState =
  'pending' | 'approved' | 'returned' | 'applied' | 'withdrawn'

/** Wire shape of an `api.column_promotions` row (snake_case). */
export interface ColumnPromotion {
  id: string
  sheet_instance_id: string
  field_id: string
  target: 'dataset_schema' | 'model_field'
  schema_definition_id: string | null
  schema_version_id: string | null
  model_key: string | null
  state: ColumnPromotionState
  approval_request_id: string | null
  /**
   * What was asked for. On a `returned` promotion SHEET-02.2 overwrites this
   * with the approver's decision reason, so a returned row carries the reason
   * the reviewer gave.
   */
  reason: string | null
  requested_by_user_id: string
  requested_at: string
  decided_at: string | null
}

export interface ColumnPromotionRequestResult {
  ok?: boolean
  promotionId?: string
  state?: ColumnPromotionState | string
  targetKind?: string
  schemaVersionId?: string
  approvalRequestId?: string
  idempotent?: boolean
}

export async function requestColumnPromotion(
  client: DataClient,
  input: {
    instanceId: string
    fieldId: string
    target: 'dataset_schema' | 'model_field'
    schemaDefinitionId?: string | null
    modelKey?: string | null
    reason: string
    idempotencyKey: string
    expectedRevision?: number | null
  },
): Promise<ColumnPromotionRequestResult> {
  return client.rpc('request_column_promotion', {
    p_instance_id: input.instanceId,
    p_field_id: input.fieldId,
    p_target: input.target,
    p_schema_definition_id: input.schemaDefinitionId ?? null,
    p_model_key: input.modelKey ?? null,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_expected_revision: input.expectedRevision ?? null,
  })
}

const PROMOTION_SELECT =
  'id,sheet_instance_id,field_id,target,schema_definition_id,' +
  'schema_version_id,model_key,state,approval_request_id,reason,' +
  'requested_by_user_id,requested_at,decided_at'

export function listInstanceColumnPromotions(
  client: DataClient,
  instanceId: string,
): Promise<ColumnPromotion[]> {
  return client.list(
    'column_promotions',
    `?sheet_instance_id=eq.${instanceId}` +
      `&select=${PROMOTION_SELECT}&order=requested_at.desc`,
  )
}

/** Promotions still waiting on a decision or on being applied, workspace-wide. */
export function listOpenColumnPromotions(
  client: DataClient,
  instanceId?: string,
): Promise<ColumnPromotion[]> {
  return client.list(
    'column_promotions',
    '?state=eq.pending' +
      (instanceId ? `&sheet_instance_id=eq.${instanceId}` : '') +
      `&select=${PROMOTION_SELECT}&order=requested_at.desc`,
  )
}

export interface ColumnPromotionApplyResult {
  ok?: boolean
  state?: ColumnPromotionState | string
  /** True when the dataset was written; false when the decision was a return. */
  applied?: boolean
  reason?: string | null
  datasetId?: string
  datasetVersionId?: string
}

/**
 * Settle a decided promotion. After an approval this writes the dataset and
 * retires the local column; after a return or withdrawal it only records the
 * outcome. The server refuses while the approval is still pending.
 */
export function applyColumnPromotion(
  client: DataClient,
  promotionId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ColumnPromotionApplyResult> {
  return client.rpc('apply_column_promotion', {
    p_promotion_id: promotionId,
    p_idempotency_key: idempotencyKey,
  })
}

/** The server's reason for refusing a promotion, in the language of the UI. */
export function describeColumnPromotionError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not request the promotion. Try again.'
  const messages: Record<string, string> = {
    SB071:
      'Some values in this column cannot be promoted to the dataset. Fix or clear them, then try again.',
    SB072:
      'This dataset already has a draft schema version pending. Publish or discard it before promoting again.',
    '22023': 'Check the dataset and reason, then try again.',
    '42501': 'You do not have permission to promote columns in this sheet.',
  }
  return messages[error.code] ?? error.message
}
