import { describe, expect, it, vi } from 'vitest'

import { gridWrites } from './grid-client-writes'
import type { GridClientLayout } from './grid-client-layout'
import type { SheetbaseGridProps } from './sheetbase-grid'

type Mutation = Parameters<ReturnType<typeof gridWrites>['onMutation']>[0]

/** A one-cell edit, as the grid reports it, optionally the undo of that edit. */
function mutation(direction?: 'backward'): Mutation {
  return {
    label: 'Edit A1',
    cells: [{ address: 'A1', before: 'old', after: 'new' }],
    columnWidths: [],
    at: '2026-11-13T00:00:00.000Z',
    ...(direction ? { direction } : null),
  }
}

function setup() {
  const onCellsChange = vi.fn()

  // SAFETY: the write adapter reads only the column and row ids of the layout.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- test fixture.
  const layout = {
    columns: [{ id: 'name' }],
    rows: [{ id: 'row-1' }],
  } as unknown as GridClientLayout

  // SAFETY: the write adapter reads only `onCellsChange` from the props here.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- test fixture.
  const props = { onCellsChange } as unknown as SheetbaseGridProps

  return { onCellsChange, onMutation: gridWrites(props, layout).onMutation }
}

describe('gridWrites onMutation', () => {
  it('saves an edit as before to after', () => {
    const { onCellsChange, onMutation } = setup()

    onMutation(mutation())

    expect(onCellsChange).toHaveBeenCalledWith(
      [expect.objectContaining({ previous: 'old', next: 'new' })],
      'edit',
    )
  })

  it('saves an undo as after back to before', () => {
    const { onCellsChange, onMutation } = setup()

    onMutation(mutation('backward'))

    expect(onCellsChange).toHaveBeenCalledWith(
      [expect.objectContaining({ previous: 'new', next: 'old' })],
      'edit',
    )
  })
})
