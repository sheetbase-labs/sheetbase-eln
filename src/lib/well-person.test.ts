import { describe, expect, it } from 'vitest'

import {
  compareWellPositions,
  isWellPosition,
  parseWellPosition,
  personFromText,
  personName,
  wellFromText,
} from './well-person'

describe('well position', () => {
  it.each([
    ['A1', 'A1'],
    ['a1', 'A1'],
    ['A01', 'A1'],
    [' h 12 ', 'H12'],
    ['P24', 'P24'],
    ['AF48', 'AF48'],
  ])('reads %s as %s', (input, stored) => {
    expect(parseWellPosition(input)).toBe(stored)
  })

  it.each(['', 'A', '1', 'A0', 'AG1', 'A49', 'ZZ1', 'A1B', 'well A1'])(
    'refuses %s',
    (input) => {
      expect(parseWellPosition(input)).toBeNull()
    },
  )

  it('knows a stored value from a typed one', () => {
    expect(isWellPosition('A1')).toBe(true)
    expect(isWellPosition('A01')).toBe(false)
    expect(wellFromText('b03')).toBe('B3')
    expect(wellFromText('nope')).toBe('nope')
  })

  it('sorts row by row, so A2 comes before A10', () => {
    expect(['B1', 'A10', 'A2', 'AA1', 'Z3'].sort(compareWellPositions)).toEqual(
      ['A2', 'A10', 'B1', 'Z3', 'AA1'],
    )
  })
})

describe('person', () => {
  const names = new Map([
    ['u-1', 'Ana Silva'],
    ['u-2', 'Ben Okafor'],
    ['u-3', 'ben okafor'],
  ])

  it('shows a name, or the id when the workspace no longer knows it', () => {
    expect(personName('u-1', names)).toBe('Ana Silva')
    expect(personName('u-9', names)).toBe('u-9')
  })

  it('reads a unique name or an id, and leaves the rest for validation', () => {
    expect(personFromText('ana silva', names)).toBe('u-1')
    expect(personFromText('u-2', names)).toBe('u-2')
    expect(personFromText('Ben Okafor', names)).toBe('Ben Okafor')
    expect(personFromText('Nobody', names)).toBe('Nobody')
  })
})
