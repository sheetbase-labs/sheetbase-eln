import { describe, expect, it } from 'vitest'

import { sqlLines } from './format'

describe('sqlLines', () => {
  it('breaks a calculate statement the way the board draws it', () => {
    expect(
      sqlLines(
        'SELECT *, ROUND(100.0 * capsid_titre / feed_titre, 1) AS step_yield_pct FROM previous',
      ),
    ).toEqual([
      'SELECT *,',
      '  ROUND(100.0 * capsid_titre / feed_titre, 1) AS step_yield_pct',
      'FROM previous',
    ])
  })

  it('leaves keywords inside quotes and brackets alone', () => {
    expect(
      sqlLines("SELECT * FROM previous WHERE note = 'a FROM b' AND (x IN (1))"),
    ).toEqual([
      'SELECT *',
      'FROM previous',
      "WHERE note = 'a FROM b' AND (x IN (1))",
    ])
  })

  it('puts each join clause on its own line', () => {
    expect(
      sqlLines(
        'SELECT p.*, j.a FROM previous AS p LEFT JOIN t AS j ON p.k = j.k',
      ),
    ).toEqual([
      'SELECT p.*, j.a',
      'FROM previous AS p',
      'LEFT JOIN t AS j',
      'ON p.k = j.k',
    ])
  })
})
