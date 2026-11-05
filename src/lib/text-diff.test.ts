import { describe, expect, it } from 'vitest'

import { diffWords } from './text-diff'

describe('diffWords', () => {
  it('marks only the words that changed', () => {
    expect(diffWords('the cat sat', 'the dog sat')).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'removed', text: 'cat' },
      { kind: 'added', text: 'dog' },
      { kind: 'same', text: ' sat' },
    ])
  })

  it('shows an insertion and a deletion', () => {
    expect(diffWords('a b', 'a b c')).toEqual([
      { kind: 'same', text: 'a b' },
      { kind: 'added', text: ' c' },
    ])
    expect(diffWords('a b c', 'a b')).toEqual([
      { kind: 'same', text: 'a b' },
      { kind: 'removed', text: ' c' },
    ])
  })

  it('returns no parts for two empty texts', () => {
    expect(diffWords('', '')).toEqual([])
  })
})
