import { describe, expect, it } from 'vitest'

import { visibleTabIndexes } from './overflow-tabs'

const widths = [70, 50, 60, 70, 50]

describe('visibleTabIndexes', () => {
  it('keeps every tab when they all fit', () => {
    expect(visibleTabIndexes(widths, 400, 0)).toEqual([0, 1, 2, 3, 4])
  })

  it('moves tabs from the end into the menu when they do not fit', () => {
    expect(visibleTabIndexes(widths, 230, 0)).toEqual([0, 1])
  })

  it('gives a selected tab that would be hidden the last place in the row', () => {
    expect(visibleTabIndexes(widths, 230, 4)).toEqual([0, 4])
  })

  it('always keeps at least the selected tab', () => {
    expect(visibleTabIndexes(widths, 10, 3)).toEqual([3])
  })
})
