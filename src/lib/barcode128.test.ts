import { describe, expect, it } from 'vitest'

import { encodeCode128, isCode128Text } from './barcode128'

describe('encodeCode128', () => {
  // Reference encodings from an independent Code 128 implementation.
  it('matches known encodings', () => {
    expect(encodeCode128('A1')).toBe(
      '110100100001010001100010011100110100001001101100011101011',
    )
    expect(encodeCode128('Freezer 80')).toBe(
      '1101001000010001100010100100111101011001000010110010000110111101101011001000010010011110110110011001110100110010011101100111001101001100011101011',
    )
  })

  it('starts with the start code and ends with the stop pattern', () => {
    const bits = encodeCode128('SMP-0001')
    expect(bits.startsWith('11010010000')).toBe(true)
    expect(bits.endsWith('1100011101011')).toBe(true)
  })

  it('refuses text it cannot carry', () => {
    expect(isCode128Text('SMP-0001')).toBe(true)
    expect(isCode128Text('')).toBe(false)
    expect(isCode128Text('Zellkultur ü')).toBe(false)
    expect(() => encodeCode128('ü')).toThrow()
  })
})
