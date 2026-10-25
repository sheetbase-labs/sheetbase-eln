import type { PaneTree, SplitDirection } from './pane-tree'

/** A rectangle as fractions of the workspace stage (0–1). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  /** The split this divider belongs to, and which gap it is (after child n). */
  splitId: string
  index: number
  direction: SplitDirection
  /** Where the line sits: a row's divider is vertical, a column's horizontal. */
  rect: Rect
  /** The split's own rectangle, to turn pixel drags into fractions. */
  parent: Rect
}

export interface Geometry {
  panes: Map<string, Rect>
  dividers: Divider[]
}

/** Tiles a tree into the stage: every pane's rectangle and every divider. */
export function layoutGeometry(
  tree: PaneTree,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): Geometry {
  const panes = new Map<string, Rect>()
  const dividers: Divider[] = []
  const walk = (node: PaneTree, box: Rect) => {
    if (node.type === 'pane') {
      panes.set(node.id, box)
      return
    }
    let offset = 0
    node.children.forEach((child, index) => {
      const size = node.sizes[index]
      const childBox: Rect =
        node.direction === 'row'
          ? { x: box.x + offset * box.w, y: box.y, w: size * box.w, h: box.h }
          : { x: box.x, y: box.y + offset * box.h, w: box.w, h: size * box.h }
      walk(child, childBox)
      offset += size
      if (index < node.children.length - 1) {
        dividers.push({
          splitId: node.id,
          index,
          direction: node.direction,
          parent: box,
          rect:
            node.direction === 'row'
              ? { x: box.x + offset * box.w, y: box.y, w: 0, h: box.h }
              : { x: box.x, y: box.y + offset * box.h, w: box.w, h: 0 },
        })
      }
    })
  }
  walk(tree, rect)
  return { panes, dividers }
}

/** The fraction of a split a pointer move of `deltaPx` represents. */
export function dragFraction(
  divider: Divider,
  deltaPx: number,
  stage: { width: number; height: number },
): number {
  const extent =
    divider.direction === 'row'
      ? divider.parent.w * stage.width
      : divider.parent.h * stage.height
  return extent > 0 ? deltaPx / extent : 0
}

export type DropEdge = 'left' | 'right' | 'top' | 'bottom'

/** Which edge of a pane a pointer is nearest: the half a dropped link opens in. */
export function dropEdge(
  point: { x: number; y: number },
  box: { width: number; height: number },
): DropEdge {
  const dx = point.x / box.width - 0.5
  const dy = point.y / box.height - 0.5
  return Math.abs(dx) >= Math.abs(dy)
    ? dx < 0
      ? 'left'
      : 'right'
    : dy < 0
      ? 'top'
      : 'bottom'
}
