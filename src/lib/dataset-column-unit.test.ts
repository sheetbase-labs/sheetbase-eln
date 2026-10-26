import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { quantityForUnit, setDatasetColumnUnit } from './dataset-column-unit'

describe('quantityForUnit', () => {
  it('stores the unit as the field’s storage unit', () => {
    expect(quantityForUnit('mOsm/kg')).toEqual({
      kind: 'quantity',
      symbol: 'mOsm/kg',
      dimension: 'mOsm/kg',
      storageUnit: 'mOsm/kg',
    })
  })
})

describe('setDatasetColumnUnit', () => {
  it('calls the single server procedure and returns its result', async () => {
    const rpc = vi.fn(async () => ({ schemaVersion: 2, clearedFlags: 1 }))
    const client = { rpc } as unknown as DataClient
    const result = await setDatasetColumnUnit(client, {
      datasetId: 'ds-1',
      fieldKey: 'osmolality',
      unit: 'mOsm/kg',
      reason: 'Unit from instrument export header',
    })
    expect(result).toEqual({ schemaVersion: 2, clearedFlags: 1 })
    expect(rpc).toHaveBeenCalledWith('set_dataset_column_unit', {
      p_dataset_id: 'ds-1',
      p_field_key: 'osmolality',
      p_unit: 'mOsm/kg',
      p_reason: 'Unit from instrument export header',
    })
  })
})
