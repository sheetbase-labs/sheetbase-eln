/**
 * SCI-005 unit tests for the plate map specification model and validation.
 *
 * Covers canonical well-code parsing/derivation, dimensions/bounds, unsupported
 * format/role, duplicate well and duplicate assignment, required controls,
 * volume constraints, sample-role/link compatibility, and archived sample
 * snapshot behavior.
 */
import { describe, expect, it } from 'vitest'

import {
  ASSIGNMENT_ROLES,
  FORMAT_DIMENSIONS,
  PLATE_MAP_SPEC_VERSION,
  ROLE_STYLES,
  defaultPlateMapSpec,
  isValidWellCode,
  parseWellCode,
  rowLabel,
  validatePlateMapPayload,
  validatePlateMapSpec,
  wellCode,
  wellsToPlateWells,
} from './plate-map'
import type {
  AssignmentRole,
  PlateMapBlockPayload,
  PlateMapSpec,
  WellAssignment,
} from './plate-map'

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

describe('rowLabel', () => {
  it('converts 0-based row index to uppercase letter', () => {
    expect(rowLabel(0)).toBe('A')
    expect(rowLabel(7)).toBe('H')
  })
})

describe('wellCode', () => {
  it('derives the canonical well code from 0-based row and col', () => {
    expect(wellCode(0, 0)).toBe('A1')
    expect(wellCode(0, 11)).toBe('A12')
    expect(wellCode(7, 11)).toBe('H12')
    expect(wellCode(1, 0)).toBe('B1')
  })
})

describe('parseWellCode', () => {
  it('parses a valid well code into 0-based row and col', () => {
    expect(parseWellCode('A1')).toEqual({ row: 0, col: 0 })
    expect(parseWellCode('H12')).toEqual({ row: 7, col: 11 })
    expect(parseWellCode('B6')).toEqual({ row: 1, col: 5 })
  })

  it('returns null for malformed codes', () => {
    expect(parseWellCode('')).toBeNull()
    expect(parseWellCode('1A')).toBeNull()
    expect(parseWellCode('A')).toBeNull()
    expect(parseWellCode('A0')).toBeNull() // col 0 → -1 after parse
    expect(parseWellCode('AA1')).toBeNull() // multi-letter rows not supported yet
  })
})

