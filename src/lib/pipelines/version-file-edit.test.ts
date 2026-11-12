import { describe, expect, it } from 'vitest'

import { newHistory, record, shiftLines, move } from './version-file-edit'

const edit = (text: string) => ({ text, start: text.length, end: text.length })

describe('shiftLines', () => {
  const text = 'a:\n  b: 1\n  c: 2\nd: 3'

  it('indents every line the selection touches and keeps it selected', () => {
    const out = shiftLines(text, 5, 14, false)

    expect(out?.text).toBe('a:\n    b: 1\n    c: 2\nd: 3')
    expect(text.slice(5, 14)).toBe('b: 1\n  c:')
    expect(out && out.text.slice(out.start, out.end)).toBe('b: 1\n    c:')
  })

  it('outdents, up to two spaces a line', () => {
    expect(shiftLines('  a\n b\nc', 0, 8, true)?.text).toBe('a\nb\nc')
  })

  it('leaves a line the selection only reaches the start of', () => {
    expect(shiftLines('a\nb', 0, 2, false)?.text).toBe('  a\nb')
  })

  it('leaves blank lines blank and says so when nothing changes', () => {
    expect(shiftLines('a\n\nb', 0, 4, false)?.text).toBe('  a\n\n  b')
    expect(shiftLines('a', 0, 1, true)).toBeNull()
  })
})

describe('history', () => {
  it('steps back and forward through what was recorded', () => {
    const h = newHistory()

    record(h, edit('a'), 0, false)
    record(h, edit('ab'), 5000, false)
    expect(move(h, -1)?.text).toBe('a')
    expect(move(h, -1)).toBeNull()
    expect(move(h, 1)?.text).toBe('ab')
    expect(move(h, 1)).toBeNull()
  })

  it('joins quick typing and drops what was undone when something new is typed', () => {
    const h = newHistory()

    record(h, edit('a'), 1, false)
    record(h, edit('ab'), 100, true)
    record(h, edit('abc'), 200, true)
    record(h, edit('abcd'), 300, true)
    expect(h.stack).toHaveLength(2)
    expect(h.stack[1].text).toBe('abcd')
    expect(move(h, -1)?.text).toBe('a')
    record(h, edit('ax'), 9000, false)
    expect(move(h, 1)).toBeNull()
    expect(move(h, -1)?.text).toBe('a')
  })
})
