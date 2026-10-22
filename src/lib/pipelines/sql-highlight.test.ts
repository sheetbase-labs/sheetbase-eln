import { describe, expect, it } from 'vitest'

import { tokenizeSql } from './sql-highlight'

const kinds = (sql: string) =>
  tokenizeSql(sql)
    .filter((t) => t.kind !== 'plain')
    .map((t) => `${t.kind}:${t.text}`)

describe('tokenizeSql', () => {
  it('colours keywords, strings, numbers and quoted names', () => {
    expect(
      kinds(`SELECT "Batch", 'a', 12.5 FROM readings WHERE v >= 3`),
    ).toEqual([
      'keyword:SELECT',
      'identifier:"Batch"',
      "string:'a'",
      'number:12.5',
      'keyword:FROM',
      'keyword:WHERE',
      'number:3',
    ])
  })

  it('treats a name that merely starts like a keyword as a name', () => {
    expect(kinds('select selected, order_id from t')).toEqual([
      'keyword:select',
      'keyword:from',
    ])
  })

  it('colours functions only when they are called', () => {
    expect(kinds('select count(*), count from t')).toEqual([
      'keyword:select',
      'keyword:count',
      'keyword:from',
    ])
  })

  it('keeps a doubled quote inside a string', () => {
    expect(kinds(`select 'it''s' from t`)).toContain("string:'it''s'")
  })

  it('colours comments and {{parameters}}', () => {
    expect(kinds('select {{factor}} -- scale\n/* x */ from t')).toEqual([
      'keyword:select',
      'parameter:{{factor}}',
      'comment:-- scale',
      'comment:/* x */',
      'keyword:from',
    ])
  })

  it('never loses or reorders text, even for unfinished or odd input', () => {
    const samples = [
      '',
      "select 'unterminated",
      '/* open',
      'select {{open',
      'select "a',
      'select ü, 1e5, .5, a.b from `x` ; --',
      'SELECT\n\tx\r\nFROM y',
    ]
    for (const sql of samples)
      expect(
        tokenizeSql(sql)
          .map((t) => t.text)
          .join(''),
      ).toBe(sql)
  })
})
