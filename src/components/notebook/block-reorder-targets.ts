/** The neighbours a move would land between, used for the no-op check and
 * RPC destination. `beforeBlockId` null means end of list. */
export interface DropNeighbours {
  afterBlockId: string | null
  beforeBlockId: string | null
}

/** Neighbours after removing the moved item, with the destination clamped. */
export function neighboursForTarget(
  ids: readonly string[],
  itemId: string,
  targetIndex: number,
): DropNeighbours {
  const others = ids.filter((id) => id !== itemId)
  const clamped = Math.max(0, Math.min(targetIndex, others.length))
  const afterBlockId = clamped > 0 ? (others[clamped - 1] ?? null) : null

  const beforeBlockId =
    clamped < others.length ? (others[clamped] ?? null) : null

  return { afterBlockId, beforeBlockId }
}

/** The keyboard and menu destination, in the same convention as a drop. */
export function moveTargetIndex(
  ids: readonly string[],
  itemId: string,
  direction: 'up' | 'down',
): number | null {
  const index = ids.indexOf(itemId)

  if (index < 0) return null
  const target = direction === 'up' ? index - 1 : index + 1

  if (target < 0 || target >= ids.length) return null

  return target
}
