import { z } from 'zod'

import { t } from '#/copy'
import type { ConnectorWire } from './types'

/**
 * INT-02 — the connector `config.pickup` block that file pickup reads
 * (src/lib/connectors/pickup.server.ts), as edited on the connector page.
 * Pure helpers so the form stays testable.
 */
export interface PickupFormValues {
  projectId: string
  schemaVersionId: string
  datasetId: string
  datasetNamePattern: string
  autoDetect: boolean
  instrumentId: string
}

export const DEFAULT_DATASET_NAME_PATTERN = '{connector} — {file}'

const pickupSchema = z
  .object({
    projectId: z.string().optional().catch(undefined),
    schemaVersionId: z.string().optional().catch(undefined),
    datasetId: z.string().optional().catch(undefined),
    datasetNamePattern: z.string().optional().catch(undefined),
    autoDetect: z.boolean().optional().catch(undefined),
    instrumentId: z.string().optional().catch(undefined),
  })
  .catch({})

export function pickupFormValues(
  config: ConnectorWire['config'],
): PickupFormValues {
  const pickup = pickupSchema.parse(config.pickup)

  return {
    projectId: pickup.projectId ?? '',
    schemaVersionId: pickup.schemaVersionId ?? '',
    datasetId: pickup.datasetId ?? '',
    datasetNamePattern:
      pickup.datasetNamePattern || DEFAULT_DATASET_NAME_PATTERN,
    autoDetect: pickup.autoDetect === true,
    instrumentId: pickup.instrumentId ?? '',
  }
}

/** Merges the form into the connector's existing config, keeping other keys. */
export function buildPickupConfig(
  config: ConnectorWire['config'],
  values: PickupFormValues,
):
  | { ok: true; config: ConnectorWire['config'] }
  | { ok: false; errors: Partial<Record<keyof PickupFormValues, string>> } {
  const errors: Partial<Record<keyof PickupFormValues, string>> = {}

  if (!values.projectId)
    errors.projectId = t('data.pickupConfig.chooseProjectRawFiles')

  if (!values.schemaVersionId) {
    errors.schemaVersionId = t('data.pickupConfig.chooseSchemaDataCommitted')
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const pickup: Omit<PickupFormValues, 'datasetId' | 'instrumentId'> &
    Partial<Pick<PickupFormValues, 'datasetId' | 'instrumentId'>> = {
    projectId: values.projectId,
    schemaVersionId: values.schemaVersionId,
    autoDetect: values.autoDetect,
    datasetNamePattern:
      values.datasetNamePattern.trim() || DEFAULT_DATASET_NAME_PATTERN,
  }

  if (values.datasetId) pickup.datasetId = values.datasetId

  if (values.instrumentId) pickup.instrumentId = values.instrumentId

  return { ok: true, config: { ...config, pickup } }
}
