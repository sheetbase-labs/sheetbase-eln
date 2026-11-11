import { describe, expect, it } from 'vitest'

import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { FieldDefinition } from '#/lib/field-definition'
import {
  benchRange,
  benchRangeBreach,
  benchReadOnlyReason,
  outOfRange,
} from './sheet-bench-entry'

const field: FieldDefinition = {
  fieldId: 'f1',
  key: 'turbidity',
  label: 'Turbidity',
  description: null,
  logicalType: 'decimal',
  nullable: false,
  defaultValue: null,
  cardinality: 'one',
  quantity: {
    kind: 'turbidity',
    dimension: 'turbidity',
    storageUnit: 'NTU',
    preferredDisplayUnit: 'NTU',
  },
  validation: { min: 0, max: 50 },
  category: null,
  relationship: null,
  computation: { mode: 'stored' },
  lifecycle: 'active',
}

function column(
  overrides: Partial<CanonicalSheetGridColumn> = {},
): CanonicalSheetGridColumn {
  return {
    id: 'turbidity',
    label: 'Turbidity',
    origin: 'local',
    field,
    presentation: { kind: 'number', inputType: 'number', step: 'any' },
    editable: true,
    group: 'This experiment',
    ...overrides,
  }
}

describe('bench entry fields', () => {
  it('states the allowed range with its unit', () => {
    expect(benchRange(column())).toBe('Allowed 0–50 NTU')
  })

  it('explains a value outside the range and accepts one inside', () => {
    expect(benchRangeBreach(column(), '61.5')).toContain('0–50 NTU')
    expect(benchRangeBreach(column(), '12.8')).toBeNull()
    expect(benchRangeBreach(column(), '')).toBeNull()
  })

  it('says in plain words why a field cannot be typed into', () => {
    expect(
      benchReadOnlyReason(column({ origin: 'calculation' }), true),
    ).toMatch(/^Calculated/)
    expect(benchReadOnlyReason(column(), false)).not.toBeNull()
    expect(benchReadOnlyReason(column(), true)).toBeNull()
  })

  it('flags a stored value outside the range for the grid', () => {
    expect(outOfRange(column(), 61.5)).toBe(true)
    expect(outOfRange(column(), 12.8)).toBe(false)
    expect(outOfRange(column(), null)).toBe(false)
    expect(outOfRange(undefined, 61.5)).toBe(false)
  })
})
