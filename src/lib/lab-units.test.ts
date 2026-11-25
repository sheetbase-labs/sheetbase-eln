import { describe, expect, it } from 'vitest'
import {
  convertQuantity,
  parseQuantityText,
  quantityEntry,
  sameUnit,
  unitsLike,
} from './lab-units'

describe('lab units', () => {
  it('converts within a dimension', () => {
    expect(convertQuantity(2, 'g', 'mg')).toBe(2000)
    expect(convertQuantity(0.3, 'g', 'mg')).toBe(300)
    expect(convertQuantity(250, 'µL', 'mL')).toBe(0.25)
    expect(convertQuantity(1, 'mg/mL', 'µg/mL')).toBe(1000)
    expect(convertQuantity(90, 'min', 'h')).toBe(1.5)
    expect(convertQuantity(1, 'day', 'h')).toBe(24)
    expect(convertQuantity(5, 'nM', 'µM')).toBe(0.005)
    expect(convertQuantity(760, 'Torr', 'atm')).toBe(1)
  })

  it('converts temperatures with their offsets', () => {
    expect(convertQuantity(37, '°C', 'K')).toBe(310.15)
    expect(convertQuantity(212, '°F', '°C')).toBe(100)
    expect(convertQuantity(-40, '°C', '°F')).toBe(-40)
    expect(convertQuantity(0, '°F', 'K')).toBe(255.372222222)
    expect(convertQuantity(32, '°F', '°C')).toBe(0)
  })

  it('reads spellings and scales', () => {
    expect(sameUnit('ul', 'µL')).toBe(true)
    expect(sameUnit('μg', 'µg')).toBe(true)
    expect(convertQuantity(2, 'cells/mL', '×10⁶ cells/mL')).toBe(0.000002)
    expect(convertQuantity(1.5, '×10⁶ cells/mL', 'cells/mL')).toBe(1500000)
    expect(convertQuantity(3, '×10¹¹ cp/mL', '×10¹⁰ cp/mL')).toBe(30)
    expect(convertQuantity(3, 'x10^11 cp/mL', '×10¹⁰ cp/mL')).toBe(30)
  })

  it('refuses units of another kind or unknown ones', () => {
    expect(convertQuantity(2, 'L', 'mg')).toBeNull()
    expect(convertQuantity(2, 'AU', 'NTU')).toBeNull()
    expect(convertQuantity(2, 'AU', 'AU')).toBe(2)
  })

  it('parses typed quantities', () => {
    expect(parseQuantityText('2 g')).toEqual({ value: 2, unit: 'g' })
    expect(parseQuantityText('2g')).toEqual({ value: 2, unit: 'g' })
    expect(parseQuantityText(' -3.5 °C ')).toEqual({ value: -3.5, unit: '°C' })
    expect(parseQuantityText('1,250 µL')).toEqual({ value: 1250, unit: 'µL' })
    expect(parseQuantityText('1.2e3 mg')).toEqual({ value: 1200, unit: 'mg' })
    expect(parseQuantityText('12')).toEqual({ value: 12, unit: null })
    expect(parseQuantityText('g')).toBeNull()
  })

  it('says what typed text means in a column', () => {
    expect(quantityEntry('2 g', 'mg')).toEqual({
      kind: 'converted',
      value: 2000,
      entered: { value: 2, unit: 'g' },
    })
    expect(quantityEntry('12 mg', 'mg')).toEqual({ kind: 'number', value: 12 })
    expect(quantityEntry('12', 'mg')).toEqual({ kind: 'number', value: 12 })
    expect(quantityEntry('2 mL', 'mg')).toEqual({
      kind: 'wrong-unit',
      entered: { value: 2, unit: 'mL' },
    })
    expect(quantityEntry('lots', 'mg')).toEqual({ kind: 'not-a-number' })
  })

  it('lists the units a column takes', () => {
    expect(unitsLike('mg')).toContain('g')
    expect(unitsLike('AU')).toEqual([])
  })
})
