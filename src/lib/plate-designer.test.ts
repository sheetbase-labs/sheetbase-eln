/** OPS-003 pure unit tests for plate layout generation and validation. */
import { describe, expect, it, vi } from 'vitest'

import {
  UndoStack,
  autoFillPlate,
  defaultPlateDesignDoc,
  designerViewStateToSpec,
  designerWellToWellAssignment,
  emptyDesignerViewState,
  generateWellOrder,
  mulberry32,
  parseCsv,
  plateDesignDocToSpec,
  previewCsvImport,
  shuffleWithSeed,
  validatePlateDesign,
} from './plate-designer'
import type {
  AutoFillOptions,
  PlateDesignDoc,
  PlateWellAssignment,
} from './plate-designer'
import type { SampleRef } from './plate-map'
import { validatePlateMapSpec } from './plate-map'
const samples: SampleRef[] = Array.from({ length: 6 }, (_, index) => ({
  recordId: `sample-${index + 1}`,
  identifier: `S${index + 1}`,
  title: `Sample ${index + 1}`,
}))

function fillOptions(
  overrides: Partial<AutoFillOptions> = {},
): AutoFillOptions {
  return {
    samples: samples.slice(0, 3),
    replicates: 1,
    fillDirection: 'row',
    startWell: 'A1',
    controls: [],
    randomize: false,
    seed: 42,
    ...overrides,
  }
}

function design(
  wells: PlateWellAssignment[] = [],
  overrides: Partial<PlateDesignDoc> = {},
): PlateDesignDoc {
  return {
    ...defaultPlateDesignDoc('workspace-1'),
    wells,
    ...overrides,
  }
}

function sampleWell(
  wellCode: string,
  row: number,
  col: number,
  overrides: Partial<PlateWellAssignment> = {},
): PlateWellAssignment {
  return {
    wellCode,
    row,
    col,
    role: 'sample',
    sampleRef: samples[0],
    replicate: 1,
    ...overrides,
  }
}

describe('deterministic randomisation', () => {
  it('mulberry32 produces the same sequence for the same seed', () => {
    const first = mulberry32(123456)
    const second = mulberry32(123456)
    expect(Array.from({ length: 20 }, first)).toEqual(
      Array.from({ length: 20 }, second),
    )
  })

  it('mulberry32 produces different sequences for different seeds', () => {
    const first = mulberry32(1)
    const second = mulberry32(2)
    expect(Array.from({ length: 10 }, first)).not.toEqual(
      Array.from({ length: 10 }, second),
    )
  })

  it('shuffleWithSeed is deterministic and does not mutate its input', () => {
    const input = Array.from({ length: 12 }, (_, index) => index)
    const original = [...input]
    expect(shuffleWithSeed(input, 8675309)).toEqual(
      shuffleWithSeed(input, 8675309),
    )
    expect(input).toEqual(original)
  })

  it('shuffleWithSeed gives different orders for different seeds', () => {
    const input = Array.from({ length: 20 }, (_, index) => index)
    expect(shuffleWithSeed(input, 10)).not.toEqual(shuffleWithSeed(input, 11))
  })

  it('shuffleWithSeed preserves every original element', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f']
    expect([...shuffleWithSeed(input, 99)].sort()).toEqual([...input].sort())
  })

  it('shuffleWithSeed handles empty and single-element arrays', () => {
    expect(shuffleWithSeed([], 1)).toEqual([])
    expect(shuffleWithSeed(['only'], 1)).toEqual(['only'])
  })
})

describe('generateWellOrder', () => {
  it('generates row order', () => {
    expect(
      generateWellOrder(2, 3, 'row', 'A1').map((well) => well.wellCode),
    ).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
  })

  it('generates column order', () => {
    expect(
      generateWellOrder(2, 3, 'column', 'A1').map((well) => well.wellCode),
    ).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3'])
  })

  it('alternates rows in serpentine order', () => {
    expect(
      generateWellOrder(3, 3, 'serpentine', 'A1').map((well) => well.wellCode),
    ).toEqual(['A1', 'A2', 'A3', 'B3', 'B2', 'B1', 'C1', 'C2', 'C3'])
  })

  it('generates column-serpentine order', () => {
    expect(
      generateWellOrder(3, 2, 'column_serpentine', 'A1').map(
        (well) => well.wellCode,
      ),
    ).toEqual(['A1', 'B1', 'C1', 'C2', 'B2', 'A2'])
  })

  it('starts the returned order at startWell', () => {
    expect(
      generateWellOrder(2, 3, 'row', 'A3').map((well) => well.wellCode),
    ).toEqual(['A3', 'B1', 'B2', 'B3'])
  })
})

