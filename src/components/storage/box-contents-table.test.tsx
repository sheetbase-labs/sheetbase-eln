import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BoxContentsTable } from './box-contents-table'
import type { BoxPositionWithSample } from '#/lib/storage'

const position: BoxPositionWithSample = {
  id: 'position-a1',
  boxId: 'box-1',
  rowIndex: 0,
  colIndex: 0,
  label: 'A1',
  status: 'occupied',
  occupiedRecordId: 'sample-1',
  metadata: {},
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  sample: {
    id: 'sample-1',
    identifier: 'SMP-2025-0020',
    title: 'LVV-CAR-T retention aliquot',
    status: 'available',
    barcode: 'SMP-LVV-0020',
    sampleType: 'Drug substance',
  },
}

describe('BoxContentsTable', () => {
  it('sets stable column widths and renders canonical identifiers without spaced hyphens', () => {
    position.sample!.identifier = ' SMP - 2025 - 0020 '
    const { container } = render(
      <BoxContentsTable positions={[position]} onSelectPosition={vi.fn()} />,
    )

    expect(container.querySelector('table')?.className).toContain(
      'min-w-[30rem]',
    )
    const identifier = screen.getByText('SMP-2025-0020')
    expect(identifier.getAttribute('title')).toBe('SMP-2025-0020')
    expect(identifier.textContent).not.toContain(' - ')
    expect(screen.getByText('Drug substance').getAttribute('title')).toBe(
      'Drug substance',
    )
  })
})
