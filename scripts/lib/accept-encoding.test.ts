import { describe, expect, it } from 'vitest'

import { acceptsEncoding } from './accept-encoding.mjs'

describe('acceptsEncoding', () => {
  it('reads a plain list', () => {
    expect(acceptsEncoding('gzip, deflate, br', 'br')).toBe(true)
    expect(acceptsEncoding('gzip, deflate', 'br')).toBe(false)
  })

  it('treats a zero weight as a refusal', () => {
    expect(acceptsEncoding('br;q=0, gzip', 'br')).toBe(false)
    expect(acceptsEncoding('br;q=0.0', 'br')).toBe(false)
    expect(acceptsEncoding('br;q=0.5', 'br')).toBe(true)
  })

  it('honours a wildcard for encodings it does not name', () => {
    expect(acceptsEncoding('*', 'gzip')).toBe(true)
    expect(acceptsEncoding('gzip;q=0, *', 'gzip')).toBe(false)
    expect(acceptsEncoding('*;q=0', 'br')).toBe(false)
  })

  it('accepts nothing from an empty or missing header', () => {
    expect(acceptsEncoding('', 'gzip')).toBe(false)
    expect(acceptsEncoding(undefined, 'gzip')).toBe(false)
  })

  it('is case-insensitive about names', () => {
    expect(acceptsEncoding('GZip', 'gzip')).toBe(true)
  })
})