describe('autoFillPlate', () => {
  it.each([
    ['row', ['A1', 'A2', 'A3']] as const,
    ['column', ['A1', 'B1', 'A2']] as const,
    ['serpentine', ['A1', 'A2', 'A3', 'B3', 'B2', 'B1']] as const,
  ])('fills in %s order', (fillDirection, expected) => {
    const selectedSamples =
      fillDirection === 'serpentine' ? samples : samples.slice(0, 3)
    const wells = autoFillPlate(
      2,
      3,
      fillOptions({ samples: selectedSamples, fillDirection }),
    )
    expect(wells.map((well) => well.wellCode)).toEqual(expected)
  })

  it('places controls first and skips their wells when filling samples', () => {
    const wells = autoFillPlate(
      2,
      3,
      fillOptions({
        controls: [{ role: 'positive_control', wellCode: 'A2' }],
      }),
    )
    expect(wells[0]).toMatchObject({ wellCode: 'A2', role: 'positive_control' })
    expect(wells.slice(1).map((well) => well.wellCode)).toEqual([
      'A1',
      'A3',
      'B1',
    ])
  })

  it('places three consecutive replicates for each sample', () => {
    const wells = autoFillPlate(
      2,
      3,
      fillOptions({
        samples: samples.slice(0, 2),
        replicates: 3,
      }),
    )
    expect(
      wells.map((well) => [well.sampleRef?.identifier, well.replicate]),
    ).toEqual([
      ['S1', 1],
      ['S1', 2],
      ['S1', 3],
      ['S2', 1],
      ['S2', 2],
      ['S2', 3],
    ])
  })

  it('uses the seed to make randomized assignment deterministic', () => {
    const options = fillOptions({ samples, randomize: true, seed: 31415 })
    const first = autoFillPlate(2, 3, options)
    const second = autoFillPlate(2, 3, options)
    expect(first).toEqual(second)
    expect(first.map((well) => well.sampleRef?.identifier)).toEqual(
      shuffleWithSeed(samples, 31415).map((sample) => sample.identifier),
    )
  })

  it('assigns samples in array order when randomize is false', () => {
    const wells = autoFillPlate(1, 3, fillOptions())
    expect(wells.map((well) => well.sampleRef?.identifier)).toEqual([
      'S1',
      'S2',
      'S3',
    ])
  })

  it('skips all wells before startWell', () => {
    const wells = autoFillPlate(2, 3, fillOptions({ startWell: 'B2' }))
    expect(wells.map((well) => well.wellCode)).toEqual(['B2', 'B3'])
  })

  it('applies default volume and concentration to sample wells', () => {
    const [well] = autoFillPlate(
      1,
      1,
      fillOptions({
        samples: samples.slice(0, 1),
        volume: { value: 25, unit: 'uL' },
        concentration: { value: 2.5, unit: 'ng/uL' },
      }),
    )
    expect(well).toMatchObject({
      volume: { value: 25, unit: 'uL' },
      concentrationValue: 2.5,
      concentrationUnit: 'ng/uL',
    })
  })
})

