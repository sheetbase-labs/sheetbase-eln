import { describe, expect, it } from 'vitest'

import { sentenceCase } from './sentence-case'

describe('sentenceCase', () => {
  it('reads a stored token as a sentence', () => {
    expect(sentenceCase('needs_review')).toBe('Needs review')
    expect(sentenceCase('ACTIVE')).toBe('Active')
    expect(sentenceCase('inbound')).toBe('Inbound')
  })

  it('gives an empty string for nothing', () => {
    expect(sentenceCase(null)).toBe('')
    expect(sentenceCase(undefined)).toBe('')
  })
})
