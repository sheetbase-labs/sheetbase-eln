import { describe, expect, it } from 'vitest'

import { hintsAt } from './version-file-hints'

const at = (text: string) => {
  const lines = text.split('\n')

  return hintsAt(text, lines.length, lines[lines.length - 1].length + 1)
}

describe('hintsAt', () => {
  it('offers top-level keys at the left edge', () => {
    expect(at('pipeline: PL-1\nst')?.keys).toEqual(['starts', 'steps'])
  })

  it('offers step keys and kinds after a dash under steps', () => {
    expect(at('steps:\n  - fil')?.keys).toEqual(['filter'])
    expect(at('steps:\n  - on')?.keys).toEqual(['only_if_rows'])
  })

  it('offers a step kind’s own keys under it', () => {
    expect(at('steps:\n  - remote_job:\n      qu')?.keys).toEqual(['queue'])
  })

  it('offers output keys under output', () => {
    expect(at('output:\n  dataset_n')?.keys).toEqual(['dataset_name'])
  })

  it('says nothing for a finished key or an empty prefix', () => {
    expect(at('steps')).toBeNull()
    expect(at('pipeline: x\n')).toBeNull()
  })
})
