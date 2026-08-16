import { describe, expect, it } from 'vitest'

import {
  isCanonicalSheetBlock,
  isLegacySheetBlock,
  sheetBlockInstanceId,
  sheetBlockTableId,
} from './sheet-block'

const instanceId = '0198d970-e266-4000-8000-000000000001'
const tableId = '0198d970-e266-4000-8000-000000000002'

describe('sheet block identity helpers', () => {
  it('reads canonical Instance identity without treating it as legacy', () => {
    const payload = { instanceId }
    expect(sheetBlockInstanceId(payload)).toBe(instanceId)
    expect(sheetBlockTableId(payload)).toBeNull()
    expect(isCanonicalSheetBlock(payload)).toBe(true)
    expect(isLegacySheetBlock(payload)).toBe(false)
  })

  it('reads legacy table identity without inventing an Instance id', () => {
    const payload = { tableId }
    expect(sheetBlockTableId(payload)).toBe(tableId)
    expect(sheetBlockInstanceId(payload)).toBeNull()
    expect(isCanonicalSheetBlock(payload)).toBe(false)
    expect(isLegacySheetBlock(payload)).toBe(true)
  })
})
