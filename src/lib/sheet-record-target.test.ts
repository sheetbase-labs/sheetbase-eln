import { describe, expect, it } from 'vitest'

import { sheetRecordTargetModelKey } from './sheet-record-target'

function configuration(modelKey: string | null) {
  return {
    columns: [
      {
        field: {
          relationship: modelKey
            ? { target: { kind: 'model' as const, modelKey } }
            : null,
        },
      },
    ],
  }
}

describe('sheetRecordTargetModelKey', () => {
  it('uses the Model named on the Definition, not a hard-coded sample', () => {
    expect(sheetRecordTargetModelKey(configuration('reagent'))).toBe('reagent')
    expect(sheetRecordTargetModelKey(configuration('batch'))).toBe('batch')
    expect(sheetRecordTargetModelKey(configuration(null))).toBeNull()
    expect(sheetRecordTargetModelKey(null)).toBeNull()
  })
})
