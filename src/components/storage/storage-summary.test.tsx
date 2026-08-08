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

  it('keeps the complete occupied sample identity compact without expanding the grid cell', () => {
    const occupiedPosition = positions.find(
      (position) => position.label === 'A1',
    )!
    occupiedPosition.sample = {
      id: 'sample-1',
      identifier: 'SMP - 2025 - 0020',
      title: 'LVV-CAR-T retention aliquot',
      status: 'available',
      barcode: null,
      sampleType: null,
    }
    render(
      <BoxGrid box={box} positions={positions} onSelectPosition={vi.fn()} />,
    )

    const cell = screen.getByRole('button', {
      name: 'A1, Occupied, SMP-2025-0020, LVV-CAR-T retention aliquot',
    })
    expect(cell.getAttribute('title')).toBe(
      'A1: SMP-2025-0020 — LVV-CAR-T retention aliquot',
    )
    expect(cell.textContent).toContain('SMP-2025-0020')
    expect(cell.textContent).not.toContain('SMP - 2025 - 0020')
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

  it('derives available capacity by excluding occupied, quarantined, and missing positions', () => {
    const incompletePositions = positions.filter(
      (position) => position.status !== 'available',
    )
    const { container } = render(
      <StorageMetrics box={box} positions={incompletePositions} />,
    )

    const summary = container.querySelector('[aria-label="Box capacity summary"]')
    if (!summary) throw new Error('Expected box capacity summary')
    expect(summary.textContent).toContain('Total capacity12')
    expect(summary.textContent).toContain('Occupied2')
    expect(summary.textContent).toContain('Available8')
    expect(summary.textContent).toContain('Quarantined1')
    expect(summary.textContent).toContain('Missing1')
    expect(summary.querySelector('.h-0\\.5')).toBeNull()
  })
})
