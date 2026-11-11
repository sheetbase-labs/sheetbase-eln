import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  detectPreset,
  isPaneTree,
  leaf,
  listPaneIds,
  neighbourOf,
  nextPaneId,
  removePane,
  resizeSplit,
  split,
  splitPane,
  swapPanes,
} from './pane-tree'
import type { PaneSplit, PaneTree } from './pane-tree'

const sum = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0)

/** The split a builder returned, refusing (loudly) any other tree. */
function asSplit(tree: PaneTree | null): PaneSplit {
  if (tree?.type !== 'split') throw new Error('Expected a split of panes')

  return tree
}

describe('splitPane', () => {
  it('wraps a lone pane in a split with the new pane after it', () => {
    const tree = asSplit(splitPane(leaf('a'), 'a', 'b', 'row'))
    expect(listPaneIds(tree)).toEqual(['a', 'b'])
    expect(tree.direction).toBe('row')
    expect(tree.sizes).toEqual([0.5, 0.5])
  })

  it('shares the target pane, not the whole split, when splitting in the same direction', () => {
    let tree: PaneTree = splitPane(leaf('a'), 'a', 'b', 'row')
    tree = splitPane(tree, 'a', 'c', 'row')
    const row = asSplit(tree)
    expect(row.children).toHaveLength(3)
    expect(listPaneIds(tree)).toEqual(['a', 'c', 'b'])
    expect(row.sizes).toEqual([0.25, 0.25, 0.5])
  })

  it('nests when the direction changes and can place the new pane first', () => {
    let tree: PaneTree = splitPane(leaf('a'), 'a', 'b', 'row')
    tree = splitPane(tree, 'b', 'c', 'column', true)
    expect(listPaneIds(tree)).toEqual(['a', 'c', 'b'])
    const row = asSplit(tree)
    expect(asSplit(row.children[1]).direction).toBe('column')
  })
})

describe('removePane', () => {
  it('gives the freed space to the remaining panes and keeps sizes summing to one', () => {
    let tree: PaneTree = splitPane(leaf('a'), 'a', 'b', 'row')
    tree = splitPane(tree, 'b', 'c', 'row')
    const next = asSplit(removePane(tree, 'b'))
    expect(listPaneIds(next)).toEqual(['a', 'c'])
    expect(sum(next.sizes)).toBeCloseTo(1)
  })

  it('collapses a split left with one child and returns null for the last pane', () => {
    const tree = splitPane(leaf('a'), 'a', 'b', 'row')
    expect(removePane(tree, 'b')).toEqual(leaf('a'))
    expect(removePane(leaf('a'), 'a')).toBeNull()
  })

  it('merges a nested split of the same direction into its parent', () => {
    const tree = split('row', [
      leaf('a'),
      split('column', [leaf('b'), leaf('c')]),
    ])

    const next = asSplit(removePane(tree, 'c'))
    expect(next.children.map((child) => child.type)).toEqual(['pane', 'pane'])
    expect(listPaneIds(next)).toEqual(['a', 'b'])
  })
})

describe('resizeSplit', () => {
  it('moves one divider and respects the minimum size', () => {
    const tree = asSplit(splitPane(leaf('a'), 'a', 'b', 'row'))
    const moved = asSplit(resizeSplit(tree, tree.id, 0, 0.2))
    expect(moved.sizes[0]).toBeCloseTo(0.7)
    expect(sum(moved.sizes)).toBeCloseTo(1)
    const clamped = asSplit(resizeSplit(tree, tree.id, 0, -1))
    expect(clamped.sizes[0]).toBeCloseTo(0.08)
  })
})

describe('presets', () => {
  it('tiles every pane and never drops one', () => {
    const ids = ['a', 'b', 'c', 'd']

    for (const preset of [
      'columns-2',
      'columns-3',
      'rows-2',
      'primary-context',
    ] as const) {
      expect(listPaneIds(applyPreset(preset, ids, 'c')).sort()).toEqual(ids)
    }
  })

  it('puts the primary pane first, wider, beside a stacked context for primary + context', () => {
    const tree = asSplit(applyPreset('primary-context', ['a', 'b', 'c'], 'b'))

    expect(tree.sizes).toEqual([0.6, 0.4])
    expect(tree.children[0]).toEqual(leaf('b'))
    expect(asSplit(tree.children[1]).direction).toBe('column')
  })

  it('recognises the preset a tree is exactly', () => {
    expect(detectPreset(applyPreset('columns-2', ['a', 'b'], 'a'))).toBe(
      'columns-2',
    )
    expect(detectPreset(applyPreset('columns-3', ['a', 'b', 'c'], 'a'))).toBe(
      'columns-3',
    )
    expect(detectPreset(applyPreset('rows-2', ['a', 'b'], 'a'))).toBe('rows-2')
    expect(detectPreset(applyPreset('primary-context', ['a', 'b'], 'a'))).toBe(
      'primary-context',
    )
    expect(detectPreset(leaf('a'))).toBe('single')
  })
})

describe('navigation helpers', () => {
  it('finds the next pane, wrapping, and a neighbour for linking', () => {
    const tree = applyPreset('columns-3', ['a', 'b', 'c'], 'a')
    expect(nextPaneId(tree, 'c')).toBe('a')
    expect(neighbourOf(tree, 'a')).toBe('b')
    expect(neighbourOf(tree, 'c')).toBe('b')
    expect(neighbourOf(leaf('a'), 'a')).toBeNull()
  })

  it('swaps two panes in place', () => {
    const tree = applyPreset('columns-2', ['a', 'b'], 'a')
    expect(listPaneIds(swapPanes(tree, 'a', 'b'))).toEqual(['b', 'a'])
  })
})

describe('isPaneTree', () => {
  it('accepts what it builds and refuses the old tab-stack layout', () => {
    expect(isPaneTree(applyPreset('columns-3', ['a', 'b', 'c'], 'a'))).toBe(
      true,
    )
    expect(
      isPaneTree({ type: 'stack', id: 'x', panes: ['a'], active: 'a' }),
    ).toBe(false)
    expect(
      isPaneTree({
        type: 'split',
        id: 's',
        direction: 'row',
        children: [leaf('a')],
        sizes: [1],
      }),
    ).toBe(false)
    expect(isPaneTree(null)).toBe(false)
  })
})