describe('isValidWellCode', () => {
  it('accepts codes within the given dimensions', () => {
    expect(isValidWellCode('A1', 8, 12)).toBe(true)
    expect(isValidWellCode('H12', 8, 12)).toBe(true)
  })

  it('rejects codes out of bounds', () => {
    expect(isValidWellCode('I1', 8, 12)).toBe(false)
    expect(isValidWellCode('A13', 8, 12)).toBe(false)
    expect(isValidWellCode('A0', 8, 12)).toBe(false)
  })

  it('rejects malformed codes', () => {
    expect(isValidWellCode('', 8, 12)).toBe(false)
    expect(isValidWellCode('X', 8, 12)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// defaultPlateMapSpec
// ---------------------------------------------------------------------------

describe('defaultPlateMapSpec', () => {
  it('creates a 96-well spec with no wells', () => {
    const spec = defaultPlateMapSpec()
    expect(spec.specVersion).toBe(PLATE_MAP_SPEC_VERSION)
    expect(spec.format).toBe('96_well')
    expect(spec.rows).toBe(8)
    expect(spec.cols).toBe(12)
    expect(spec.wells).toEqual([])
    expect(spec.validation).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapPayload
// ---------------------------------------------------------------------------

describe('validatePlateMapPayload', () => {
  it('accepts an empty draft {}', () => {
    expect(validatePlateMapPayload({})).toEqual([])
  })

  it('accepts a non-object payload as invalid_shape', () => {
    const errors = validatePlateMapPayload('not an object')
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('invalid_shape')
  })

  it('requires a non-empty title for a populated payload', () => {
    const errors = validatePlateMapPayload({ spec: defaultPlateMapSpec() })
    expect(errors.some((e) => e.code === 'missing_field' && e.field === 'title')).toBe(true)
  })

  it('requires spec for a populated payload', () => {
    const errors = validatePlateMapPayload({ title: 'My plate' })
    expect(errors.some((e) => e.code === 'missing_field' && e.field === 'spec')).toBe(true)
  })

  it('accepts a valid payload', () => {
    const payload: PlateMapBlockPayload = {
      title: 'qPCR plate',
      spec: defaultPlateMapSpec(),
      provenance: 'Lab A',
    }
    expect(validatePlateMapPayload(payload)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapSpec — structural validation
// ---------------------------------------------------------------------------

function validSpec(overrides: Partial<PlateMapSpec> = {}): PlateMapSpec {
  return { ...defaultPlateMapSpec(), ...overrides }
}

function well(overrides: Partial<WellAssignment> = {}): WellAssignment {
  return {
    wellCode: 'A1',
    row: 0,
    col: 0,
    role: 'sample',
    sampleRef: {
      recordId: '00000000-0000-4000-8000-000000000999',
      identifier: 'SMP-2025-0001',
      title: 'Test sample',
    },
    ...overrides,
  }
}

describe('validatePlateMapSpec — structural', () => {
  it('rejects a non-object spec', () => {
    const errors = validatePlateMapSpec('not an object')
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('invalid_shape')
  })

  it('rejects an unsupported specVersion', () => {
    const errors = validatePlateMapSpec(validSpec({ specVersion: 999 }))
    expect(errors.some((e) => e.code === 'unsupported_spec_version')).toBe(true)
  })

  it('rejects an unsupported format', () => {
    const errors = validatePlateMapSpec(
      validSpec({ format: '384_well' as unknown as PlateMapSpec['format'] }),
    )
    expect(errors.some((e) => e.code === 'unsupported_format')).toBe(true)
  })

  it('rejects mismatched rows', () => {
    const errors = validatePlateMapSpec(validSpec({ rows: 4 }))
    expect(errors.some((e) => e.code === 'invalid_value' && e.field === 'spec.rows')).toBe(true)
  })

  it('rejects mismatched cols', () => {
    const errors = validatePlateMapSpec(validSpec({ cols: 6 }))
    expect(errors.some((e) => e.code === 'invalid_value' && e.field === 'spec.cols')).toBe(true)
  })

  it('rejects wells that is not an array', () => {
    const errors = validatePlateMapSpec(validSpec({ wells: 'not array' as unknown as WellAssignment[] }))
    expect(errors.some((e) => e.code === 'missing_field' && e.field === 'spec.wells')).toBe(true)
  })

  it('rejects wells exceeding plate capacity', () => {
    const wells = Array.from({ length: 97 }, (_, i) => well({
      wellCode: wellCode(Math.floor(i / 12), i % 12),
      row: Math.floor(i / 12),
      col: i % 12,
      role: 'empty',
      sampleRef: undefined,
    }))
    const errors = validatePlateMapSpec(validSpec({ wells }))
    expect(errors.some((e) => e.code === 'invalid_value' && e.field === 'spec.wells')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapSpec — well validation
// ---------------------------------------------------------------------------

describe('validatePlateMapSpec — well validation', () => {
  it('rejects an invalid well code', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ wellCode: 'Z99' })],
    }))
    expect(errors.some((e) => e.code === 'invalid_well_code')).toBe(true)
  })

  it('rejects a well code that does not match row/col', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ wellCode: 'B2', row: 0, col: 0 })],
    }))
    expect(errors.some((e) => e.code === 'invalid_well_code')).toBe(true)
  })

  it('rejects out-of-bounds row', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ row: 8, wellCode: 'I1' })],
    }))
    expect(errors.some((e) => e.code === 'out_of_bounds' && e.field === 'spec.wells[0].row')).toBe(true)
  })

  it('rejects out-of-bounds col', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ col: 12, wellCode: 'A13' })],
    }))
    expect(errors.some((e) => e.code === 'out_of_bounds' && e.field === 'spec.wells[0].col')).toBe(true)
  })

  it('rejects duplicate well codes', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [
        well({ wellCode: 'A1', row: 0, col: 0 }),
        well({ wellCode: 'A1', row: 0, col: 0, sampleRef: undefined, role: 'empty' }),
      ],
    }))
    expect(errors.some((e) => e.code === 'duplicate_well')).toBe(true)
  })

  it('rejects an unsupported role', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ role: 'calibrator' as unknown as AssignmentRole })],
    }))
    expect(errors.some((e) => e.code === 'unsupported_role')).toBe(true)
  })

  it('rejects a non-object sampleRef', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ sampleRef: 'bad' as unknown as WellAssignment['sampleRef'] })],
    }))
    expect(errors.some((e) => e.code === 'invalid_sample_ref')).toBe(true)
  })

  it('rejects a sampleRef with missing recordId', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ sampleRef: { identifier: 'X', title: 'Y' } as unknown as WellAssignment['sampleRef'] })],
    }))
    expect(errors.some((e) => e.code === 'invalid_sample_ref' && e.field === 'spec.wells[0].sampleRef.recordId')).toBe(true)
  })

  it('rejects an invalid replicate', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ replicate: -1 })],
    }))
    expect(errors.some((e) => e.code === 'invalid_replicate')).toBe(true)
  })

  it('rejects an invalid volume value', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ volume: { value: -5, unit: 'µL' } })],
    }))
    expect(errors.some((e) => e.code === 'invalid_volume')).toBe(true)
  })

  it('rejects a volume with missing unit', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ volume: { value: 10, unit: '' } })],
    }))
    expect(errors.some((e) => e.code === 'invalid_volume' && e.field === 'spec.wells[0].volume.unit')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapSpec — duplicate assignment
// ---------------------------------------------------------------------------

describe('validatePlateMapSpec — duplicate assignment', () => {
  it('flags the same sample + role + replicate in multiple wells', () => {
    const ref = { recordId: '00000000-0000-4000-8000-000000000999', identifier: 'SMP-1', title: 'Sample 1' }
    const errors = validatePlateMapSpec(validSpec({
      wells: [
        well({ wellCode: 'A1', row: 0, col: 0, sampleRef: ref, role: 'sample', replicate: 1 }),
        well({ wellCode: 'A2', row: 0, col: 1, sampleRef: ref, role: 'sample', replicate: 1 }),
      ],
    }))
    expect(errors.some((e) => e.code === 'duplicate_assignment')).toBe(true)
  })

  it('does not flag the same sample with different replicates', () => {
    const ref = { recordId: '00000000-0000-4000-8000-000000000999', identifier: 'SMP-1', title: 'Sample 1' }
    const errors = validatePlateMapSpec(validSpec({
      wells: [
        well({ wellCode: 'A1', row: 0, col: 0, sampleRef: ref, role: 'sample', replicate: 1 }),
        well({ wellCode: 'A2', row: 0, col: 1, sampleRef: ref, role: 'sample', replicate: 2 }),
      ],
    }))
    expect(errors.some((e) => e.code === 'duplicate_assignment')).toBe(false)
  })

  it('does not flag controls without sample links as duplicates', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [
        well({ wellCode: 'A1', row: 0, col: 0, role: 'positive_control', sampleRef: undefined }),
        well({ wellCode: 'A2', row: 0, col: 1, role: 'positive_control', sampleRef: undefined }),
      ],
    }))
    expect(errors.some((e) => e.code === 'duplicate_assignment')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapSpec — required controls
// ---------------------------------------------------------------------------

describe('validatePlateMapSpec — required controls', () => {
  it('flags a missing required role', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ role: 'sample' })],
      validation: { requiredRoles: ['positive_control'] },
    }))
    expect(errors.some((e) => e.code === 'missing_required_role')).toBe(true)
  })

  it('passes when all required roles are present', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [
        well({ wellCode: 'A1', row: 0, col: 0, role: 'sample' }),
        well({ wellCode: 'A2', row: 0, col: 1, role: 'positive_control', sampleRef: undefined }),
      ],
      validation: { requiredRoles: ['positive_control'] },
    }))
    expect(errors.some((e) => e.code === 'missing_required_role')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapSpec — volume constraints
// ---------------------------------------------------------------------------

describe('validatePlateMapSpec — volume constraints', () => {
  it('flags a volume below the minimum', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ volume: { value: 5, unit: 'µL' } })],
      validation: { volumeMin: 10 },
    }))
    expect(errors.some((e) => e.code === 'invalid_volume')).toBe(true)
  })

  it('flags a volume exceeding the maximum', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ volume: { value: 200, unit: 'µL' } })],
      validation: { volumeMax: 100 },
    }))
    expect(errors.some((e) => e.code === 'invalid_volume')).toBe(true)
  })

  it('passes when volumes are within bounds', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({ volume: { value: 50, unit: 'µL' } })],
      validation: { volumeMin: 10, volumeMax: 100 },
    }))
    expect(errors.some((e) => e.code === 'invalid_volume')).toBe(false)
  })

  it('flags volumeMin > volumeMax as invalid', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [],
      validation: { volumeMin: 100, volumeMax: 10 },
    }))
    expect(errors.some((e) => e.code === 'invalid_value' && e.field === 'spec.validation')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validatePlateMapSpec — archived sample snapshot
// ---------------------------------------------------------------------------

describe('validatePlateMapSpec — archived sample snapshot', () => {
  it('accepts a sampleRef with archived=true', () => {
    const errors = validatePlateMapSpec(validSpec({
      wells: [well({
        sampleRef: {
          recordId: '00000000-0000-4000-8000-000000000999',
          identifier: 'SMP-OLD',
          title: 'Old sample',
          archived: true,
        },
      })],
    }))
    expect(errors.some((e) => e.code === 'invalid_sample_ref')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ROLE_STYLES and ASSIGNMENT_ROLES
// ---------------------------------------------------------------------------

describe('ROLE_STYLES', () => {
  it('provides a style for every assignment role', () => {
    for (const role of ASSIGNMENT_ROLES) {
      expect(ROLE_STYLES[role]).toBeTruthy()
      expect(ROLE_STYLES[role].label).toBeTruthy()
      expect(ROLE_STYLES[role].cellClass).toBeTruthy()
      expect(ROLE_STYLES[role].badgeClass).toBeTruthy()
    }
  })
})

describe('FORMAT_DIMENSIONS', () => {
  it('provides dimensions for 96_well', () => {
    expect(FORMAT_DIMENSIONS['96_well']).toEqual({ rows: 8, cols: 12 })
  })
})

// ---------------------------------------------------------------------------
// wellsToPlateWells
// ---------------------------------------------------------------------------

describe('wellsToPlateWells', () => {
  it('converts well assignments to plate well objects with labels', () => {
    const spec = validSpec({
      wells: [
        well({ wellCode: 'A1', row: 0, col: 0, role: 'sample', replicate: 1, volume: { value: 20, unit: 'µL' } }),
      ],
    })
    const result = wellsToPlateWells(spec)
    expect(result).toHaveLength(1)
    expect(result[0].row).toBe(0)
    expect(result[0].col).toBe(0)
    expect(result[0].label).toContain('A1')
    expect(result[0].label).toContain('Sample')
    expect(result[0].label).toContain('SMP-2025-0001')
    expect(result[0].label).toContain('rep 1')
    expect(result[0].volume).toEqual({ value: 20, unit: 'µL' })
    expect(result[0].role).toBe('sample')
  })
})
