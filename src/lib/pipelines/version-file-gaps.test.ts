import { describe, expect, it } from 'vitest'

import {
  fileOffset,
  GAP,
  shownOffset,
  withGaps,
  withoutGaps,
} from './version-file-gaps'

const FILE = 'a: 1\nb: 2\nc: 3'

describe('the room under an error line', () => {
  it('adds and removes it without touching the file', () => {
    const shown = withGaps(FILE, [2])

    expect(shown).toBe(`a: 1\nb: 2\n${GAP}\n${GAP}\nc: 3`)
    expect(withoutGaps(shown)).toBe(FILE)
    expect(withGaps(FILE, [])).toBe(FILE)
  })

  it('takes out a gap character that was typed into', () => {
    expect(withoutGaps(`a: 1\n${GAP}x\nb`)).toBe('a: 1\nx\nb')
  })

  it('moves the caret across the room', () => {
    const lines = [1]
    const shown = withGaps(FILE, lines)
    const atC = FILE.indexOf('c: 3') + 2

    expect(shownOffset(FILE, lines, 2)).toBe(2)
    expect(shown.slice(shownOffset(FILE, lines, atC))).toBe(' 3')
    expect(fileOffset(shown, shownOffset(FILE, lines, atC))).toBe(atC)
  })

  it('puts a caret that lands in the room at the line before it', () => {
    const shown = withGaps(FILE, [1])

    expect(fileOffset(shown, shown.indexOf(GAP) + 1)).toBe(4)
  })
})
