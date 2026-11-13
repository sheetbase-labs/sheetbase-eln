import { describe, expect, it } from 'vitest'

import { jsonProblem, jsonTokens } from './code-json'
import { requirementTokens } from './pipelines/code-tokens'

describe('jsonTokens', () => {
  it('marks keys, strings, numbers and words', () => {
    const text = '{"a": "x", "b": [1, -2.5e3, true, null]}'

    const found = jsonTokens(text).map((token) => [
      token.kind,
      text.slice(token.from, token.to),
    ])

    expect(found).toEqual([
      ['key', '"a"'],
      ['str', '"x"'],
      ['key', '"b"'],
      ['num', '1'],
      ['num', '-2.5e3'],
      ['kw', 'true'],
      ['kw', 'null'],
    ])
  })
})

describe('jsonProblem', () => {
  it('passes empty text and valid JSON', () => {
    expect(jsonProblem('')).toBeNull()
    expect(jsonProblem('{"a": 1}', 'object')).toBeNull()
  })

  it('points at the line where the text stops being JSON', () => {
    const found = jsonProblem('{"a": 1,\n"b": }')

    expect(found?.reason).toBe('syntax')
    expect(found?.spot.line).toBe(2)
  })

  it('refuses a list or a single value when an object is wanted', () => {
    expect(jsonProblem('[1]', 'object')?.reason).toBe('notObject')
    expect(jsonProblem('3', 'object')?.reason).toBe('notObject')
    expect(jsonProblem('[1]')).toBeNull()
  })
})

describe('requirementTokens', () => {
  it('dims notes and marks the pinned version', () => {
    const text = 'scipy==1.15.3  # stats\n# all notes'

    const found = requirementTokens(text).map((token) => [
      token.kind,
      text.slice(token.from, token.to),
    ])

    expect(found).toEqual([
      ['num', '==1.15.3'],
      ['cm', '# stats'],
      ['cm', '# all notes'],
    ])
  })
})
