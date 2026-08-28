import { describe, expect, it } from 'vitest'

import {
  checkTransformStatement,
  substituteParameters,
  wrapTransformStatement,
} from './statement'

describe('checkTransformStatement', () => {
  it('accepts a plain single SELECT', () => {
    expect(checkTransformStatement('SELECT * FROM input')).toEqual({ ok: true })
  })

  it('accepts a WITH + SELECT', () => {
    expect(
      checkTransformStatement(
        'WITH filtered AS (SELECT * FROM input) SELECT * FROM filtered',
      ),
    ).toEqual({ ok: true })
  })

  it('accepts a trailing semicolon', () => {
    expect(checkTransformStatement('SELECT 1;')).toEqual({ ok: true })
  })

  it('rejects a multi-statement body', () => {
    const result = checkTransformStatement('SELECT 1; SELECT 2')
    expect(result.ok).toBe(false)
  })

  it('rejects non-SELECT statements', () => {
    for (const statement of [
      'DELETE FROM input',
      'INSERT INTO input VALUES (1)',
      'UPDATE input SET x = 1',
    ]) {
      expect(checkTransformStatement(statement).ok).toBe(false)
    }
  })

  it('rejects comments', () => {
    expect(checkTransformStatement('SELECT 1 -- comment').ok).toBe(false)
    expect(checkTransformStatement('SELECT /* c */ 1').ok).toBe(false)
  })

  it('rejects dollar quoting', () => {
    expect(checkTransformStatement('SELECT $tag$ x $tag$').ok).toBe(false)
  })

  it('rejects dangerous keywords', () => {
    for (const statement of [
      "SELECT pg_read_file('x')",
      'SELECT pg_sleep(10)',
      "SELECT set_config('a', 'b', true)",
      "SELECT current_setting('x')",
      "SELECT lo_export(1, 'x')",
      'SELECT * FROM api.datasets',
      'SELECT * FROM internal.secrets',
      'SELECT 1 INTO x',
    ]) {
      const result = checkTransformStatement(statement)
      expect(result.ok).toBe(false)
      if (result.ok) {
        throw new Error(`expected rejection: ${statement}`)
      }
    }
  })

  it('allows casts and aggregates', () => {
    expect(
      checkTransformStatement(
        'SELECT avg(value::numeric) AS mean FROM input GROUP BY batch',
      ).ok,
    ).toBe(true)
  })
})

describe('substituteParameters', () => {
  const types = {
    factor: 'decimal',
    note: 'text',
    n: 'integer',
    flag: 'boolean',
    d: 'date',
    ts: 'timestamp',
  }

  it('substitutes typed literals', () => {
    const result = substituteParameters(
      'SELECT * FROM input WHERE value > {{factor}} AND label = {{note}}',
      { factor: 2.5, note: "it's" },
      types,
    )
    expect(result).toEqual({
      ok: true,
      statement: "SELECT * FROM input WHERE value > 2.5 AND label = 'it''s'",
    })
  })

  it('substitutes integer, boolean, date and timestamp literals', () => {
    const result = substituteParameters(
      'SELECT * FROM input WHERE n = {{n}} AND flag = {{flag}} AND d > {{d}} AND ts < {{ts}}',
      { n: 3, flag: true, d: '2024-01-31', ts: '2024-01-31T10:00:00Z' },
      types,
    )
    expect(result).toEqual({
      ok: true,
      statement:
        "SELECT * FROM input WHERE n = 3 AND flag = true AND d > '2024-01-31'::date AND ts < '2024-01-31T10:00:00Z'::timestamptz",
    })
  })

  it('rejects an undeclared placeholder', () => {
    const result = substituteParameters('SELECT {{bogus}}', {}, types)
    expect(result.ok).toBe(false)
  })

  it('rejects a placeholder with a type-mismatched value', () => {
    const result = substituteParameters(
      'SELECT {{n}}',
      { n: 'not-an-int' },
      types,
    )
    expect(result.ok).toBe(false)
  })

  it('substitutes NULL for an absent optional parameter', () => {
    const result = substituteParameters('SELECT {{note}}', {}, types)
    expect(result).toEqual({ ok: true, statement: 'SELECT NULL' })
  })
})

describe('wrapTransformStatement', () => {
  it('bounds the result set', () => {
    const wrapped = wrapTransformStatement('SELECT * FROM input')
    expect(wrapped).toContain('LIMIT 100001')
    expect(wrapped).toContain('AS "_sb_result"')
  })
})
