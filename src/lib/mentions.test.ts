import { describe, expect, it } from 'vitest'

import {
  activeMention,
  extractMentions,
  insertMention,
  matchMentions,
} from './mentions'

const people = [
  { userId: 'u-ada', name: 'Ada Lovelace' },
  { userId: 'u-adam', name: 'Adam' },
  { userId: 'u-ad', name: 'Ad' },
]

describe('extractMentions', () => {
  it('finds a full name, case-insensitively, once', () => {
    expect(
      extractMentions('Thanks @ada lovelace, and again @Ada Lovelace.', people),
    ).toEqual(['u-ada'])
  })

  it('needs the name to end at a word boundary and prefers the longest name', () => {
    expect(extractMentions('@Adam please look', people)).toEqual(['u-adam'])
    expect(extractMentions('@Adamant', people)).toEqual([])
    expect(extractMentions('@Ad: look', people)).toEqual(['u-ad'])
  })

  it('does not treat an address as a mention', () => {
    expect(extractMentions('mail ada@Adam.com', people)).toEqual([])
  })

  it('keeps the order in which people were named', () => {
    expect(extractMentions('@Adam then @Ada Lovelace', people)).toEqual([
      'u-adam',
      'u-ada',
    ])
  })
})

describe('typing a mention', () => {
  it('finds the word being typed after an @', () => {
    expect(activeMention('Thanks @ad', 10)).toEqual({ query: 'ad', start: 7 })
    expect(activeMention('Thanks ad', 9)).toBeNull()
    expect(activeMention('a@b', 3)).toBeNull()
    expect(activeMention('@a b c', 6)).toBeNull()
  })

  it('suggests members by first or later name part', () => {
    expect(matchMentions('lov', people).map((p) => p.userId)).toEqual(['u-ada'])
    expect(matchMentions('', people)).toHaveLength(3)
  })

  it('replaces the partial word with the chosen name', () => {
    expect(insertMention('Thanks @lo', 10, 'Ada Lovelace')).toEqual({
      text: 'Thanks @Ada Lovelace ',
      caret: 21,
    })
    expect(insertMention('no mention', 4, 'Ada')).toBeNull()
  })
})
