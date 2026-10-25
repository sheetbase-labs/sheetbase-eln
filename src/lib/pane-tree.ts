/**
 * The split tree behind the multiplex workspace. Panes tile flush inside one
 * tree: a split holds two or more children laid out in a row or a column, and
 * a leaf is one pane. There are no tab stacks; "which page am I looking at" is
 * answered by the pane header and its trail, and "which layouts do I keep" by
 * the workspace tabs above the tree.
 *
 * Everything here is pure so the arrangement can be tested without a DOM.
 */

export type SplitDirection = 'row' | 'column'

export interface PaneLeaf {
  type: 'pane'
  id: string
}

export interface PaneSplit {
  type: 'split'
  id: string
  direction: SplitDirection
  children: PaneTree[]
  /** One fraction per child; they always sum to 1. */
  sizes: number[]
}

export type PaneTree = PaneLeaf | PaneSplit

export type LayoutPreset =
  'single' | 'columns-2' | 'columns-3' | 'primary-context' | 'rows-2'

/** Panes a preset needs before it reads as its name. */
export const presetPaneCount: Record<LayoutPreset, number> = {
  single: 1,
  'columns-2': 2,
  'columns-3': 3,
  'primary-context': 2,
  'rows-2': 2,
}

export function leaf(id: string): PaneLeaf {
  return { type: 'pane', id }
}

function even(count: number) {
  return Array.from({ length: count }, () => 1 / count)
}

let splitCounter = 0
function splitId() {
  splitCounter += 1
  return `split-${splitCounter}-${Math.random().toString(36).slice(2, 7)}`
}

export function split(
  direction: SplitDirection,
  children: PaneTree[],
  sizes?: number[],
): PaneSplit {
  return {
    type: 'split',
    id: splitId(),
    direction,
    children,
    sizes: sizes ?? even(children.length),
  }
}

export function listPaneIds(tree: PaneTree): string[] {
  if (tree.type === 'pane') return [tree.id]
  return tree.children.flatMap(listPaneIds)
}

export function hasPane(tree: PaneTree, id: string): boolean {
  return listPaneIds(tree).includes(id)
}

/** A leaf or split directly above `id`, or null when `id` is the root. */
function parentOf(tree: PaneTree, id: string): PaneSplit | null {
  if (tree.type === 'pane') return null
  for (const child of tree.children) {
    if (child.type === 'pane' && child.id === id) return tree
    const found = parentOf(child, id)
    if (found) return found
  }
  return null
}

/**
 * Put `newId` beside `targetId`. A split in the direction the target already
 * sits in adds a sibling and shares the target's space; any other direction
 * wraps the target in a new split. `before` puts the new pane first.
 */
export function splitPane(
  tree: PaneTree,
  targetId: string,
  newId: string,
  direction: SplitDirection,
  before = false,
): PaneTree {
  const parent = parentOf(tree, targetId)
  if (tree.type === 'pane') {
    if (tree.id !== targetId) return tree
    const pair = before ? [leaf(newId), tree] : [tree, leaf(newId)]
    return split(direction, pair)
  }
  if (parent && parent.direction === direction) {
    return mapTree(tree, (node) => {
      if (node.id !== parent.id || node.type !== 'split') return node
      const index = node.children.findIndex(
        (child) => child.type === 'pane' && child.id === targetId,
      )
      const share = node.sizes[index] / 2
      const children = [...node.children]
      const sizes = [...node.sizes]
      sizes[index] = share
      children.splice(before ? index : index + 1, 0, leaf(newId))
      sizes.splice(before ? index : index + 1, 0, share)
      return { ...node, children, sizes }
    })
  }
  return mapTree(tree, (node) =>
    node.type === 'pane' && node.id === targetId
      ? split(direction, before ? [leaf(newId), node] : [node, leaf(newId)])
      : node,
  )
}

function mapTree(tree: PaneTree, fn: (node: PaneTree) => PaneTree): PaneTree {
  const next = fn(tree)
  if (next.type === 'pane') return next
  if (next !== tree) return next
  return {
    ...tree,
    children: tree.children.map((child) => mapTree(child, fn)),
  }
}

/**
 * Take a pane out and give its space to its neighbours. A split left with one
 * child collapses into that child. Returns null when the last pane is removed.
 */
