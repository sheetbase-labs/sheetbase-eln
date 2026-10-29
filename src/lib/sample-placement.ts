/**
 * Putting a sample somewhere: a position in a box (the database keeps the
 * count and the history), or, for a place that isn't in the storage setup, a
 * line of text as before.
 */
import type { DataClient } from '#/lib/data-client'
import { editSample, transferSample } from '#/lib/samples'
import {
  fetchBoxPositions,
  moveSampleToPosition,
} from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'

export interface PlaceSampleInput {
  recordId: string
  expectedMetadataVersion: number
  choice: PlaceChoice
  /** Whether the sample has a place on record already (text or position). */
  hasLocation: boolean
  notes?: string
}

/**
 * Returns the sample's new metadata version, so a caller that goes on to change
 * the sample again doesn't send a stale one.
 */
export async function placeSample(
  client: DataClient,
  input: PlaceSampleInput,
): Promise<number> {
  const { choice } = input
  if (choice.kind === 'position') {
    const row = await moveSampleToPosition(client, {
      recordId: input.recordId,
      positionId: choice.position.id,
      expectedMetadataVersion: input.expectedMetadataVersion,
      notes: input.notes,
    })
    return row.metadata_version
  }
  const text = choice.text.trim()
  if (input.hasLocation) {
    const row = await transferSample(client, {
      recordId: input.recordId,
      toLocation: text,
      expectedMetadataVersion: input.expectedMetadataVersion,
      notes: input.notes,
    })
    return row.metadataVersion
  }
  const row = await editSample(client, {
    recordId: input.recordId,
    expectedMetadataVersion: input.expectedMetadataVersion,
    properties: { storageLocation: text },
    notes: input.notes,
  })
  return row.metadataVersion
}

/**
 * Files a run of new tubes into the free positions of one box, reading along
 * the rows. Starts at `startPositionId` when given (the first free position at
 * or after it), else at the first free position. Tubes that don't fit stay
 * where they are; the number placed comes back so the caller can say so.
 */
export async function placeInSequence(
  client: DataClient,
  tubes: readonly { id: string; metadataVersion: number }[],
  target: { boxId: string; startPositionId?: string | null },
): Promise<number> {
  const cells = (await fetchBoxPositions(client, target.boxId)).sort(
    (a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex,
  )
  const from = target.startPositionId
    ? Math.max(
        0,
        cells.findIndex((cell) => cell.id === target.startPositionId),
      )
    : 0
  const free = cells.slice(from).filter((cell) => cell.status === 'available')
  let placed = 0
  for (const [index, tube] of tubes.entries()) {
    const cell = free.at(index)
    if (!cell) break
    await moveSampleToPosition(client, {
      recordId: tube.id,
      positionId: cell.id,
      expectedMetadataVersion: tube.metadataVersion,
    })
    placed += 1
  }
  return placed
}
