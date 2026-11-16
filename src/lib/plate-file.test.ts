import { describe, expect, it } from 'vitest'

import { platesInText } from './plate-file'

const grid = [
  'Protocol,Kinase screen',
  'Date,2026-11-16',
  '',
  ',1,2,3,4',
  'A,10,20,30,40',
  'B,11,21,31,41',
  'C,12,22,32,42',
].join('\n')

describe('platesInText', () => {
  it('finds a grid below a preamble', () => {
    const found = platesInText(grid, 'run.csv')

    expect(found).toHaveLength(1)
    expect(found[0].layout).toBe('grid')
    expect(found[0].readings).toBe(12)
  })

  it('reads tab separated exports', () => {
    const found = platesInText(grid.replaceAll(',', '\t'), 'run.txt')

    expect(found).toHaveLength(1)
    expect(found[0].readings).toBe(12)
  })

  it('finds every plate in a file and labels them', () => {
    const found = platesInText(`${grid}\n\n${grid}`, 'two.csv')

    expect(found).toHaveLength(2)
    expect(found.map((c) => c.label)).toEqual(['two.csv · 1', 'two.csv · 2'])
    expect(new Set(found.map((c) => c.id)).size).toBe(2)
  })

  it('reads a list with a well column', () => {
    const found = platesInText('well,value\nA1,5\nA2,6\nB1,7', 'list.csv')

    expect(found).toHaveLength(1)
    expect(found[0].layout).toBe('list')
    expect(found[0].readings).toBe(3)
  })

  it('finds nothing in text that is not a plate', () => {
    expect(platesInText('name,age\nAda,36', 'x.csv')).toEqual([])
  })
})
