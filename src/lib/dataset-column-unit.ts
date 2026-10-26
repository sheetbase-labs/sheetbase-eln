import type { DataClient } from './data-client'

/** The quantity a Dataset Schema field carries once a unit is set on it. */
export function quantityForUnit(unit: string) {
  return { kind: 'quantity', symbol: unit, dimension: unit, storageUnit: unit }
}

export interface SetColumnUnitInput {
  datasetId: string
  /** The schema field's key, e.g. "osmolality". */
  fieldKey: string
  unit: string
  /** Why the unit is being set; kept on every flag it clears. */
  reason: string
}

export interface SetColumnUnitResult {
  schemaVersion: number
  clearedFlags: number
}

/**
 * Give a column that was recorded without one a unit. A published schema
 * version never changes, so the server forks the next version carrying the
 * unit, publishes it, moves the dataset to it with every row keeping its
 * values, and clears the column's missing-unit flags with the reason given.
 * Snapshots already taken stay on the version they were taken on. This is a
 * dedicated call because the ordinary model upgrade refuses unit changes.
 */
export function setDatasetColumnUnit(
  client: DataClient,
  input: SetColumnUnitInput,
): Promise<SetColumnUnitResult> {
  return client.rpc('set_dataset_column_unit', {
    p_dataset_id: input.datasetId,
    p_field_key: input.fieldKey,
    p_unit: input.unit,
    p_reason: input.reason,
  })
}
