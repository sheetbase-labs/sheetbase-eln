/**
 * Material stock on the token API: record a movement (receive, consume,
 * quarantine, restore) and read the counts the Materials page shows.
 */
import { t } from '#/copy'
import { defineOperations, input } from '#/lib/operations/descriptor'

export const REAGENT_OPERATIONS = defineOperations([
  {
    name: 'record_reagent_movement',
    label: t('data.pipelineActions.recordMaterialMovement'),
    summary: 'Record a stock movement on a material',
    description: t('data.pipelineActions.receiveConsumeAdjustMaterial'),
    kind: 'write',
    inputs: [
      input('p_reagent_record_id', 'uuid'),
      input('p_expected_metadata_version', 'int'),
      input('p_operation', 'text'),
      input('p_quantity_delta', 'num', false),
      input('p_reason', 'text', false, true),
    ],
    result: 'json',
    pipeline: {},
  },
  {
    name: 'reagent_attention_summary',
    label: 'Materials that need attention',
    summary: 'Count materials that are low, expiring or expired',
    description:
      'How many materials are in stock, low, expiring within the warning window (30 days unless given) or expired, as the Materials page counts them. Personal tokens: the counts are for your workspace.',
    kind: 'read',
    inputs: [input('p_expiry_warning_days', 'int', false)],
    result: 'json',
  },
])