describe('validatePlateDesign', () => {
  it('reports every missing required control role for an empty plate', () => {
    const errors = validatePlateDesign(
      design([], {
        validation: { requiredRoles: ['positive_control', 'negative_control'] },
      }),
    )
    expect(
      errors.filter((error) => error.code === 'missing_required_role'),
    ).toHaveLength(2)
  })

  it('returns no errors for a valid layout', () => {
    const wells = [
      sampleWell('A1', 0, 0),
      { wellCode: 'A2', row: 0, col: 1, role: 'positive_control' } as const,
    ]
    expect(
      validatePlateDesign(
        design(wells, {
          validation: { requiredRoles: ['positive_control'] },
        }),
      ),
    ).toEqual([])
  })

  it('reports duplicate sample:role:replicate assignments', () => {
    const errors = validatePlateDesign(
      design([sampleWell('A1', 0, 0), sampleWell('A2', 0, 1)]),
    )
    expect(errors.some((error) => error.code === 'duplicate_assignment')).toBe(
      true,
    )
  })

  it('reports an out-of-bounds well', () => {
    const errors = validatePlateDesign(design([sampleWell('I1', 8, 0)]))
    expect(errors.some((error) => error.code === 'out_of_bounds')).toBe(true)
  })

  it.each([
    [4, { volumeMin: 5 }],
    [11, { volumeMax: 10 }],
  ])('reports volume %s outside configured limits', (value, validation) => {
    const errors = validatePlateDesign(
      design([sampleWell('A1', 0, 0, { volume: { value, unit: 'uL' } })], {
        validation,
      }),
    )
    expect(errors.some((error) => error.code === 'invalid_volume')).toBe(true)
  })

  it('reports a sample-role well without a sample reference', () => {
    const errors = validatePlateDesign(
      design([sampleWell('A1', 0, 0, { sampleRef: undefined })]),
    )
    expect(errors.some((error) => error.code === 'missing_sample_ref')).toBe(
      true,
    )
  })

  it('reports a negative concentration', () => {
    const errors = validatePlateDesign(
      design([sampleWell('A1', 0, 0, { concentrationValue: -0.1 })]),
    )
    expect(errors.some((error) => error.code === 'invalid_concentration')).toBe(
      true,
    )
  })
})

describe('UndoStack', () => {
  it('push then undo restores and returns the previous state', () => {
    const stack = new UndoStack('initial')
    stack.push('latest')
    expect(stack.undo()).toBe('initial')
    expect(stack.current).toBe('initial')
  })

  it('cannot undo after all history has been undone', () => {
    const stack = new UndoStack(0)
    stack.push(1)
    stack.undo()
    expect(stack.canUndo()).toBe(false)
  })

  it('returns null when there is nothing to undo', () => {
    expect(new UndoStack('only').undo()).toBeNull()
  })

  it('reset clears history and establishes a new baseline', () => {
    const stack = new UndoStack('first')
    stack.push('second')
    stack.reset('reset')
    expect(stack.current).toBe('reset')
    expect(stack.canUndo()).toBe(false)
    expect(stack.undo()).toBeNull()
  })

  it('current returns the latest pushed state', () => {
    const stack = new UndoStack({ version: 1 })
    stack.push({ version: 2 })
    expect(stack.current).toEqual({ version: 2 })
  })
})

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCsv('well,role\nA1,sample')).toEqual([
      ['well', 'role'],
      ['A1', 'sample'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('well,notes\nA1,"alpha, beta"')[1]).toEqual([
      'A1',
      'alpha, beta',
    ])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('well,notes\nA1,"line one\nline two"')[1]).toEqual([
      'A1',
      'line one\nline two',
    ])
  })

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('previewCsvImport', () => {
  it('auto-detects supported column aliases', () => {
    const preview = previewCsvImport(
      'Well Code,Role,Sample,Rep,Volume,Volume Unit,Concentration,Conc Unit,Notes\nA1,sample,S1,1,10,uL,2,ng/uL,ok',
      8,
      12,
    )
    expect(preview.mapping).toEqual({
      wellCode: 'Well Code',
      role: 'Role',
      sampleIdentifier: 'Sample',
      replicate: 'Rep',
      volumeValue: 'Volume',
      volumeUnit: 'Volume Unit',
      concentrationValue: 'Concentration',
      concentrationUnit: 'Conc Unit',
      notes: 'Notes',
    })
    expect(preview.detectedColumns).toHaveLength(9)
  })

  it('accepts valid data without errors', () => {
    const preview = previewCsvImport(
      'well,role,sample,replicate\nH12,sample,S1,1',
      8,
      12,
    )
    expect(preview.errors).toEqual([])
    expect(preview.rows[0]).toMatchObject({ wellCode: 'H12', role: 'sample' })
  })

  it('reports invalid roles', () => {
    const preview = previewCsvImport('well,role\nA1,unknown', 8, 12)
    expect(
      preview.errors.some((error) => error.code === 'unsupported_role'),
    ).toBe(true)
  })

  it('validates well codes against dimensions and reports out-of-bounds codes', () => {
    const preview = previewCsvImport('well,role\nB1,empty\nA3,empty', 1, 2)
    expect(
      preview.errors.filter((error) => error.code === 'invalid_well_code'),
    ).toHaveLength(2)
    expect(preview.errors.map((error) => error.wellCode)).toEqual(['B1', 'A3'])
  })
})