export function removePane(tree: PaneTree, id: string): PaneTree | null {
  if (tree.type === 'pane') return tree.id === id ? null : tree
  const children: PaneTree[] = []
  const sizes: number[] = []
  let freed = 0
  tree.children.forEach((child, index) => {
    const next = removePane(child, id)
    if (next) {
      children.push(next)
      sizes.push(tree.sizes[index])
    } else {
      freed += tree.sizes[index]
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  const total = sizes.reduce((sum, size) => sum + size, 0) + freed
  const scale = total / (total - freed)
  const scaled = sizes.map((size) => size * scale)
  // A child that is itself a split in this direction merges up.
  const flatChildren: PaneTree[] = []
  const flatSizes: number[] = []
  children.forEach((child, index) => {
    if (child.type === 'split' && child.direction === tree.direction) {
      child.children.forEach((grandchild, gi) => {
        flatChildren.push(grandchild)
        flatSizes.push(scaled[index] * child.sizes[gi])
      })
    } else {
      flatChildren.push(child)
      flatSizes.push(scaled[index])
    }
  })
  return { ...tree, children: flatChildren, sizes: flatSizes }
}

/**
 * Move the divider after child `index` of a split by `delta` (a fraction of
 * the split), keeping both neighbours at least `min` of the split.
 */
export function resizeSplit(
  tree: PaneTree,
  splitIdValue: string,
  index: number,
  delta: number,
  min = 0.08,
): PaneTree {
  return mapTree(tree, (node) => {
    if (node.type !== 'split' || node.id !== splitIdValue) return node
    if (index < 0 || index + 1 >= node.sizes.length) return node
    const a = node.sizes[index]
    const b = node.sizes[index + 1]
    const pair = a + b
    const nextA = Math.min(pair - min, Math.max(min, a + delta))
    const sizes = [...node.sizes]
    sizes[index] = nextA
    sizes[index + 1] = pair - nextA
    return { ...node, sizes }
  })
}

/** Swap two panes' places without changing the shape of the tree. */
export function swapPanes(tree: PaneTree, a: string, b: string): PaneTree {
  return mapTree(tree, (node) =>
    node.type === 'pane' && node.id === a
      ? leaf(b)
      : node.type === 'pane' && node.id === b
        ? leaf(a)
        : node,
  )
}

/**
 * Tile `ids` (in order, with `primaryId` first for primary + context) in the
 * shape a preset names. Every pane is always placed; a preset never closes
 * anything.
 */
export function applyPreset(
  preset: LayoutPreset,
  ids: string[],
  primaryId: string,
): PaneTree {
  if (ids.length === 0) throw new Error('A layout needs at least one pane')
  if (ids.length === 1) return leaf(ids[0])
  switch (preset) {
    case 'single':
    case 'columns-2':
    case 'columns-3':
      return split('row', ids.map(leaf))
    case 'rows-2':
      return split('column', ids.map(leaf))
    case 'primary-context': {
      const rest = ids.filter((id) => id !== primaryId)
      const context =
        rest.length === 1 ? leaf(rest[0]) : split('column', rest.map(leaf))
      return split('row', [leaf(primaryId), context], [0.6, 0.4])
    }
  }
}

/** The preset a tree currently looks like, if it is exactly one. */
export function detectPreset(tree: PaneTree): LayoutPreset | null {
  if (tree.type === 'pane') return 'single'
  const flat = tree.children.every((child) => child.type === 'pane')
  const evenly = tree.sizes.every(
    (size) => Math.abs(size - 1 / tree.sizes.length) < 0.02,
  )
  if (flat && evenly && tree.direction === 'row') {
    if (tree.children.length === 2) return 'columns-2'
    if (tree.children.length === 3) return 'columns-3'
  }
  if (
    flat &&
    evenly &&
    tree.direction === 'column' &&
    tree.children.length === 2
  )
    return 'rows-2'
  if (
    tree.direction === 'row' &&
    tree.children.length === 2 &&
    tree.children[0].type === 'pane' &&
    Math.abs(tree.sizes[0] - 0.6) < 0.02
  )
    return 'primary-context'
  return null
}

/** Runtime check for persisted trees. */
export function isPaneTree(value: unknown): value is PaneTree {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  if (node.type === 'pane') return typeof node.id === 'string' && node.id !== ''
  if (node.type !== 'split') return false
  if (typeof node.id !== 'string') return false
  if (node.direction !== 'row' && node.direction !== 'column') return false
  if (!Array.isArray(node.children) || node.children.length < 2) return false
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length)
    return false
  if (!node.sizes.every((size) => typeof size === 'number' && size > 0))
    return false
  return node.children.every(isPaneTree)
}

/** The pane after `id` in reading order, wrapping to the first. */
export function nextPaneId(tree: PaneTree, id: string): string | null {
  const ids = listPaneIds(tree)
  if (ids.length < 2) return null
  const index = ids.indexOf(id)
  return ids[(index + 1) % ids.length]
}

/** The neighbour a link or move should reach for: next, else previous. */
export function neighbourOf(tree: PaneTree, id: string): string | null {
  const ids = listPaneIds(tree)
  const index = ids.indexOf(id)
  if (index < 0 || ids.length < 2) return null
  return index + 1 < ids.length ? ids[index + 1] : ids[index - 1]
}
