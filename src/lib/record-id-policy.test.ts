import { describe, expect, it } from 'vitest'

import {
  CURRENT_RECORD_ID_POLICY,
  RECORD_ID_POLICY_OWNER,
  assertSheetUsesModelRecordIds,
  isGeneratedRecordId,
  recordIdPattern,
} from './record-id-policy'
import { parsePersistedRecordReference } from './record-reference-cell'

describe('Sheet Record ID policy', () => {
  it('uses the Model-owned generated PREFIX-YYYY-NNNN policy', () => {
    expect(assertSheetUsesModelRecordIds()).toEqual(CURRENT_RECORD_ID_POLICY)
    expect(CURRENT_RECORD_ID_POLICY).toEqual({
      mode: 'generated',
      format: 'PREFIX-YYYY-NNNN',
      uniqueness: 'project',
      owner: RECORD_ID_POLICY_OWNER,
    })
    expect(RECORD_ID_POLICY_OWNER).toBe('api.create_model_record')
  })

  it('recognises registry identifiers without treating them as relationship identity', () => {
    expect(isGeneratedRecordId('sample', 'SMP-2026-0001')).toBe(true)
    expect(isGeneratedRecordId('reagent', 'RGT-2026-0042')).toBe(true)
    expect(isGeneratedRecordId('experiment', 'EXP-2026-0007')).toBe(true)
    expect(recordIdPattern('sample')?.test('SMP-2026-0001')).toBe(true)
    expect(() =>
      parsePersistedRecordReference('SMP-2026-0001', { nullable: true }),
    ).toThrowError(/UUID/)
  })
})
