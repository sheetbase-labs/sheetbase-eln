import { describe, expect, it } from 'vitest'

import {
  analysePlate,
  defaultAssayConfig,
  normaliseAssayConfig,
} from './plate-assay'
import type { AssayWell } from './plate-assay'

// A 4-parameter curve: 0.05 at nothing, 2.5 at saturation, half way at 20, slope 1.
const reading = (c: number) => 0.05 + (2.5 - 0.05) / (1 + (20 / c) ** 1)

const standards = (concs: number[]): AssayWell[] =>
  concs.flatMap((c, i) => [
    {
      wellCode: `${'ABCDEFGH'[i]}1`,
      role: 'standard' as const,
      concentration: c,
      concentrationUnit: 'ng/mL',
    },
    {
      wellCode: `${'ABCDEFGH'[i]}2`,
      role: 'standard' as const,
      concentration: c,
      concentrationUnit: 'ng/mL',
    },
  ])

const STD = [100, 50, 25, 12.5, 6.25, 3.125]

function plate(sampleReadings: Array<[string, number, number?]>) {
  const wells: AssayWell[] = standards(STD)
  const readout: Record<string, number> = {}

  for (const w of wells) readout[w.wellCode] = reading(w.concentration ?? 0)

  sampleReadings.forEach(([label, value, dilution], i) => {
    const wellCode = `${'ABCDEFGH'[i]}3`

    wells.push({
      wellCode,
      role: 'sample',
      sampleLabel: label,
      sampleId: `id-${label}`,
      dilution: dilution ?? undefined,
    })
    readout[wellCode] = value
  })

  return { wells, readout }
}

describe('quantify', () => {
  it('reads a sample off the standard curve and puts the dilution back', () => {
    const { wells, readout } = plate([['S1', reading(10), 100]])
    const result = analysePlate(wells, readout, { method: 'quantify' })
    const sample = result.quantify?.samples[0]

    expect(result.quantify?.curve?.r2).toBeGreaterThan(0.999)
    expect(sample?.status).toBe('ok')
    expect(sample?.concentration).toBeCloseTo(10, 1)
    expect(sample?.result).toBeCloseTo(1000, -1)
    expect(sample?.unit).toBe('ng/mL')
    expect(result.qc.status).toBe('pass')
    expect(result.qc.checks.map((c) => c.id)).toEqual(['standard_curve'])
  })

  it('uses the config dilution when a well names none', () => {
    const { wells, readout } = plate([['S1', reading(10)]])

    const result = analysePlate(wells, readout, {
      method: 'quantify',
      dilutionFactor: 20,
    })

    expect(result.quantify?.samples[0].result).toBeCloseTo(200, -1)
  })

  it('says a reading above or below the standards is out of range, with no number', () => {
    const { wells, readout } = plate([
      ['HIGH', reading(100) + 0.4],
      ['LOW', 0.0],
    ])

    const result = analysePlate(wells, readout, { method: 'quantify' })
    const [high, low] = result.quantify?.samples ?? []

    expect(high.status).toBe('above_range')
    expect(high.result).toBeNull()
    expect(low.status).toBe('below_range')
    expect(low.result).toBeNull()
  })

  it('never invents a curve from too few standards', () => {
    const wells = standards([100, 50])
    const readout: Record<string, number> = {}

    for (const w of wells) readout[w.wellCode] = reading(w.concentration ?? 0)
    wells.push({ wellCode: 'A3', role: 'sample', sampleLabel: 'S1' })
    readout.A3 = 1

    const result = analysePlate(wells, readout, { method: 'quantify' })

    expect(result.quantify?.curve).toBeNull()
    expect(result.quantify?.failure).toBe('too_few_standards')
    expect(result.quantify?.samples[0].status).toBe('no_curve')
    expect(result.qc.status).toBe('fail')
  })

  it('says so when a plate has no standards', () => {
    const result = analysePlate(
      [{ wellCode: 'A1', role: 'sample', sampleLabel: 'S1' }],
      { A1: 1 },
      { method: 'quantify' },
    )

    expect(result.quantify?.failure).toBe('no_standards')
  })

  it('leaves a screen alone: no quantification, hits as before', () => {
    const { wells, readout } = plate([['S1', 1]])
    const result = analysePlate(wells, readout, {})

    expect(result.quantify).toBeNull()
  })

  it('reads old stored settings as a screen with no dilution', () => {
    const config = normaliseAssayConfig({ curveModel: '5pl' })

    expect(config.method).toBe('screen')
    expect(config.dilutionFactor).toBe(1)
    expect(defaultAssayConfig().qc.standardR2Min).toBe(0.98)
  })

  it('averages the wells of a sample that read inside the range and flags the rest', () => {
    const wells = standards(STD)
    const readout: Record<string, number> = {}

    for (const w of wells) readout[w.wellCode] = reading(w.concentration ?? 0)
    wells.push(
      { wellCode: 'A3', role: 'sample', sampleLabel: 'S1' },
      { wellCode: 'A4', role: 'sample', sampleLabel: 'S1' },
      { wellCode: 'A5', role: 'sample', sampleLabel: 'S1' },
    )
    readout.A3 = reading(10)
    readout.A4 = reading(12)
    readout.A5 = 9

    const sample = analysePlate(wells, readout, { method: 'quantify' }).quantify
      ?.samples[0]

    expect(sample?.n).toBe(2)
    expect(sample?.partlyOutOfRange).toBe(true)
    expect(sample?.result).toBeCloseTo(11, 0)
  })
})
