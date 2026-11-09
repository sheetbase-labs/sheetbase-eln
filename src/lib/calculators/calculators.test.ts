import { describe, expect, it } from 'vitest'
import {
  convertQuantity,
  convertWithWeight,
  convertTemperature,
  dilutionRecipe,
  massToMoles,
  solveDilution,
  solveMolarity,
} from './calculators'

describe('molarity', () => {
  it('weighs out 58.44 g/mol NaCl for 1 L of 1 M', () => {
    const r = solveMolarity({
      target: 'mass',
      molecularWeight: 58.44,
      volume: { value: 1, unit: 'L' },
      concentration: { value: 1, unit: 'M' },
      resultUnit: 'g',
    })

    expect(r).toMatchObject({ ok: true, unit: 'g' })
    expect(r.ok && r.value).toBeCloseTo(58.44)
  })
  it('picks a readable unit', () => {
    const r = solveMolarity({
      target: 'mass',
      molecularWeight: 180.16,
      volume: { value: 10, unit: 'mL' },
      concentration: { value: 5, unit: 'mM' },
    })

    expect(r.ok && r.unit).toBe('mg')
    expect(r.ok && r.value).toBeCloseTo(9.008)
  })
  it('solves volume and concentration', () => {
    const v = solveMolarity({
      target: 'volume',
      molecularWeight: 100,
      mass: { value: 1, unit: 'g' },
      concentration: { value: 100, unit: 'mM' },
    })

    expect(v.ok && v.unit).toBe('mL')
    expect(v.ok && v.value).toBeCloseTo(100)

    const c = solveMolarity({
      target: 'concentration',
      molecularWeight: 100,
      mass: { value: 1, unit: 'g' },
      volume: { value: 100, unit: 'mL' },
    })

    expect(c.ok && c.unit).toBe('mM')
    expect(c.ok && c.value).toBeCloseTo(100)
  })
  it('reports missing and invalid inputs', () => {
    expect(solveMolarity({ target: 'mass', molecularWeight: 0 })).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(
      solveMolarity({
        target: 'mass',
        molecularWeight: 10,
        volume: { value: -1, unit: 'L' },
        concentration: { value: 1, unit: 'M' },
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('dilution', () => {
  it('solves V1 for 10 mM to 1 mM in 500 µL', () => {
    const r = solveDilution({
      target: 'v1',
      c1: { value: 10, unit: 'mM' },
      c2: { value: 1, unit: 'mM' },
      v2: { value: 500, unit: 'uL' },
    })

    expect(r.ok && r.unit).toBe('uL')
    expect(r.ok && r.value).toBeCloseTo(50)
  })
  it('solves each of the four terms', () => {
    const c2 = solveDilution({
      target: 'c2',
      c1: { value: 1, unit: 'M' },
      v1: { value: 1, unit: 'mL' },
      v2: { value: 10, unit: 'mL' },
    })

    expect(c2.ok && c2.value).toBeCloseTo(100)
    expect(c2.ok && c2.unit).toBe('mM')

    const v2 = solveDilution({
      target: 'v2',
      c1: { value: 1, unit: 'M' },
      v1: { value: 1, unit: 'mL' },
      c2: { value: 100, unit: 'mM' },
    })

    expect(v2.ok && v2.value).toBeCloseTo(10)

    const c1 = solveDilution({
      target: 'c1',
      v1: { value: 1, unit: 'mL' },
      c2: { value: 100, unit: 'mM' },
      v2: { value: 10, unit: 'mL' },
    })

    expect(c1.ok && c1.value).toBeCloseTo(1)
  })
  it('gives a recipe with diluent, and flags a weak stock', () => {
    const r = dilutionRecipe({
      stock: { value: 10, unit: 'mM' },
      target: { value: 1, unit: 'mM' },
      finalVolume: { value: 500, unit: 'uL' },
    })!

    expect(r.stock.value).toBeCloseTo(50)
    expect(r.diluent.value).toBeCloseTo(450)
    expect(r.feasible).toBe(true)
    expect(
      dilutionRecipe({
        stock: { value: 1, unit: 'mM' },
        target: { value: 10, unit: 'mM' },
        finalVolume: { value: 1, unit: 'mL' },
      })!.feasible,
    ).toBe(false)
  })
})

describe('conversion', () => {
  it('converts mass to moles with a weight', () => {
    const r = convertWithWeight({
      value: 5.844,
      from: 'mg',
      to: 'umol',
      molecularWeight: 58.44,
    })

    expect(r.ok && r.value).toBeCloseTo(100)
    expect(
      convertWithWeight({
        value: 1,
        from: 'mg',
        to: 'umol',
        molecularWeight: 0,
      }).ok,
    ).toBe(false)
    expect(
      convertWithWeight({ value: 1, from: 'mg', to: 'mL', molecularWeight: 10 })
        .ok,
    ).toBe(false)
  })
  it('converts within a kind', () => {
    const r = convertQuantity({ value: 2.5, from: 'mg', to: 'ug' })
    expect(r.ok && r.value).toBeCloseTo(2500)
    expect(convertQuantity({ value: 1, from: 'mg', to: 'mL' }).ok).toBe(false)
  })
  it('converts mass to moles and temperature', () => {
    const m = massToMoles({ value: 58.44, unit: 'mg' }, 58.44)!
    expect(m).toEqual({ value: expect.closeTo(1, 6), unit: 'mmol' })
    expect(convertTemperature(37, 'C', 'F')).toBeCloseTo(98.6)
    expect(convertTemperature(0, 'C', 'K')).toBeCloseTo(273.15)
  })
})
