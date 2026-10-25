import { describe, expect, it } from 'vitest'
import { dragFraction, dropEdge, layoutGeometry } from './pane-geometry'
import { applyPreset } from './pane-tree'

describe('layoutGeometry', () => {
  it('tiles columns edge to edge with one divider between them', () => {
    const tree = applyPreset('columns-3', ['a', 'b', 'c'], 'a')
    const { panes, dividers } = layoutGeometry(tree)
    expect(panes.get('a')).toEqual({ x: 0, y: 0, w: 1 / 3, h: 1 })
    expect(panes.get('c')?.x).toBeCloseTo(2 / 3)
    expect(dividers).toHaveLength(2)
    expect(dividers[0].rect.x).toBeCloseTo(1 / 3)
    expect(dividers[0].rect.h).toBe(1)
  })

  it('nests a stacked context inside the primary + context split', () => {
    const tree = applyPreset('primary-context', ['a', 'b', 'c'], 'a')
    const { panes, dividers } = layoutGeometry(tree)
    expect(panes.get('a')).toEqual({ x: 0, y: 0, w: 0.6, h: 1 })
    expect(panes.get('b')).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.5 })
    expect(panes.get('c')?.y).toBeCloseTo(0.5)
    // one vertical line between primary and context, one horizontal inside it
    expect(dividers.map((d) => d.direction)).toEqual(['row', 'column'])
  })
})

describe('dragFraction', () => {
  it('turns a pointer move into a fraction of the split, not of the stage', () => {
    const tree = applyPreset('primary-context', ['a', 'b', 'c'], 'a')
    const [vertical, horizontal] = layoutGeometry(tree).dividers
    expect(
      dragFraction(vertical, 100, { width: 1000, height: 800 }),
    ).toBeCloseTo(0.1)
    // the horizontal divider sits inside the right 40%
    expect(
      dragFraction(horizontal, 80, { width: 1000, height: 800 }),
    ).toBeCloseTo(0.1)
  })
})

describe('dropEdge', () => {
  it('picks the nearest edge so a dropped link opens on that half', () => {
    const box = { width: 400, height: 300 }
    expect(dropEdge({ x: 20, y: 150 }, box)).toBe('left')
    expect(dropEdge({ x: 390, y: 150 }, box)).toBe('right')
    expect(dropEdge({ x: 200, y: 10 }, box)).toBe('top')
    expect(dropEdge({ x: 200, y: 290 }, box)).toBe('bottom')
  })
})
