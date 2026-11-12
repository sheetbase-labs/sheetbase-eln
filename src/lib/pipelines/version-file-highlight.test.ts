import { describe, expect, it } from 'vitest'

import { highlightFile, markRange } from './version-file-highlight'

describe('highlightFile', () => {
  it('joins back to the text, line by line', () => {
    const text = [
      '# a comment',
      'pipeline: PL-0021',
      'steps:',
      '  - id: yield # why',
      '    sql: |-',
      '      SELECT a, {{b}} FROM t -- x',
      '  - id: fit',
      '    reads: ["a", $ntu]',
      '    python: |',
      '      def f():',
      '          return "x"  # done',
      'output: { mode: none }',
    ].join('\n')

    const lines = highlightFile(text)

    expect(lines.map((spans) => spans.map((s) => s.text).join(''))).toEqual(
      text.split('\n'),
    )
  })

  it('colours keys, step ids, SQL keywords, references and comments', () => {
    const lines = highlightFile(
      '  - id: yield\n    sql: |-\n      SELECT {{b}}\n# hi',
    )

    const kinds = (n: number) => lines[n].map((s) => `${s.kind}:${s.text}`)

    expect(kinds(0)).toContain('sid:yield')
    expect(kinds(0)).toContain('key:id')
    expect(kinds(2)).toContain('kw:SELECT')
    expect(kinds(2)).toContain('ref:{{b}}')
    expect(kinds(3)).toEqual(['cm:# hi'])
  })

  it('leaves the block when the indent comes back', () => {
    const lines = highlightFile('sql: |\n  SELECT 1\nnext: 2')

    expect(lines[2].map((s) => s.kind)).toContain('key')
  })
})

describe('markRange', () => {
  it('marks only the characters asked for, across spans', () => {
    const marked = markRange(
      [
        { kind: 'key', text: 'reads' },
        { kind: 'plain', text: ': [yeild]' },
      ],
      8,
      13,
    )

    expect(marked.map((s) => s.text).join('')).toBe('reads: [yeild]')
    expect(marked.filter((s) => s.bad).map((s) => s.text)).toEqual(['yeild'])
  })
})