describe('defaultPlateDesignDoc', () => {
  it('creates an empty draft 96-well design at metadata version 1', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    const doc = defaultPlateDesignDoc('workspace-123')
    expect(doc).toMatchObject({
      workspaceId: 'workspace-123',
      format: '96_well',
      rows: 8,
      cols: 12,
      wells: [],
      status: 'draft',
      metadataVersion: 1,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    })
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// VIEW-02 canonical PlateMapSpec bridge
// ---------------------------------------------------------------------------

describe('designerWellToWellAssignment', () => {
  it('strips designer-local fields to the canonical assignment', () => {
    const assignment = designerWellToWellAssignment({
      ...sampleWell('A1', 0, 0),
      concentrationValue: 10,
      concentrationUnit: 'µM',
      sampleRecordId: 'sample-1',
      volume: { value: 20, unit: 'µL' },
      notes: 'edge well',
    })
    expect(assignment).toEqual({
      wellCode: 'A1',
      row: 0,
      col: 0,
      role: 'sample',
      sampleRef: samples[0],
      replicate: 1,
      volume: { value: 20, unit: 'µL' },
      notes: 'edge well',
    })
    expect(assignment).not.toHaveProperty('concentrationValue')
    expect(assignment).not.toHaveProperty('sampleRecordId')
  })
})

describe('plateDesignDocToSpec', () => {
  it('serialises a valid draft to a spec the canonical validators accept', () => {
    const doc = design([
      sampleWell('A1', 0, 0),
      {
        wellCode: 'A2',
        row: 0,
        col: 1,
        role: 'positive_control',
        volume: { value: 20, unit: 'µL' },
      },
    ])
    expect(validatePlateDesign(doc)).toEqual([])
    const spec = plateDesignDocToSpec(doc)
    // The designer operates on the canonical spec: envelope fields come from
    // the draft, wells carry scientific state only.
    expect(spec.specVersion).toBe(1)
    expect(spec.format).toBe('96_well')
    expect(spec.rows).toBe(8)
    expect(spec.cols).toBe(12)
    expect(spec.wells).toHaveLength(2)
    expect(validatePlateMapSpec(spec)).toEqual([])
  })

  it('round-trips auto-filled plates including designer planning fields', () => {
    const filled = autoFillPlate(8, 12, {
      ...fillOptions(),
      volume: { value: 20, unit: 'µL' },
      concentration: { value: 10, unit: 'µM' },
    })
    const spec = plateDesignDocToSpec(design(filled))
    expect(validatePlateMapSpec(spec)).toEqual([])
    expect(spec.wells.length).toBeGreaterThan(0)
    // Designer planning fields never leak into the canonical spec.
    expect(JSON.stringify(spec)).not.toContain('concentrationValue')
    expect(JSON.stringify(spec)).not.toContain('sampleRecordId')
  })
})

describe('designer view-state annotations', () => {
  it('keeps annotations presentation-only: they never reach the spec', () => {
    const state = {
      ...emptyDesignerViewState(design([sampleWell('A1', 0, 0)])),
      annotations: [
        { wellCode: 'A1', kind: 'flag' as const, text: 're-check pipetting' },
        { wellCode: 'H12', kind: 'note' as const, text: 'evaporation risk' },
      ],
      selectedWellCode: 'A1',
    }
    const spec = designerViewStateToSpec(state)
    expect(validatePlateMapSpec(spec)).toEqual([])
    expect(spec.wells).toHaveLength(1)
    const serialised = JSON.stringify(spec)
    expect(serialised).not.toContain('re-check pipetting')
    expect(serialised).not.toContain('evaporation risk')
    expect(serialised).not.toContain('selectedWellCode')
  })
})
