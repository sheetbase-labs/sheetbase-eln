import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BoxGrid } from './box-grid'
import { StorageMetrics } from './storage-metrics'
import type { BoxPositionWithSample, StorageBox } from '#/lib/storage'

const box: StorageBox = {
  id: 'box-1',
  rackId: 'rack-1',
  name: 'LVV retention box 07',
  code: 'BX-LVV-07',
  rows: 3,
  cols: 4,
  capacity: 12,
  metadata: {},
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
}

const positions: BoxPositionWithSample[] = Array.from(
  { length: box.capacity },
  (_, index) => {
    const rowIndex = Math.floor(index / box.cols)
    const colIndex = index % box.cols
    const label = `${String.fromCharCode(65 + rowIndex)}${colIndex + 1}`
    const status =
      label === 'A1' || label === 'A2'
        ? 'occupied'
        : label === 'B3'
          ? 'quarantined'
          : label === 'C4'
            ? 'missing'
            : 'available'
    return {
      id: `position-${label}`,
      boxId: box.id,
      rowIndex,
      colIndex,
      label,
      status,
      occupiedRecordId: null,
      metadata: {},
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
      sample: null,
    }
  },
)

describe('storage box summary', () => {
  it('keeps every grid column visible and labels the missing state in the legend', () => {
    const { container } = render(
      <BoxGrid box={box} positions={positions} onSelectPosition={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: 'C4, Missing' })).toBeTruthy()
    expect(
      screen.getByLabelText('Position status legend').textContent,
    ).toContain('Missing')
    expect(container.querySelector('.min-w-max')).toBeNull()
    expect(container.querySelector('.w-full')).toBeTruthy()
  })

  it('accounts for each position status against total capacity', () => {
    render(<StorageMetrics box={box} positions={positions} />)

    const summary = screen.getByLabelText('Box capacity summary')
    expect(summary.textContent).toContain('Total capacity12')
    expect(summary.textContent).toContain('Occupied2')
    expect(summary.textContent).toContain('Available8')
    expect(summary.textContent).toContain('Quarantined1')
    expect(summary.textContent).toContain('Missing1')
    expect(summary.getAttribute('aria-description')).toMatch(
      /mutually exclusive and reconcile to total capacity/i,
    )
  })
})
