import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MoveSampleDialog } from './move-dialog'
import type * as Positions from '#/lib/storage-positions'
import type { BoxChoice, PositionCell } from '#/lib/storage-positions'

const box: BoxChoice = {
  id: 'box-1',
  name: 'Box 3',
  code: 'BX-3',
  rows: 2,
  cols: 3,
  held: 1,
  free: 5,
  above: ['Lab', 'Room 2', 'Freezer F-1', 'Shelf 1', 'Rack A'],
  path: 'Lab / Room 2 / Freezer F-1 / Shelf 1 / Rack A / Box 3',
}

function cell(
  row: number,
  col: number,
  extra: Partial<PositionCell> = {},
): PositionCell {
  return {
    id: `pos-${row}-${col}`,
    boxId: 'box-1',
    rowIndex: row,
    colIndex: col,
    label: `${String.fromCharCode(65 + row)}${col + 1}`,
    status: 'available',
    occupant: null,
    ...extra,
  }
}

const cells = [
  cell(0, 0, {
    status: 'occupied',
    occupant: { id: 'r1', identifier: 'SMP-9', title: null },
  }),
  cell(0, 1),
  cell(0, 2),
  cell(1, 0),
  cell(1, 1),
  cell(1, 2),
]

const mocks = vi.hoisted(() => ({
  boxes: vi.fn(),
  positions: vi.fn(),
  current: vi.fn(),
}))

vi.mock('#/lib/storage-positions', async (importOriginal) => ({
  ...(await importOriginal<typeof Positions>()),
  fetchBoxChoices: mocks.boxes,
  fetchBoxPositions: mocks.positions,
  fetchSamplePosition: mocks.current,
}))

beforeEach(() => {
  mocks.boxes.mockResolvedValue([box])
  mocks.positions.mockResolvedValue(cells)
  mocks.current.mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mount(storageLocation: string | null = 'Lab / Bench 1') {
  const onSubmit = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MoveSampleDialog
        open
        onOpenChange={() => {}}
        sample={{ id: 's1', identifier: 'SMP-1', storageLocation }}
        busy={false}
        onSubmit={onSubmit}
        locations={['Lab / Bench 1', 'Bench']}
      />
    </QueryClientProvider>,
  )
  return onSubmit
}

describe('MoveSampleDialog', () => {
  it('says where the sample is now', async () => {
    mount()
    expect(screen.getByText('Now at Lab / Bench 1.')).toBeTruthy()
    await screen.findByRole('grid')
  })

  it('moves to the free position that was clicked', async () => {
    const onSubmit = mount()
    fireEvent.click(await screen.findByRole('gridcell', { name: /B2: B2/ }))
    expect(
      screen.getByText(
        /Lab \/ Room 2 \/ Freezer F-1 \/ Shelf 1 \/ Rack A \/ Box 3 \/ B2/,
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'position',
        position: expect.objectContaining({ id: 'pos-1-1' }),
      }),
    )
  })

  it('does not let a taken position be chosen', async () => {
    mount()
    const taken = await screen.findByRole('gridcell', {
      name: /A1: Holds SMP-9/,
    })
    fireEvent.click(taken)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move' }).disabled,
    ).toBe(true)
  })

  it('picks the first free position in reading order', async () => {
    const onSubmit = mount()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'First free' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onSubmit.mock.calls[0][0].position.label).toBe('A2')
  })

  it('still takes a typed place that is not in a box', async () => {
    const onSubmit = mount()
    await screen.findByRole('grid')
    fireEvent.click(
      screen.getByRole('button', { name: 'It isn’t in a storage box' }),
    )
    fireEvent.change(screen.getByLabelText('Where is it?'), {
      target: { value: '  Bench ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'text', text: '  Bench ' })
  })

  it('holds a typed move to where the sample already is, and says why', async () => {
    const onSubmit = mount()
    await screen.findByRole('grid')
    fireEvent.click(
      screen.getByRole('button', { name: 'It isn’t in a storage box' }),
    )
    fireEvent.change(screen.getByLabelText('Where is it?'), {
      target: { value: 'lab / bench 1' },
    })
    expect(screen.getByText('SMP-1 is already at Lab / Bench 1.')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move' }).disabled,
    ).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers to put a sample with no place in storage', async () => {
    mount(null)
    expect(screen.getByText('Not in storage yet.')).toBeTruthy()
    await waitFor(() => screen.getByRole('grid'))
    expect(screen.getByRole('button', { name: 'Put here' })).toBeTruthy()
  })

  it('falls back to typing when no boxes are set up', async () => {
    mocks.boxes.mockResolvedValue([])
    mount()
    expect(
      await screen.findByText(/No storage boxes are set up yet/),
    ).toBeTruthy()
    expect(screen.getByLabelText('Where is it?')).toBeTruthy()
  })
})
