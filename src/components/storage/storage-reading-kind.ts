/** Which kind of place keeps readings, if any: only freezers and the like, and rooms. */
import type { StoragePlaceKind } from '#/components/instruments/live-feeds-data'
import type { StorageNode } from '#/lib/storage-locations'

export function readingKind(node: StorageNode): StoragePlaceKind | null {
  return node.level === 'unit' ? 'unit' : node.level === 'room' ? 'room' : null
}
