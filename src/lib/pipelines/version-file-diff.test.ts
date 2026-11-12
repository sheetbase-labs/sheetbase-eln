import { describe, expect, it } from 'vitest'

import { countChanges, diffLines, withContext } from './version-file-diff'

describe('diffLines', () => {
  it('marks added, removed and unchanged lines with their numbers', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nc\nd\n')

    expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'same:a',
      'del:b',
      'same:c',
      'add:d',
    ])
    expect(lines[2]).toMatchObject({ before: 3, after: 2 })
    expect(countChanges(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('is all unchanged for the same text', () => {
    expect(countChanges(diffLines('x\ny', 'x\ny'))).toEqual({
      added: 0,
      removed: 0,
    })
  })
})

describe('withContext', () => {
  it('folds long unchanged stretches', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'changed')
    const rows = withContext(diffLines(before, after), 2)

    expect(rows.filter((r) => r.kind === 'gap')).toEqual([
      { kind: 'gap', hidden: 8 },
      { kind: 'gap', hidden: 7 },
    ])
  })
})
