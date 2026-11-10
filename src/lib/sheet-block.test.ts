import { describe, expect, it } from 'vitest'

import type { SheetPayload } from './sheet-block'
import { isCanonicalSheetBlock, sheetBlockInstanceId } from './sheet-block'

const instanceId = '0198d970-e266-4000-8000-000000000001'

describe('sheet block identity helpers', () => {
  it('reads Sheet Instance identity', () => {
    const payload = { instanceId }
    expect(sheetBlockInstanceId(payload)).toBe(instanceId)
    expect(isCanonicalSheetBlock(payload)).toBe(true)
  })

  it('does not treat a tableId payload as a Sheet Instance', () => {
    // A legacy block written before Sheet Instances kept its table id only;
    // the payload type names the field these helpers read, so the fixture is
    // held in a binding rather than checked as a fresh object literal.
    const legacy: SheetPayload & { tableId?: unknown } = {
      tableId: instanceId,
    }

    expect(isCanonicalSheetBlock(legacy)).toBe(false)
    expect(sheetBlockInstanceId(legacy)).toBeNull()
  })
})
