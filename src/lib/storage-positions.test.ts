import { describe, expect, it, vi } from 'vitest'

import { placeInSequence, placeSample } from './sample-placement'
import {
  describePlace,
  firstFreePosition,
  freePositions,
  rowLetter,
} from './storage-positions'
import type { BoxChoice, PlaceChoice, PositionCell } from './storage-positions'

const box: BoxChoice = {
  id: 'box-1',
  name: 'Box 3',
  code: 'BX-3',
  rows: 2,
  cols: 2,
  held: 1,
  free: 3,
  above: ['Lab', 'Freezer F-1'],
  path: 'Lab / Freezer F-1 / Box 3',
}

function cell(row: number, col: number, taken = false): PositionCell {
  return {
    id: `p${row}${col}`,
    boxId: 'box-1',
    rowIndex: row,
    colIndex: col,
    label: `${rowLetter(row)}${col + 1}`,
    status: taken ? 'occupied' : 'available',
    occupant: taken ? { id: 'r', identifier: 'SMP-1', title: null } : null,
  }
}

const cells = [cell(1, 1), cell(0, 0, true), cell(0, 1), cell(1, 0)]

describe('positions in a box', () => {
  it('names a place the way the sample will read', () => {
    const position: PlaceChoice = {
      kind: 'position',
      box,
      position: cell(0, 1),
    }
    expect(describePlace(position)).toBe('Lab / Freezer F-1 / Box 3 / A2')
    expect(describePlace({ kind: 'text', text: '  Bench 4 ' })).toBe('Bench 4')
    expect(describePlace(null)).toBe('')
  })

  it('reads free positions along the rows, skipping taken ones', () => {
    expect(firstFreePosition(cells)?.label).toBe('A2')
    expect(freePositions(cells, 2).map((c) => c.label)).toEqual(['A2', 'B1'])
    expect(
      firstFreePosition(cells.map((c) => ({ ...c, status: 'occupied' }))),
    ).toBeNull()
  })
})

describe('placing a sample', () => {
  it('files into a position through the move call and returns the new version', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'r1', metadata_version: 4 })
    const version = await placeSample({ rpc } as never, {
      recordId: 'r1',
      expectedMetadataVersion: 3,
      hasLocation: true,
      choice: { kind: 'position', box, position: cell(0, 1) },
    })
    expect(version).toBe(4)
    expect(rpc).toHaveBeenCalledWith(
      'move_sample_to_position',
      expect.objectContaining({
        p_record_id: 'r1',
        p_to_position_id: 'p01',
        p_expected_metadata_version: 3,
      }),
    )
  })

  it('fills the free positions in order and stops when the box is full', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'x', metadata_version: 2 })
    const list = vi.fn().mockResolvedValue(
      cells.map((c) => ({
        id: c.id,
        box_id: c.boxId,
        row_index: c.rowIndex,
        col_index: c.colIndex,
        label: c.label,
        status: c.status,
        occupied_record_id: c.occupant ? 'r' : null,
      })),
    )
    // The occupant lookup is a second list call.
    list.mockResolvedValueOnce(await list()).mockResolvedValue([])
    const placed = await placeInSequence(
      { rpc, list } as never,
      [
        { id: 't1', metadataVersion: 1 },
        { id: 't2', metadataVersion: 1 },
        { id: 't3', metadataVersion: 1 },
        { id: 't4', metadataVersion: 1 },
      ],
      { boxId: 'box-1' },
    )
    expect(placed).toBe(3)
    expect(rpc.mock.calls.map((call) => call[1].p_to_position_id)).toEqual([
      'p01',
      'p10',
      'p11',
    ])
  })
})
