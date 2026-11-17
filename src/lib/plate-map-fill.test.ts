import { describe, expect, it } from 'vitest'

import { analysePlate, parsePlateTable } from './plate-assay'
import { fillPlate } from './plate-map-fill'

const samples = ['SMP-2240', 'SMP-2241', 'SMP-2242']

describe('fillPlate', () => {
  it('puts standards down the first columns, then the samples in order', () => {
    const fill = fillPlate({
      format: '96_well',
      samples,
      replicates: 2,
      direction: 'across',
      dilution: 1,
      standards: {
        top: 1000,
        unit: 'ng/mL',
        fold: 2,
        points: 7,
        replicates: 2,
      },
      blanks: 2,
    })

    const at = (code: string) => fill.wells.find((w) => w.wellCode === code)

    expect(at('A1')).toMatchObject({ role: 'standard', concentration: 1000 })
    expect(at('A2')).toMatchObject({ role: 'standard', concentration: 1000 })
    expect(at('G1')).toMatchObject({ role: 'standard', concentration: 15.625 })
    expect(at('H1')?.role).toBe('blank')
    expect(at('H2')?.role).toBe('blank')
    expect(at('A3')).toMatchObject({ role: 'sample', sampleLabel: 'SMP-2240' })
    expect(at('A4')).toMatchObject({ role: 'sample', sampleLabel: 'SMP-2240' })
    expect(at('A5')?.sampleLabel).toBe('SMP-2241')
    expect(fill.placed).toBe(3)
    expect(fill.left).toEqual([])
  })

  it('fills down the columns when asked', () => {
    const fill = fillPlate({
      format: '96_well',
      samples,
      replicates: 1,
      direction: 'down',
      dilution: 1,
      standards: null,
      blanks: 0,
    })

    expect(fill.wells.map((w) => w.wellCode)).toEqual(['A1', 'B1', 'C1'])
  })

  it('writes the dilution on each sample well and says which samples did not fit', () => {
    const fill = fillPlate({
      format: '96_well',
      samples: Array.from({ length: 50 }, (_, i) => `SMP-${i}`),
      replicates: 2,
      direction: 'across',
      dilution: 50,
      standards: null,
      blanks: 0,
    })

    expect(fill.wells.every((w) => w.dilution === 50)).toBe(true)
    expect(fill.placed).toBe(48)
    expect(fill.left).toEqual(['SMP-48', 'SMP-49'])
  })

  it('writes a layout the plate reader parser reads back', () => {
    const fill = fillPlate({
      format: '96_well',
      samples,
      replicates: 2,
      direction: 'across',
      dilution: 100,
      standards: { top: 100, unit: 'ng/mL', fold: 2, points: 5, replicates: 2 },
      blanks: 2,
    })

    const parsed = parsePlateTable(fill.text)

    expect(parsed.warnings).toEqual([])
    expect(parsed.wells).toHaveLength(fill.wells.length)
    expect(parsed.wells.find((w) => w.wellCode === 'B1')).toMatchObject({
      role: 'standard',
      concentration: 50,
      concentrationUnit: 'ng/mL',
    })
    expect(parsed.wells.find((w) => w.wellCode === 'A3')).toMatchObject({
      role: 'sample',
      sampleLabel: 'SMP-2240',
      dilution: 100,
    })
  })

  it('lays out a plate that analysePlate can quantify', () => {
    const fill = fillPlate({
      format: '96_well',
      samples: ['SMP-2240'],
      replicates: 2,
      direction: 'across',
      dilution: 10,
      standards: { top: 100, unit: 'ng/mL', fold: 2, points: 6, replicates: 2 },
      blanks: 0,
    })

    // A 4-parameter curve: low 0.05, high 2.5, mid 20, slope 1.
    const reading = (c: number) => 0.05 + (2.5 - 0.05) / (1 + (20 / c) ** 1)

    const readout: Record<string, number> = {}

    for (const w of fill.wells)
      readout[w.wellCode] =
        w.role === 'standard' ? reading(w.concentration ?? 0) : reading(4)

    const analysis = analysePlate(fill.wells, readout, { method: 'quantify' })

    expect(analysis.quantify?.curve?.r2).toBeGreaterThan(0.999)
    expect(analysis.quantify?.samples[0].status).toBe('ok')
    expect(analysis.quantify?.samples[0].result).toBeCloseTo(40, 0)
  })
})
