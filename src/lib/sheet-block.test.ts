import { describe, expect, it } from 'vitest'

import { isCanonicalSheetBlock, sheetBlockInstanceId } from './sheet-block'

const instanceId = '0198d970-e266-4000-8000-000000000001'

describe('sheet block identity helpers', () => {
  it('reads Sheet Instance identity', () => {
    const payload = { instanceId }
    expect(sheetBlockInstanceId(payload)).toBe(instanceId)
    expect(isCanonicalSheetBlock(payload)).toBe(true)
  })

  it('does not treat a tableId payload as a Sheet Instance', () => {
    expect(isCanonicalSheetBlock({ tableId: instanceId })).toBe(false)
    expect(sheetBlockInstanceId({ tableId: instanceId })).toBeNull()
  })
})
