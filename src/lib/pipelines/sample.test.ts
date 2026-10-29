import { describe, expect, it } from 'vitest'

import { parseSample } from './sample'

describe('parseSample', () => {
  it('reads a JSON list of rows', () => {
    expect(parseSample('[{"v": 1, "s": "a"}, {"v": 2}]')).toEqual({
      rows: [{ v: 1, s: 'a' }, { v: 2 }],
    })
  })

  it('reads one JSON object per line', () => {
    expect(parseSample('{"v": 1}\n\n{"v": 2}')).toEqual({
      rows: [{ v: 1 }, { v: 2 }],
    })
    expect(parseSample('{"v": 1}\nnope')).toEqual({
      error: 'Line 2 isn’t a JSON object',
    })
  })

  it('reads CSV with a header, typing numbers and booleans and leaving dates as text', () => {
    expect(
      parseSample(
        'well,value,ok,day,note\nA1,0.5,true,2026-01-01,\nB2,12,false,2026-01-02,"a, ""b"""\r\n',
      ),
    ).toEqual({
      rows: [
        { well: 'A1', value: 0.5, ok: true, day: '2026-01-01', note: null },
        { well: 'B2', value: 12, ok: false, day: '2026-01-02', note: 'a, "b"' },
      ],
    })
  })

  it('keeps a number that would lose digits as text', () => {
    expect(parseSample('v\n0.1000000000000000000001\n007')).toEqual({
      rows: [{ v: '0.1000000000000000000001' }, { v: '007' }],
    })
  })

  it('names what is wrong', () => {
    expect(parseSample('[1, 2]')).toEqual({
      error: 'Use a list of row objects, like [{"value": 1}].',
    })
    expect(parseSample('[{"a": ')).toEqual({ error: 'That isn’t valid JSON.' })
    expect(parseSample('a,b\n1')).toEqual({
      error: 'CSV row 2 has 1 values but there are 2 columns.',
    })
    expect(parseSample('a,a\n1,2')).toEqual({
      error: 'CSV column names must be unique',
    })
    expect(parseSample('a,\n1,2')).toEqual({
      error: 'Every CSV column needs a name in the first row.',
    })
    expect(parseSample('a\n"x')).toEqual({
      error: 'A quoted CSV value is never closed.',
    })
  })

  it('treats nothing as no rows', () => {
    expect(parseSample('  \n ')).toEqual({ rows: [] })
  })
})
